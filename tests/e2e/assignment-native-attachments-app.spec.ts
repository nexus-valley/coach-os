import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  documentSignedUrlExpiresInSeconds,
  maxDocumentUploadBytes,
} from "../../src/lib/server/documentStorage";
import {
  assertAssignmentAttachmentStorageReference,
  isAssignmentAttachmentSafeRow,
  validateAssignmentAttachmentFile,
} from "../../src/lib/server/assignmentAttachmentStorage";
import { POST as uploadAttachment } from "../../app/api/assignments/[assignmentId]/attachments/route";
import { POST as downloadAttachment } from "../../app/api/assignment-attachments/[attachmentId]/download/route";
import { DELETE as removeAttachment } from "../../app/api/assignment-attachments/[attachmentId]/route";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const uploadRoute = read(
  "app/api/assignments/[assignmentId]/attachments/route.ts",
);
const downloadRoute = read(
  "app/api/assignment-attachments/[attachmentId]/download/route.ts",
);
const removeRoute = read(
  "app/api/assignment-attachments/[attachmentId]/route.ts",
);
const serverStorage = read("src/lib/server/assignmentAttachmentStorage.ts");
const clientStorage = read("src/lib/assignmentAttachments.ts");
const panel = read(
  "src/components/assignments/AssignmentAttachmentPanel.tsx",
);
const coachDetail = read(
  "src/components/assignments/AssignmentDetailClient.tsx",
);
const studentDetail = read(
  "src/components/portal/StudentPortalAssignmentDetail.tsx",
);

function indexOfOrFail(source: string, text: string) {
  const index = source.indexOf(text);
  expect(index, `Expected source to contain ${text}`).toBeGreaterThanOrEqual(0);
  return index;
}

test.describe("UX-6F1 assignment attachment application boundary", () => {
  test("denies unauthenticated attachment routes before privileged work", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const context = { params: Promise.resolve({ assignmentId: id }) };
    const uploadResponse = await uploadAttachment(
      new Request(`http://localhost/api/assignments/${id}/attachments`, {
        method: "POST",
      }),
      context,
    );
    const downloadResponse = await downloadAttachment(
      new Request(
        `http://localhost/api/assignment-attachments/${id}/download`,
        { method: "POST" },
      ),
      { params: Promise.resolve({ attachmentId: id }) },
    );
    const removeResponse = await removeAttachment(
      new Request(`http://localhost/api/assignment-attachments/${id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ attachmentId: id }) },
    );

    expect(uploadResponse.status).toBe(401);
    expect(downloadResponse.status).toBe(401);
    expect(removeResponse.status).toBe(401);
  });

  test("reuses private-file validation and rejects unsafe or mismatched files", async () => {
    const validPdf = new File(
      [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
      "lesson.pdf",
      { type: "application/pdf" },
    );
    await expect(validateAssignmentAttachmentFile(validPdf)).resolves.toEqual(
      expect.objectContaining({ safeFileName: "lesson.pdf" }),
    );

    const mismatch = new File(
      [new Uint8Array([0x25, 0x50, 0x44, 0x46])],
      "lesson.png",
      { type: "image/png" },
    );
    await expect(validateAssignmentAttachmentFile(mismatch)).rejects.toThrow(
      /content/i,
    );

    const traversal = new File(
      [new Uint8Array([0x25, 0x50, 0x44, 0x46])],
      "../lesson.pdf",
      { type: "application/pdf" },
    );
    await expect(validateAssignmentAttachmentFile(traversal)).rejects.toThrow(
      /name/i,
    );
  });

  test("keeps the shared 10 MB limit and approved MIME path", () => {
    expect(maxDocumentUploadBytes).toBe(10 * 1024 * 1024);
    expect(serverStorage).toContain("validateDocumentFile(file)");
    expect(serverStorage).toContain("documentStorageBucket");
    expect(uploadRoute).toContain("validateAssignmentAttachmentFile(file)");
    expect(uploadRoute).toContain("maxDocumentUploadBytes");
    expect(uploadRoute).toContain("413");
    expect(uploadRoute).toContain("415");
  });

  test("validates safe descriptors and authoritative private paths at runtime", () => {
    expect(
      isAssignmentAttachmentSafeRow({
        byte_size: 512,
        created_at: "2026-08-26T10:00:00.000Z",
        display_file_name: "lesson.pdf",
        id: "11111111-1111-4111-8111-111111111111",
        mime_type: "application/pdf",
        status: "uploaded",
        uploaded_at: "2026-08-26T10:01:00.000Z",
      }),
    ).toBe(true);
    expect(
      isAssignmentAttachmentSafeRow({
        byte_size: 512,
        created_at: "2026-08-26T10:00:00.000Z",
        display_file_name: "lesson.pdf",
        id: "unsafe",
        mime_type: "application/pdf",
        status: "uploaded",
        uploaded_at: "2026-08-26T10:01:00.000Z",
      }),
    ).toBe(false);

    const reference = {
      bucket_name: "coachfort-documents",
      byte_size: 512,
      display_file_name: "lesson.pdf",
      id: "11111111-1111-4111-8111-111111111111",
      mime_type: "application/pdf",
      object_path:
        "tenant/22222222-2222-4222-8222-222222222222/assignments/33333333-3333-4333-8333-333333333333/attachments/11111111-1111-4111-8111-111111111111/lesson.pdf",
      status: "uploaded" as const,
    };
    expect(() =>
      assertAssignmentAttachmentStorageReference(reference, {
        assignmentId: "33333333-3333-4333-8333-333333333333",
        attachmentId: reference.id,
        byteSize: 512,
        displayFileName: "lesson.pdf",
        mimeType: "application/pdf",
        status: "uploaded",
      }),
    ).not.toThrow();
    expect(() =>
      assertAssignmentAttachmentStorageReference(
        { ...reference, bucket_name: "public-files" },
        { attachmentId: reference.id, status: "uploaded" },
      ),
    ).toThrow(/reference is invalid/i);
  });

  test("authenticates then prepares, resolves authoritative storage, uploads, and finalizes", () => {
    const auth = indexOfOrFail(uploadRoute, "requireAuthenticatedUser(accessToken)");
    const prepare = indexOfOrFail(
      uploadRoute,
      '"prepare_assignment_attachment_upload_secure"',
    );
    const reference = indexOfOrFail(
      uploadRoute,
      "getAssignmentAttachmentStorageReference(admin, plan.id)",
    );
    const upload = indexOfOrFail(
      uploadRoute,
      ".upload(reference.object_path, file",
    );
    const finalize = indexOfOrFail(
      uploadRoute,
      '"finalize_assignment_attachment_upload_server"',
    );

    expect(auth).toBeLessThan(prepare);
    expect(prepare).toBeLessThan(reference);
    expect(reference).toBeLessThan(upload);
    expect(upload).toBeLessThan(finalize);
    expect(uploadRoute).toContain('formData.getAll("file")');
    expect(uploadRoute).not.toContain("p_tenant_id");
    expect(uploadRoute).not.toContain("p_bucket");
    expect(uploadRoute).not.toContain("p_object_path");
  });

  test("compensates incomplete uploads without direct metadata writes", () => {
    expect(uploadRoute).toContain("compensateUpload");
    expect(uploadRoute).toContain("objectWriteAttempted");
    expect(uploadRoute).toContain("assignment_attachment_upload_compensation_storage");
    expect(uploadRoute).toContain('"cancel_assignment_attachment_upload_server"');
    expect(uploadRoute).toContain("if (!storageClean)");
    expect(uploadRoute).toContain("if (latest.status === \"uploaded\")");
    expect(uploadRoute).toContain("finalizeAttempted");
    expect(
      uploadRoute.match(/finalize_assignment_attachment_upload_server/g),
    ).toHaveLength(2);
    expect(uploadRoute).toContain('status: "uploaded"');
    expect(uploadRoute).toContain("reference = latest");
    expect(uploadRoute).not.toMatch(/\.from\(["']assignment_attachments["']\)/);
    expect(uploadRoute).not.toMatch(/\.from\([^)]+\)\s*\.update\(/);
  });

  test("authorizes downloads before service lookup and creates only 120-second URLs", () => {
    const authorize = indexOfOrFail(
      downloadRoute,
      '"authorize_assignment_attachment_download_secure"',
    );
    const reference = indexOfOrFail(
      downloadRoute,
      "getAssignmentAttachmentStorageReference(",
    );
    const signed = indexOfOrFail(downloadRoute, ".createSignedUrl(");

    expect(authorize).toBeLessThan(reference);
    expect(reference).toBeLessThan(signed);
    expect(documentSignedUrlExpiresInSeconds).toBe(120);
    expect(downloadRoute).toContain("documentSignedUrlExpiresInSeconds");
    expect(downloadRoute).toContain('"Cache-Control": "private, no-store, max-age=0"');
    expect(clientStorage).not.toMatch(/objectPath|object_path|bucketName|bucket_name/);
    expect(clientStorage).toContain('url.protocol !== "https:"');
    expect(clientStorage).toContain('url.protocol !== "http:"');
  });

  test("uses the authoritative removal plan for all recovery modes", () => {
    const prepare = indexOfOrFail(
      removeRoute,
      '"prepare_assignment_attachment_removal_secure"',
    );
    const reference = indexOfOrFail(
      removeRoute,
      "getAssignmentAttachmentStorageReference(",
    );
    const physical = indexOfOrFail(removeRoute, "await removePhysicalObject(reference)");
    const transition = indexOfOrFail(removeRoute, "const transition =");

    expect(prepare).toBeLessThan(reference);
    expect(reference).toBeLessThan(physical);
    expect(physical).toBeLessThan(transition);
    expect(removeRoute).toContain('cleanup_mode === "none"');
    expect(removeRoute).toContain('cleanup_mode === "cancel_upload"');
    expect(removeRoute).toContain('"cancel_assignment_attachment_upload_server"');
    expect(removeRoute).toContain('"finalize_assignment_attachment_removal_server"');
    expect(removeRoute).toContain(
      "Assignment file removal is incomplete. Please retry.",
    );
  });

  test("keeps storage and assignment attachment table writes off the browser", () => {
    expect(clientStorage).not.toContain(".storage");
    expect(clientStorage).not.toMatch(
      /\.from\(["']assignment_attachments["']\)/,
    );
    expect(panel).not.toContain("getSupabaseClient");
    expect(panel).not.toContain(".storage");
    expect(panel).not.toContain(".insert(");
    expect(panel).not.toContain(".update(");
    expect(panel).not.toContain(".delete(");
  });

  test("preserves external links and adds one shared native-file panel", () => {
    expect(panel).toContain("getSafeStudentAttachmentUrls(legacyUrls)");
    expect(panel).toContain("Native files");
    expect(panel).toContain("External links");
    expect(panel).toContain("External link {index + 1}");
    expect(coachDetail).toContain("<AssignmentAttachmentPanel");
    expect(coachDetail).toContain("legacyUrls={assignment.attachment_urls_json}");
    expect(studentDetail).toContain("<AssignmentAttachmentPanel");
    expect(studentDetail).toContain(
      "legacyUrls={detail.assignment.attachment_urls_json}",
    );
  });

  test("keeps closed and Student attachment surfaces read-only", () => {
    expect(panel).toContain(
      'const canChangeFiles = canManage && assignmentStatus !== "closed"',
    );
    expect(panel).toContain(
      'attachment.status === "uploaded" || canChangeFiles',
    );
    expect(studentDetail).toContain("canManage={false}");
    expect(studentDetail).not.toContain("uploadAssignmentAttachment");
    expect(studentDetail).not.toContain("removeAssignmentAttachment");
    expect(panel).toContain('attachment.status === "uploaded"');
    expect(panel).toContain("getAssignmentAttachmentDownloadUrl");
  });

  test("renders manager recovery states and accessible mobile-safe actions", () => {
    expect(panel).toContain("Upload incomplete");
    expect(panel).toContain("Removal incomplete");
    expect(panel).toContain("Retry removal");
    expect(panel).toContain("aria-modal=\"true\"");
    expect(panel).toContain("aria-live=\"polite\"");
    expect(panel).toContain("sm:flex-row");
    expect(panel).toContain("break-words");
    expect(panel).toContain("multiple");
    expect(panel).toContain("disabled={controlsBusy || attachments.length >= 10}");
    expect(panel).toContain("loading || uploading || removing || Boolean(removalTarget)");
  });
});
