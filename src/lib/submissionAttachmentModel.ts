export type SubmissionAttachmentStatus =
  | "pending_delete"
  | "pending_upload"
  | "uploaded";

export type SubmissionAttachment = {
  byteSize: number;
  createdAt: string | null;
  displayFileName: string;
  id: string;
  isAssociated: boolean;
  mimeType: string;
  status: SubmissionAttachmentStatus;
  uploadedAt: string | null;
};

type SubmissionAttachmentRow = {
  byte_size: number;
  created_at: string | null;
  display_file_name: string;
  id: string;
  is_associated?: boolean;
  mime_type: string;
  status: SubmissionAttachmentStatus;
  uploaded_at: string | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isNullableTimestamp(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) &&
      Number.isFinite(Date.parse(value)))
  );
}

export function normalizeSubmissionAttachmentDescriptor(
  value: unknown,
  associatedFallback = false,
): SubmissionAttachment {
  const row = value as Partial<SubmissionAttachmentRow> | null;

  if (
    !row ||
    typeof row.id !== "string" ||
    !uuidPattern.test(row.id) ||
    typeof row.display_file_name !== "string" ||
    !row.display_file_name ||
    typeof row.mime_type !== "string" ||
    !row.mime_type ||
    typeof row.byte_size !== "number" ||
    !Number.isSafeInteger(row.byte_size) ||
    row.byte_size <= 0 ||
    !["pending_delete", "pending_upload", "uploaded"].includes(
      row.status ?? "",
    ) ||
    !isNullableTimestamp(row.created_at) ||
    !isNullableTimestamp(row.uploaded_at) ||
    (typeof row.is_associated !== "undefined" &&
      typeof row.is_associated !== "boolean")
  ) {
    throw new Error("Submission files could not be loaded.");
  }

  return {
    byteSize: row.byte_size,
    createdAt: row.created_at,
    displayFileName: row.display_file_name,
    id: row.id,
    isAssociated: row.is_associated ?? associatedFallback,
    mimeType: row.mime_type,
    status: row.status as SubmissionAttachmentStatus,
    uploadedAt: row.uploaded_at,
  };
}

export function deriveSubmissionAttachmentSelection(params: {
  attachments: SubmissionAttachment[];
  mode: "canonical" | "preserve";
  previousAttachments?: SubmissionAttachment[];
  previousSelectedIds?: string[];
}) {
  const uploadedIds = params.attachments
    .filter((item) => item.status === "uploaded")
    .map((item) => item.id);

  if (params.mode === "canonical") {
    return Array.from(new Set(uploadedIds)).sort();
  }

  const uploadedSet = new Set(uploadedIds);
  const previousIds = new Set(
    (params.previousAttachments ?? []).map((item) => item.id),
  );
  return Array.from(
    new Set([
      ...(params.previousSelectedIds ?? []).filter((id) => uploadedSet.has(id)),
      ...uploadedIds.filter((id) => !previousIds.has(id)),
    ]),
  ).sort();
}

export function getAssociatedSubmissionAttachmentIds(
  attachments: SubmissionAttachment[],
) {
  return attachments
    .filter((item) => item.isAssociated && item.status === "uploaded")
    .map((item) => item.id)
    .sort();
}

export function toggleSubmissionAttachmentSelection(params: {
  attachmentId: string;
  selected: boolean;
  selectedIds: string[];
}) {
  return params.selected
    ? Array.from(new Set([...params.selectedIds, params.attachmentId])).sort()
    : params.selectedIds.filter((id) => id !== params.attachmentId);
}

export function formatSubmissionAttachmentBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatSubmissionAttachmentType(value: string) {
  const labels: Record<string, string> = {
    "application/msword": "DOC",
    "application/pdf": "PDF",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.document":
      "XLSX",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "DOCX",
    "image/jpeg": "JPEG",
    "image/png": "PNG",
  };

  return labels[value] ?? "File";
}
