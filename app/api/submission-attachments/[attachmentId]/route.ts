import {
  getBearerToken,
  getUserScopedSupabase,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import {
  assertAssignmentAttachmentStorageReference,
  getAssignmentAttachmentStorageReference,
  isUuid,
  type AssignmentAttachmentStorageReference,
} from "@/src/lib/server/assignmentAttachmentStorage";
import { captureServerException } from "@/src/lib/server/monitoring";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RemovalContext = {
  params: Promise<{ attachmentId: string }>;
};

type RemovalPlan = {
  cleanup_mode: "cancel_upload" | "delete_uploaded" | "none";
  id: string;
  status: "pending_delete" | "pending_upload" | "removed";
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isRemovalPlan(value: unknown, attachmentId: string): value is RemovalPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<RemovalPlan>;
  return (
    plan.id === attachmentId &&
    ["cancel_upload", "delete_uploaded", "none"].includes(
      plan.cleanup_mode ?? "",
    ) &&
    ["pending_delete", "pending_upload", "removed"].includes(plan.status ?? "")
  );
}

function removalError(error: { code?: string; message?: string }) {
  if (error.code === "42501") {
    return jsonError("You cannot remove this submission file.", 403);
  }

  if (error.code === "02000" || error.code === "PGRST116") {
    return jsonError("Submission file is unavailable.", 404);
  }

  if (error.code === "22023") {
    return jsonError("This file must be changed by resubmitting the assignment.", 409);
  }

  return jsonError("Submission file removal could not be prepared.", 500);
}

async function removePhysicalObject(
  reference: AssignmentAttachmentStorageReference,
) {
  const admin = getSupabaseAdminClient();
  const removed = await admin.storage
    .from(reference.bucket_name)
    .remove([reference.object_path]);
  if (removed.error) throw removed.error;
}

export async function DELETE(request: Request, context: RemovalContext) {
  let attachmentId = "";

  try {
    const accessToken = getBearerToken(request);
    await requireAuthenticatedUser(accessToken);
    ({ attachmentId } = await context.params);

    if (!isUuid(attachmentId)) {
      return jsonError("Attachment id is invalid.", 400);
    }

    const supabase = getUserScopedSupabase(accessToken);
    const prepared = await supabase.rpc(
      "prepare_submission_attachment_removal_secure",
      { p_attachment_id: attachmentId },
    );
    if (prepared.error) return removalError(prepared.error);
    if (!isRemovalPlan(prepared.data, attachmentId)) {
      throw new Error("Submission attachment removal response is invalid.");
    }

    if (prepared.data.cleanup_mode === "none") {
      return Response.json({ attachmentId, status: "removed" });
    }

    const admin = getSupabaseAdminClient();
    const reference = await getAssignmentAttachmentStorageReference(
      admin,
      attachmentId,
    );
    assertAssignmentAttachmentStorageReference(reference, {
      attachmentId,
      purpose: "submission",
      status:
        prepared.data.cleanup_mode === "cancel_upload"
          ? "pending_upload"
          : "pending_delete",
    });

    try {
      await removePhysicalObject(reference);
    } catch (error) {
      captureServerException(error, {
        attachmentId,
        operation: "submission_attachment_remove_storage",
        route: "/api/submission-attachments/[attachmentId]",
      });
      return jsonError("Submission file cleanup is incomplete. Please retry.", 500);
    }

    const transition =
      prepared.data.cleanup_mode === "cancel_upload"
        ? "cancel_assignment_attachment_upload_server"
        : "finalize_assignment_attachment_removal_server";
    let finalized = await admin.rpc(transition, {
      p_attachment_id: attachmentId,
    });
    if (finalized.error) {
      finalized = await admin.rpc(transition, {
        p_attachment_id: attachmentId,
      });
    }

    if (
      finalized.error ||
      !finalized.data ||
      (finalized.data as { status?: unknown }).status !== "removed"
    ) {
      throw finalized.error ?? new Error("Removal finalization response is invalid.");
    }

    return Response.json({ attachmentId, status: "removed" });
  } catch (error) {
    if (error instanceof Error && error.message === "Authentication required.") {
      return jsonError("Authentication required.", 401);
    }

    captureServerException(error, {
      attachmentId: attachmentId || undefined,
      operation: "submission_attachment_remove_unexpected",
      route: "/api/submission-attachments/[attachmentId]",
    });
    return jsonError("Submission file could not be removed. Please retry.", 500);
  }
}
