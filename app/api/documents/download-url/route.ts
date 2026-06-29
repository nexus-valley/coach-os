import {
  assertValidStorageReference,
  documentSignedUrlExpiresInSeconds,
  getAuthorizedDocumentStorageReference,
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

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
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

    const row = await getAuthorizedDocumentStorageReference(supabase, documentId);
    assertValidStorageReference(row);

    const admin = getSupabaseAdminClient();
    const signed = await admin.storage
      .from(row.storage_bucket!)
      .createSignedUrl(row.storage_path!, documentSignedUrlExpiresInSeconds, {
        download: row.file_name ?? true,
      });

    if (signed.error || !signed.data?.signedUrl) {
      captureServerException(signed.error ?? new Error("Missing signed URL"), {
        documentId,
        operation: "document_download_signed_url",
        route: "/api/documents/download-url",
      });
      return jsonError(signed.error?.message ?? "Unable to create signed URL.", 500);
    }

    await supabase.rpc("record_document_download_url_requested", {
      p_document_id: documentId,
    });

    return Response.json({
      expiresInSeconds: documentSignedUrlExpiresInSeconds,
      fileMimeType: row.file_mime_type,
      fileName: row.file_name,
      signedUrl: signed.data.signedUrl,
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
        operation: "document_download_unexpected",
        route: "/api/documents/download-url",
      });
    }

    return jsonError(
      error instanceof Error ? error.message : "Unable to create download URL.",
      403,
    );
  }
}
