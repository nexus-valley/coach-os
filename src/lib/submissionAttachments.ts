import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  normalizeSubmissionAttachmentDescriptor,
} from "@/src/lib/submissionAttachmentModel";

export {
  deriveSubmissionAttachmentSelection,
  formatSubmissionAttachmentBytes,
  formatSubmissionAttachmentType,
  getAssociatedSubmissionAttachmentIds,
  normalizeSubmissionAttachmentDescriptor,
  toggleSubmissionAttachmentSelection,
} from "@/src/lib/submissionAttachmentModel";
export type {
  SubmissionAttachment,
  SubmissionAttachmentStatus,
} from "@/src/lib/submissionAttachmentModel";

export type SubmissionAttachmentDownload = {
  byteSize: number;
  expiresInSeconds: 120;
  fileName: string;
  mimeType: string;
  signedUrl: string;
};

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

export async function getStudentSubmissionAttachments(assignmentId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_student_submission_attachments_secure",
    { p_assignment_id: assignmentId },
  );

  if (error || !Array.isArray(data)) {
    throw new Error("Submission files could not be loaded.");
  }

  return data.map((row) => normalizeSubmissionAttachmentDescriptor(row));
}

export async function getSubmissionAttachmentsForReview(
  assignmentId: string,
  submissionId: string,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_submission_attachments_for_review_secure",
    {
      p_assignment_id: assignmentId,
      p_submission_id: submissionId,
    },
  );

  if (error || !Array.isArray(data)) {
    throw new Error("Submission files could not be loaded.");
  }

  return data.map((row) =>
    normalizeSubmissionAttachmentDescriptor(row, true),
  );
}

export async function uploadSubmissionAttachment(
  assignmentId: string,
  file: File,
) {
  const token = await getAccessToken();
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(
    `/api/assignments/${encodeURIComponent(assignmentId)}/submission-attachments`,
    {
      body,
      headers: { Authorization: `Bearer ${token}` },
      method: "POST",
    },
  );
  const result = await parseJsonResponse<{ attachment?: unknown }>(
    response,
    "Submission file could not be uploaded.",
  );

  return normalizeSubmissionAttachmentDescriptor(result.attachment);
}

export async function removeSubmissionAttachment(attachmentId: string) {
  const token = await getAccessToken();
  const response = await fetch(
    `/api/submission-attachments/${encodeURIComponent(attachmentId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      method: "DELETE",
    },
  );
  const result = await parseJsonResponse<{
    attachmentId?: unknown;
    status?: unknown;
  }>(response, "Submission file could not be removed.");

  if (result.attachmentId !== attachmentId || result.status !== "removed") {
    throw new Error("Submission file could not be removed.");
  }

  return { attachmentId, status: "removed" as const };
}

export async function getSubmissionAttachmentDownloadUrl(
  attachmentId: string,
) {
  const token = await getAccessToken();
  const response = await fetch(
    `/api/submission-attachments/${encodeURIComponent(attachmentId)}/download`,
    {
      headers: { Authorization: `Bearer ${token}` },
      method: "POST",
    },
  );
  const result = await parseJsonResponse<SubmissionAttachmentDownload>(
    response,
    "Submission file could not be opened.",
  );

  if (
    typeof result.signedUrl !== "string" ||
    typeof result.fileName !== "string" ||
    !result.fileName ||
    typeof result.mimeType !== "string" ||
    !result.mimeType ||
    !Number.isSafeInteger(result.byteSize) ||
    result.byteSize <= 0 ||
    result.expiresInSeconds !== 120
  ) {
    throw new Error("Submission file could not be opened.");
  }

  try {
    const url = new URL(result.signedUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported signed URL protocol.");
    }
  } catch {
    throw new Error("Submission file could not be opened.");
  }

  return result;
}

export async function cleanupSubmissionAttachments(attachmentIds: string[]) {
  const failedIds: string[] = [];

  for (const attachmentId of attachmentIds) {
    try {
      await removeSubmissionAttachment(attachmentId);
    } catch {
      failedIds.push(attachmentId);
    }
  }

  return failedIds;
}
