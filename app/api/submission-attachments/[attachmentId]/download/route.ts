import {
  documentSignedUrlExpiresInSeconds,
  getBearerToken,
  getUserScopedSupabase,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import {
  assertAssignmentAttachmentStorageReference,
  getAssignmentAttachmentStorageReference,
  isAssignmentAttachmentSafeRow,
  isUuid,
} from "@/src/lib/server/assignmentAttachmentStorage";
import { captureServerException } from "@/src/lib/server/monitoring";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

type DownloadContext = {
  params: Promise<{ attachmentId: string }>;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request, context: DownloadContext) {
  let attachmentId = "";

  try {
    const accessToken = getBearerToken(request);
    await requireAuthenticatedUser(accessToken);
    ({ attachmentId } = await context.params);

    if (!isUuid(attachmentId)) {
      return jsonError("Attachment id is invalid.", 400);
    }

    const supabase = getUserScopedSupabase(accessToken);
    const authorized = await supabase.rpc(
      "authorize_submission_attachment_download_secure",
      { p_attachment_id: attachmentId },
    );
    if (authorized.error) {
      if (
        authorized.error.code === "02000" ||
        authorized.error.code === "PGRST116" ||
        authorized.error.code === "42501"
      ) {
        return jsonError("Submission file is unavailable.", 404);
      }
      return jsonError("Submission file could not be authorized.", 500);
    }

    if (
      !isAssignmentAttachmentSafeRow(authorized.data) ||
      authorized.data.status !== "uploaded"
    ) {
      return jsonError("Submission file is unavailable.", 404);
    }

    const admin = getSupabaseAdminClient();
    const reference = await getAssignmentAttachmentStorageReference(
      admin,
      attachmentId,
    );
    assertAssignmentAttachmentStorageReference(reference, {
      attachmentId,
      byteSize: authorized.data.byte_size,
      displayFileName: authorized.data.display_file_name,
      mimeType: authorized.data.mime_type,
      purpose: "submission",
      status: "uploaded",
    });

    const signed = await admin.storage
      .from(reference.bucket_name)
      .createSignedUrl(
        reference.object_path,
        documentSignedUrlExpiresInSeconds,
        { download: authorized.data.display_file_name },
      );
    if (signed.error || !signed.data?.signedUrl) {
      throw signed.error ?? new Error("Signed URL response is unavailable.");
    }

    return Response.json(
      {
        byteSize: authorized.data.byte_size,
        expiresInSeconds: documentSignedUrlExpiresInSeconds,
        fileName: authorized.data.display_file_name,
        mimeType: authorized.data.mime_type,
        signedUrl: signed.data.signedUrl,
      },
      { headers: privateNoStoreHeaders },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Authentication required.") {
      return jsonError("Authentication required.", 401);
    }

    captureServerException(error, {
      attachmentId: attachmentId || undefined,
      operation: "submission_attachment_download_unexpected",
      route: "/api/submission-attachments/[attachmentId]/download",
    });
    return jsonError("Submission file could not be opened.", 500);
  }
}
