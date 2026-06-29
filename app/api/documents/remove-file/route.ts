import {
  documentStorageBucket,
  getBearerToken,
  getUserScopedSupabase,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import { captureServerException } from "@/src/lib/server/monitoring";
import {
  InvalidJsonPayloadError,
  parseJsonBody,
} from "@/src/lib/server/requestJson";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RemovalPlan = {
  document_id: string;
  storage_bucket: string;
  storage_path: string;
};

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function getRemoveFileErrorStatus(error: unknown) {
  if (!(error instanceof Error)) {
    return 500;
  }

  if (error.message === "Authentication required.") {
    return 401;
  }

  if (/access|permission|not enabled|denied|not allowed/i.test(error.message)) {
    return 403;
  }

  if (/required|invalid/i.test(error.message)) {
    return 400;
  }

  return 500;
}

function getRemoveFileErrorMessage(error: unknown) {
  if (error instanceof Error && error.message === "Authentication required.") {
    return error.message;
  }

  const status = getRemoveFileErrorStatus(error);

  if (status === 403) {
    return "Document file removal is not allowed.";
  }

  if (status === 400) {
    return error instanceof Error ? error.message : "Invalid document file removal request.";
  }

  return "Unable to remove document file.";
}

export async function POST(request: Request) {
  try {
    const accessToken = getBearerToken(request);
    await requireAuthenticatedUser(accessToken);
    const supabase = getUserScopedSupabase(accessToken);
    const body = await parseJsonBody<{ documentId?: unknown }>(request);
    const documentId = typeof body.documentId === "string" ? body.documentId : "";

    if (!documentId) {
      return jsonError("Document id is required.");
    }

    const prepare = await supabase.rpc("prepare_document_file_removal", {
      p_document_id: documentId,
    });

    if (prepare.error) {
      return jsonError("Document file removal is not allowed.", 403);
    }

    const removal = prepare.data as RemovalPlan;
    if (
      removal.storage_bucket !== documentStorageBucket ||
      !removal.storage_path
    ) {
      return jsonError("Storage reference is invalid.");
    }

    const admin = getSupabaseAdminClient();
    const removed = await admin.storage
      .from(removal.storage_bucket)
      .remove([removal.storage_path]);

    if (removed.error) {
      captureServerException(removed.error, {
        documentId,
        operation: "document_remove_storage_delete",
        route: "/api/documents/remove-file",
      });
      return jsonError("Unable to remove document file.", 500);
    }

    const marked = await supabase.rpc("mark_document_file_removed", {
      p_document_id: documentId,
    });

    if (marked.error) {
      captureServerException(marked.error, {
        documentId,
        operation: "document_remove_mark_removed",
        route: "/api/documents/remove-file",
      });
      return jsonError("Unable to remove document file.", 500);
    }

    return Response.json({
      documentId,
      uploadStatus: "metadata_only",
    });
  } catch (error) {
    if (error instanceof InvalidJsonPayloadError) {
      return jsonError(error.message, 400);
    }

    if (
      error instanceof Error &&
      !/auth|access|permission|required|not enabled/i.test(error.message)
    ) {
      captureServerException(error, {
        operation: "document_remove_unexpected",
        route: "/api/documents/remove-file",
      });
    }

    return jsonError(getRemoveFileErrorMessage(error), getRemoveFileErrorStatus(error));
  }
}
