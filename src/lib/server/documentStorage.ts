import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export const documentStorageBucket = "coachfort-documents";
export const documentSignedUrlExpiresInSeconds = 120;
export const maxDocumentUploadBytes = 10 * 1024 * 1024;

const allowedTypes = new Map([
  ["application/pdf", new Set(["pdf"])],
  ["image/png", new Set(["png"])],
  ["image/jpeg", new Set(["jpg", "jpeg"])],
  ["application/msword", new Set(["doc"])],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    new Set(["docx"]),
  ],
  ["application/vnd.ms-excel", new Set(["xls"])],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    new Set(["xlsx"]),
  ],
]);

export type PreparedUpload = {
  document_id: string;
  file_mime_type: string;
  file_name: string;
  file_size_bytes: number;
  previous_storage_bucket: string | null;
  previous_storage_path: string | null;
  storage_bucket: string;
  storage_path: string;
  tenant_id: string;
};

type DocumentStorageRow = {
  document_id: string;
  file_mime_type: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  storage_bucket: string;
  storage_path: string;
  tenant_id: string;
};

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new Error("Authentication required.");
  }

  return match[1];
}

export function getUserScopedSupabase(accessToken: string) {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase public environment is not configured.");
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export async function requireAuthenticatedUser(accessToken: string) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new Error("Authentication required.");
  }

  return data.user;
}

function extensionFromName(fileName: string) {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() ?? "" : "";
}

export function sanitizeFileName(fileName: string) {
  const base = fileName
    .trim()
    .replace(/[\/\\]+/g, "-")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");

  return (base || "document").slice(0, 160);
}

function hasExpectedMagic(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "application/pdf") {
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44;
  }

  if (mimeType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }

  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (mimeType === "application/msword" || mimeType === "application/vnd.ms-excel") {
    return (
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0
    );
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  }

  return false;
}

export async function validateDocumentFile(file: File) {
  const safeFileName = sanitizeFileName(file.name);
  const extension = extensionFromName(safeFileName);
  const allowedExtensions = allowedTypes.get(file.type);

  if (!allowedExtensions || !allowedExtensions.has(extension)) {
    throw new Error("File type is not allowed.");
  }

  if (file.size <= 0 || file.size > maxDocumentUploadBytes) {
    throw new Error("File size is invalid or exceeds the 10 MB limit.");
  }

  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  if (!hasExpectedMagic(bytes, file.type)) {
    throw new Error("File content does not match the declared type.");
  }

  return {
    extension,
    safeFileName,
  };
}

export async function authorizeDocumentForDownload(
  supabase: SupabaseClient,
  documentId: string,
) {
  const teamAccess = await supabase.rpc("get_document_detail", {
    p_document_id: documentId,
  });

  if (!teamAccess.error) {
    return;
  }

  const studentAccess = await supabase.rpc("get_student_document_detail", {
    p_document_id: documentId,
  });

  if (studentAccess.error) {
    throw new Error("Document access denied.");
  }
}

export async function getAuthorizedDocumentStorageReference(
  supabase: SupabaseClient,
  documentId: string,
) {
  const { data, error } = await supabase.rpc(
    "get_authorized_document_storage_reference",
    {
      p_document_id: documentId,
    },
  );
  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Document not found.");
  }

  return data as DocumentStorageRow;
}

export function assertValidStorageReference(row: DocumentStorageRow) {
  if (
    row.storage_bucket !== documentStorageBucket ||
    !row.storage_path ||
    !row.file_name
  ) {
    throw new Error("No uploaded file is available for this document.");
  }

  const expectedPrefix = `tenant/${row.tenant_id}/documents/${row.document_id}/`;
  if (!row.storage_path.startsWith(expectedPrefix) || row.storage_path.includes("..")) {
    throw new Error("Document storage reference is invalid.");
  }
}
