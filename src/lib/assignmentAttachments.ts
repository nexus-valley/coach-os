import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type AssignmentAttachmentStatus =
  | "pending_delete"
  | "pending_upload"
  | "uploaded";

export type AssignmentAttachment = {
  byteSize: number;
  createdAt: string | null;
  displayFileName: string;
  id: string;
  mimeType: string;
  status: AssignmentAttachmentStatus;
  uploadedAt: string | null;
};

type AssignmentAttachmentRow = {
  byte_size: number;
  created_at: string | null;
  display_file_name: string;
  id: string;
  mime_type: string;
  status: AssignmentAttachmentStatus;
  uploaded_at: string | null;
};

type AssignmentAttachmentDownload = {
  byteSize: number;
  expiresInSeconds: number;
  fileName: string;
  mimeType: string;
  signedUrl: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getAccessToken() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session?.access_token) {
    throw new Error("Authentication required.");
  }

  return data.session.access_token;
}

async function parseJsonResponse<T>(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: unknown;
  };

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" && payload.error
        ? payload.error
        : fallback,
    );
  }

  return payload as T;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function normalizeAssignmentAttachmentDescriptor(
  row: unknown,
): AssignmentAttachment {
  const candidate = row as Partial<AssignmentAttachmentRow> | null;

  if (
    !candidate ||
    typeof candidate.id !== "string" ||
    !uuidPattern.test(candidate.id) ||
    typeof candidate.display_file_name !== "string" ||
    !candidate.display_file_name ||
    typeof candidate.mime_type !== "string" ||
    !candidate.mime_type ||
    !Number.isSafeInteger(Number(candidate.byte_size)) ||
    Number(candidate.byte_size) <= 0 ||
    !["pending_delete", "pending_upload", "uploaded"].includes(
      candidate.status ?? "",
    ) ||
    !isNullableString(candidate.created_at) ||
    !isNullableString(candidate.uploaded_at)
  ) {
    throw new Error("Assignment files could not be loaded.");
  }

  return {
    byteSize: Number(candidate.byte_size),
    createdAt: candidate.created_at,
    displayFileName: candidate.display_file_name,
    id: candidate.id,
    mimeType: candidate.mime_type,
    status: candidate.status as AssignmentAttachmentStatus,
    uploadedAt: candidate.uploaded_at,
  };
}

export async function getAssignmentAttachments(assignmentId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_assignment_attachments_secure",
    { p_assignment_id: assignmentId },
  );

  if (error) {
    throw new Error("Assignment files could not be loaded.");
  }

  if (!Array.isArray(data)) {
    throw new Error("Assignment files could not be loaded.");
  }

  return data.map(normalizeAssignmentAttachmentDescriptor);
}

export async function uploadAssignmentAttachment(
  assignmentId: string,
  file: File,
) {
  const token = await getAccessToken();
  const body = new FormData();
  body.set("file", file);

  const response = await fetch(
    `/api/assignments/${encodeURIComponent(assignmentId)}/attachments`,
    {
      body,
      headers: { Authorization: `Bearer ${token}` },
      method: "POST",
    },
  );

  const result = await parseJsonResponse<{ attachment?: unknown }>(
    response,
    "Assignment file could not be uploaded.",
  );

  return normalizeAssignmentAttachmentDescriptor(result.attachment);
}

export async function getAssignmentAttachmentDownloadUrl(attachmentId: string) {
  const token = await getAccessToken();
  const response = await fetch(
    `/api/assignment-attachments/${encodeURIComponent(attachmentId)}/download`,
    {
      headers: { Authorization: `Bearer ${token}` },
      method: "POST",
    },
  );

  const result = await parseJsonResponse<AssignmentAttachmentDownload>(
    response,
    "Assignment file could not be opened.",
  );

  if (
    !result ||
    typeof result.signedUrl !== "string" ||
    typeof result.fileName !== "string" ||
    typeof result.mimeType !== "string" ||
    !Number.isSafeInteger(result.byteSize) ||
    result.byteSize <= 0 ||
    result.expiresInSeconds !== 120
  ) {
    throw new Error("Assignment file could not be opened.");
  }

  try {
    const url = new URL(result.signedUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported signed URL protocol.");
    }
  } catch {
    throw new Error("Assignment file could not be opened.");
  }

  return result;
}

export async function removeAssignmentAttachment(attachmentId: string) {
  const token = await getAccessToken();
  const response = await fetch(
    `/api/assignment-attachments/${encodeURIComponent(attachmentId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      method: "DELETE",
    },
  );

  const result = await parseJsonResponse<{
    attachmentId?: unknown;
    status?: unknown;
  }>(
    response,
    "Assignment file could not be removed.",
  );

  if (result.attachmentId !== attachmentId || result.status !== "removed") {
    throw new Error("Assignment file could not be removed.");
  }

  return { attachmentId, status: "removed" as const };
}
