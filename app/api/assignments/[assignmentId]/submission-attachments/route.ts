import {
  getBearerToken,
  getUserScopedSupabase,
  maxDocumentUploadBytes,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import {
  assertAssignmentAttachmentStorageReference,
  getAssignmentAttachmentStorageReference,
  isAssignmentAttachmentSafeRow,
  isUuid,
  validateAssignmentAttachmentFile,
  type AssignmentAttachmentSafeRow,
  type AssignmentAttachmentStorageReference,
} from "@/src/lib/server/assignmentAttachmentStorage";
import { captureServerException } from "@/src/lib/server/monitoring";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UploadContext = {
  params: Promise<{ assignmentId: string }>;
};

const multipartAllowanceBytes = 1024 * 1024;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function prepareError(error: { code?: string; message?: string }) {
  const message = (error.message ?? "").toLowerCase();

  if (error.code === "42501") {
    return jsonError("You cannot add files to this submission.", 403);
  }

  if (error.code === "02000" || error.code === "PGRST116") {
    return jsonError("Assignment unavailable.", 404);
  }

  if (message.includes("no more than 10") || message.includes("quota")) {
    return jsonError("The submission file limit or storage quota has been reached.", 409);
  }

  if (message.includes("not open") || error.code === "22023") {
    return jsonError("Files cannot be added to this assignment now.", 409);
  }

  return jsonError("Submission file upload could not be prepared.", 500);
}

function validationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (/10 MB|size/i.test(message)) {
    return jsonError("File exceeds the 10 MB limit or is empty.", 413);
  }

  if (/type|content|declared/i.test(message)) {
    return jsonError("File type or file content is not supported.", 415);
  }

  if (/name/i.test(message)) {
    return jsonError("File name is invalid.", 400);
  }

  return null;
}

async function compensateUpload(params: {
  assignmentId: string;
  attachmentId: string;
  finalizeAttempted: boolean;
  objectWriteAttempted: boolean;
  reference: AssignmentAttachmentStorageReference | null;
}) {
  const admin = getSupabaseAdminClient();
  let reference = params.reference;
  let storageClean = !params.objectWriteAttempted;

  if (params.finalizeAttempted) {
    try {
      const latest = await getAssignmentAttachmentStorageReference(
        admin,
        params.attachmentId,
      );

      if (latest.status === "uploaded") {
        assertAssignmentAttachmentStorageReference(latest, {
          assignmentId: params.assignmentId,
          attachmentId: params.attachmentId,
          purpose: "submission",
          status: "uploaded",
        });
        return;
      }

      assertAssignmentAttachmentStorageReference(latest, {
        assignmentId: params.assignmentId,
        attachmentId: params.attachmentId,
        purpose: "submission",
        status: "pending_upload",
      });
      reference = latest;
    } catch (error) {
      captureServerException(error, {
        assignmentId: params.assignmentId,
        attachmentId: params.attachmentId,
        operation: "submission_attachment_upload_compensation_status",
        route: "/api/assignments/[assignmentId]/submission-attachments",
      });
      return;
    }
  }

  if (reference) {
    const removal = await admin.storage
      .from(reference.bucket_name)
      .remove([reference.object_path]);
    storageClean = !removal.error;

    if (removal.error) {
      captureServerException(removal.error, {
        assignmentId: params.assignmentId,
        attachmentId: params.attachmentId,
        operation: "submission_attachment_upload_compensation_storage",
        route: "/api/assignments/[assignmentId]/submission-attachments",
      });
    }
  }

  if (!storageClean) return;

  const cancelled = await admin.rpc(
    "cancel_assignment_attachment_upload_server",
    { p_attachment_id: params.attachmentId },
  );

  if (cancelled.error) {
    captureServerException(cancelled.error, {
      assignmentId: params.assignmentId,
      attachmentId: params.attachmentId,
      operation: "submission_attachment_upload_compensation_metadata",
      route: "/api/assignments/[assignmentId]/submission-attachments",
    });
  }
}

export async function POST(request: Request, context: UploadContext) {
  let assignmentId = "";

  try {
    const accessToken = getBearerToken(request);
    await requireAuthenticatedUser(accessToken);
    ({ assignmentId } = await context.params);

    if (!isUuid(assignmentId)) {
      return jsonError("Assignment id is invalid.", 400);
    }

    const contentLength = Number(request.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > maxDocumentUploadBytes + multipartAllowanceBytes
    ) {
      return jsonError("File exceeds the 10 MB limit.", 413);
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError("Multipart file payload is invalid.", 400);
    }

    const files = formData.getAll("file");
    if (files.length !== 1 || !(files[0] instanceof File)) {
      return jsonError("Exactly one file is required.", 400);
    }

    const file = files[0];
    const { safeFileName } = await validateAssignmentAttachmentFile(file);
    const supabase = getUserScopedSupabase(accessToken);
    const prepared = await supabase.rpc(
      "prepare_submission_attachment_upload_secure",
      {
        p_assignment_id: assignmentId,
        p_byte_size: file.size,
        p_display_file_name: safeFileName,
        p_mime_type: file.type,
      },
    );

    if (prepared.error) return prepareError(prepared.error);
    if (
      !isAssignmentAttachmentSafeRow(prepared.data) ||
      prepared.data.status !== "pending_upload"
    ) {
      throw new Error("Submission attachment preparation response is invalid.");
    }

    const plan = prepared.data;
    let finalizeAttempted = false;
    let objectWriteAttempted = false;
    let reference: AssignmentAttachmentStorageReference | null = null;

    try {
      const admin = getSupabaseAdminClient();
      const candidate = await getAssignmentAttachmentStorageReference(
        admin,
        plan.id,
      );
      assertAssignmentAttachmentStorageReference(candidate, {
        assignmentId,
        attachmentId: plan.id,
        byteSize: file.size,
        displayFileName: safeFileName,
        mimeType: file.type,
        purpose: "submission",
        status: "pending_upload",
      });
      reference = candidate;

      objectWriteAttempted = true;
      const uploaded = await admin.storage
        .from(reference.bucket_name)
        .upload(reference.object_path, file, {
          cacheControl: "private, max-age=0, no-store",
          contentType: file.type,
          upsert: false,
        });
      if (uploaded.error) throw uploaded.error;

      finalizeAttempted = true;
      let finalized = await admin.rpc(
        "finalize_assignment_attachment_upload_server",
        { p_attachment_id: plan.id },
      );
      if (finalized.error) {
        finalized = await admin.rpc(
          "finalize_assignment_attachment_upload_server",
          { p_attachment_id: plan.id },
        );
      }

      if (
        finalized.error ||
        !finalized.data ||
        (finalized.data as { status?: unknown }).status !== "uploaded"
      ) {
        const finalizeError =
          finalized.error ?? new Error("Upload finalization response is invalid.");
        try {
          const latest = await getAssignmentAttachmentStorageReference(
            admin,
            plan.id,
          );
          assertAssignmentAttachmentStorageReference(latest, {
            assignmentId,
            attachmentId: plan.id,
            byteSize: file.size,
            displayFileName: safeFileName,
            mimeType: file.type,
            purpose: "submission",
            status: "uploaded",
          });
        } catch {
          throw finalizeError;
        }
      }

      const listed = await supabase.rpc(
        "get_student_submission_attachments_secure",
        { p_assignment_id: assignmentId },
      );
      const attachment = Array.isArray(listed.data)
        ? listed.data.find(
            (row): row is AssignmentAttachmentSafeRow & {
              is_associated: boolean;
            } =>
              isAssignmentAttachmentSafeRow(row) &&
              typeof (row as { is_associated?: unknown }).is_associated ===
                "boolean" &&
              row.id === plan.id,
          )
        : null;

      return Response.json({
        attachment:
          attachment ??
          ({
            ...plan,
            created_at: null,
            is_associated: false,
            status: "uploaded",
            uploaded_at: null,
          } satisfies AssignmentAttachmentSafeRow & {
            is_associated: boolean;
          }),
      });
    } catch (error) {
      await compensateUpload({
        assignmentId,
        attachmentId: plan.id,
        finalizeAttempted,
        objectWriteAttempted,
        reference,
      });
      captureServerException(error, {
        assignmentId,
        attachmentId: plan.id,
        operation: "submission_attachment_upload_storage_or_finalize",
        route: "/api/assignments/[assignmentId]/submission-attachments",
      });
      return jsonError("Submission file could not be uploaded. Please try again.", 500);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Authentication required.") {
      return jsonError("Authentication required.", 401);
    }

    const safeValidationError = validationError(error);
    if (safeValidationError) return safeValidationError;

    captureServerException(error, {
      assignmentId: assignmentId || undefined,
      operation: "submission_attachment_upload_unexpected",
      route: "/api/assignments/[assignmentId]/submission-attachments",
    });
    return jsonError("Submission file could not be uploaded.", 500);
  }
}
