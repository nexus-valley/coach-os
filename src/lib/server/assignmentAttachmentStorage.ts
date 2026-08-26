import type { SupabaseClient } from "@supabase/supabase-js";

import {
  documentStorageBucket,
  validateDocumentFile,
} from "@/src/lib/server/documentStorage";

export type AssignmentAttachmentStorageReference = {
  bucket_name: string;
  byte_size: number;
  display_file_name: string;
  id: string;
  mime_type: string;
  object_path: string;
  status: "pending_delete" | "pending_upload" | "uploaded";
};

export type AssignmentAttachmentSafeRow = {
  byte_size: number;
  created_at?: string | null;
  display_file_name: string;
  id: string;
  mime_type: string;
  status: "pending_delete" | "pending_upload" | "uploaded";
  uploaded_at?: string | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return uuidPattern.test(value);
}

export async function validateAssignmentAttachmentFile(file: File) {
  const originalName = file.name.trim();

  if (
    !originalName ||
    originalName.length > 255 ||
    /[\u0000-\u001f\u007f/\\]/.test(originalName) ||
    originalName.includes("..")
  ) {
    throw new Error("File name is invalid.");
  }

  return validateDocumentFile(file);
}

export async function getAssignmentAttachmentStorageReference(
  admin: SupabaseClient,
  attachmentId: string,
) {
  const { data, error } = await admin.rpc(
    "get_assignment_attachment_storage_reference_server",
    { p_attachment_id: attachmentId },
  );

  if (error || !data) {
    throw error ?? new Error("Assignment attachment storage reference is unavailable.");
  }

  return data as AssignmentAttachmentStorageReference;
}

export function assertAssignmentAttachmentStorageReference(
  row: AssignmentAttachmentStorageReference,
  expected: {
    assignmentId?: string;
    attachmentId: string;
    byteSize?: number;
    displayFileName?: string;
    mimeType?: string;
    status: AssignmentAttachmentStorageReference["status"];
  },
) {
  const path = typeof row.object_path === "string" ? row.object_path : "";
  const parts = path.split("/");

  if (
    row.id !== expected.attachmentId ||
    row.bucket_name !== documentStorageBucket ||
    row.status !== expected.status ||
    parts.length !== 7 ||
    parts[0] !== "tenant" ||
    !isUuid(parts[1] ?? "") ||
    parts[2] !== "assignments" ||
    !isUuid(parts[3] ?? "") ||
    parts[4] !== "attachments" ||
    parts[5] !== expected.attachmentId ||
    parts[6] !== row.display_file_name ||
    path.includes("..") ||
    (expected.assignmentId && parts[3] !== expected.assignmentId) ||
    (expected.byteSize !== undefined && row.byte_size !== expected.byteSize) ||
    (expected.displayFileName !== undefined &&
      row.display_file_name !== expected.displayFileName) ||
    (expected.mimeType !== undefined && row.mime_type !== expected.mimeType)
  ) {
    throw new Error("Assignment attachment storage reference is invalid.");
  }
}

export function isAssignmentAttachmentSafeRow(
  value: unknown,
): value is AssignmentAttachmentSafeRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as Partial<AssignmentAttachmentSafeRow>;
  return (
    typeof row.id === "string" &&
    isUuid(row.id) &&
    typeof row.display_file_name === "string" &&
    Boolean(row.display_file_name) &&
    typeof row.mime_type === "string" &&
    typeof row.byte_size === "number" &&
    Number.isSafeInteger(row.byte_size) &&
    ["pending_delete", "pending_upload", "uploaded"].includes(row.status ?? "")
  );
}
