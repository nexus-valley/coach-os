import {
  documentStorageBucket,
  getBearerToken,
  getUserScopedSupabase,
  requireAuthenticatedUser,
  validateDocumentFile,
  type PreparedUpload,
} from "@/src/lib/server/documentStorage";
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
    const formData = await request.formData();
    const documentId = formData.get("documentId");
    const file = formData.get("file");

    if (typeof documentId !== "string" || !documentId) {
      return jsonError("Document id is required.");
    }

    if (!(file instanceof File)) {
      return jsonError("File is required.");
    }

    const { safeFileName } = await validateDocumentFile(file);
    const prepare = await supabase.rpc("prepare_document_file_upload", {
      p_document_id: documentId,
      p_file_mime_type: file.type,
      p_file_name: safeFileName,
      p_file_size_bytes: file.size,
    });

    if (prepare.error) {
      return jsonError(prepare.error.message, 403);
    }

    const uploadPlan = prepare.data as PreparedUpload;

    if (
      uploadPlan.storage_bucket !== documentStorageBucket ||
      !uploadPlan.storage_path
    ) {
      return jsonError("Storage target is invalid.");
    }

    const admin = getSupabaseAdminClient();
    const upload = await admin.storage
      .from(uploadPlan.storage_bucket)
      .upload(uploadPlan.storage_path, file, {
        cacheControl: "private, max-age=0, no-store",
        contentType: file.type,
        upsert: true,
      });

    if (upload.error) {
      return jsonError(upload.error.message, 500);
    }

    const markUploaded = await supabase.rpc("mark_document_file_uploaded", {
      p_document_id: documentId,
      p_file_mime_type: file.type,
      p_file_name: uploadPlan.file_name,
      p_file_size_bytes: file.size,
      p_storage_bucket: uploadPlan.storage_bucket,
      p_storage_path: uploadPlan.storage_path,
    });

    if (markUploaded.error) {
      await admin.storage
        .from(uploadPlan.storage_bucket)
        .remove([uploadPlan.storage_path]);
      return jsonError(markUploaded.error.message, 500);
    }

    if (
      uploadPlan.previous_storage_bucket === uploadPlan.storage_bucket &&
      uploadPlan.previous_storage_path &&
      uploadPlan.previous_storage_path !== uploadPlan.storage_path
    ) {
      await admin.storage
        .from(uploadPlan.previous_storage_bucket)
        .remove([uploadPlan.previous_storage_path]);
    }

    return Response.json({
      documentId,
      fileName: uploadPlan.file_name,
      fileMimeType: file.type,
      fileSizeBytes: file.size,
      uploadStatus: "uploaded",
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to upload document.",
      500,
    );
  }
}
