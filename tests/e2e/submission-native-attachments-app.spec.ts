import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { POST as uploadSubmissionAttachment } from "../../app/api/assignments/[assignmentId]/submission-attachments/route";
import { POST as downloadSubmissionAttachment } from "../../app/api/submission-attachments/[attachmentId]/download/route";
import { DELETE as removeSubmissionAttachment } from "../../app/api/submission-attachments/[attachmentId]/route";
import {
  assertAssignmentAttachmentStorageReference,
  validateAssignmentAttachmentFile,
} from "../../src/lib/server/assignmentAttachmentStorage";
import {
  deriveSubmissionAttachmentSelection,
  normalizeSubmissionAttachmentDescriptor,
  toggleSubmissionAttachmentSelection,
  type SubmissionAttachment,
} from "../../src/lib/submissionAttachmentModel";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const uploadRoute = read(
  "app/api/assignments/[assignmentId]/submission-attachments/route.ts",
);
const removeRoute = read(
  "app/api/submission-attachments/[attachmentId]/route.ts",
);
const downloadRoute = read(
  "app/api/submission-attachments/[attachmentId]/download/route.ts",
);
const storageHelper = read("src/lib/server/assignmentAttachmentStorage.ts");
const clientHelper = read("src/lib/submissionAttachments.ts");
const studentPanel = read(
  "src/components/portal/StudentSubmissionAttachmentPanel.tsx",
);
const studentDetail = read(
  "src/components/portal/StudentPortalAssignmentDetail.tsx",
);
const studentAssignments = read("src/lib/studentPortalAssignments.ts");
const reviewerPanel = read(
  "src/components/assignments/SubmissionAttachmentReviewPanel.tsx",
);
const coachDetail = read(
  "src/components/assignments/AssignmentDetailClient.tsx",
);

function indexOfOrFail(source: string, text: string) {
  const index = source.indexOf(text);
  expect(index, `Expected source to contain ${text}`).toBeGreaterThanOrEqual(0);
  return index;
}

test.describe("UX-6F2 submission native attachment application boundary", () => {
  test("denies all submission attachment routes before privileged work", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const upload = await uploadSubmissionAttachment(
      new Request(
        `http://localhost/api/assignments/${id}/submission-attachments`,
        { method: "POST" },
      ),
      { params: Promise.resolve({ assignmentId: id }) },
    );
    const download = await downloadSubmissionAttachment(
      new Request(`http://localhost/api/submission-attachments/${id}/download`, {
        method: "POST",
      }),
      { params: Promise.resolve({ attachmentId: id }) },
    );
    const remove = await removeSubmissionAttachment(
      new Request(`http://localhost/api/submission-attachments/${id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ attachmentId: id }) },
    );

    expect(upload.status).toBe(401);
    expect(download.status).toBe(401);
    expect(remove.status).toBe(401);
  });

  test("reuses exact private-document file validation", async () => {
    const pdf = new File(
      [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
      "submission.pdf",
      { type: "application/pdf" },
    );
    await expect(validateAssignmentAttachmentFile(pdf)).resolves.toEqual(
      expect.objectContaining({ safeFileName: "submission.pdf" }),
    );

    const activeContent = new File(
      [new TextEncoder().encode("<svg></svg>")],
      "submission.svg",
      { type: "image/svg+xml" },
    );
    await expect(
      validateAssignmentAttachmentFile(activeContent),
    ).rejects.toThrow();

    expect(uploadRoute).toContain("maxDocumentUploadBytes");
    expect(uploadRoute).toContain("multipartAllowanceBytes");
    expect(uploadRoute).toContain("validateAssignmentAttachmentFile(file)");
    expect(uploadRoute).toContain("upsert: false");
  });

  test("validates submission-purpose paths without weakening assignment paths", () => {
    const reference = {
      bucket_name: "coachfort-documents",
      byte_size: 1024,
      display_file_name: "submission.pdf",
      id: "11111111-1111-4111-8111-111111111111",
      mime_type: "application/pdf",
      object_path:
        "tenant/22222222-2222-4222-8222-222222222222/assignments/33333333-3333-4333-8333-333333333333/submissions/44444444-4444-4444-8444-444444444444/attachments/11111111-1111-4111-8111-111111111111/submission.pdf",
      status: "uploaded" as const,
    };

    expect(() =>
      assertAssignmentAttachmentStorageReference(reference, {
        assignmentId: "33333333-3333-4333-8333-333333333333",
        attachmentId: reference.id,
        purpose: "submission",
        status: "uploaded",
        studentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).not.toThrow();
    expect(() =>
      assertAssignmentAttachmentStorageReference(reference, {
        attachmentId: reference.id,
        status: "uploaded",
      }),
    ).toThrow(/reference is invalid/i);
    expect(storageHelper).toContain('purpose === "assignment"');
    expect(storageHelper).toContain('purpose === "submission"');
  });

  test("authenticates, prepares, resolves authoritative storage, uploads, and finalizes in order", () => {
    const auth = indexOfOrFail(uploadRoute, "requireAuthenticatedUser(accessToken)");
    const prepare = indexOfOrFail(
      uploadRoute,
      '"prepare_submission_attachment_upload_secure"',
    );
    const reference = uploadRoute.indexOf(
      "getAssignmentAttachmentStorageReference(",
      prepare,
    );
    expect(reference).toBeGreaterThanOrEqual(0);
    const upload = indexOfOrFail(uploadRoute, ".upload(reference.object_path, file");
    const finalize = indexOfOrFail(
      uploadRoute,
      '"finalize_assignment_attachment_upload_server"',
    );

    expect(auth).toBeLessThan(prepare);
    expect(prepare).toBeLessThan(reference);
    expect(reference).toBeLessThan(upload);
    expect(upload).toBeLessThan(finalize);
    expect(uploadRoute).not.toMatch(/p_(?:tenant|student|submission|bucket|object_path)/);
    expect(uploadRoute).toContain('purpose: "submission"');
    expect(uploadRoute).toContain('prepared.data.status !== "pending_upload"');
  });

  test("preserves finalize ambiguity and compensation safety", () => {
    expect(uploadRoute).toContain("compensateUpload");
    expect(uploadRoute).toContain("finalizeAttempted");
    expect(uploadRoute).toContain("objectWriteAttempted");
    expect(uploadRoute).toContain('latest.status === "uploaded"');
    expect(uploadRoute).toContain('status: "pending_upload"');
    expect(uploadRoute).toContain('"cancel_assignment_attachment_upload_server"');
    expect(
      uploadRoute.match(/finalize_assignment_attachment_upload_server/g),
    ).toHaveLength(2);
    expect(uploadRoute).not.toMatch(/\.from\(["']assignment_attachments["']\)/);
  });

  test("uses authoritative removal modes and authorizes before download storage access", () => {
    const prepare = indexOfOrFail(
      removeRoute,
      '"prepare_submission_attachment_removal_secure"',
    );
    const physical = indexOfOrFail(removeRoute, "await removePhysicalObject(reference)");
    const transition = indexOfOrFail(removeRoute, "const transition =");
    expect(prepare).toBeLessThan(physical);
    expect(physical).toBeLessThan(transition);
    expect(removeRoute).toContain('cleanup_mode === "none"');
    expect(removeRoute).toContain('cleanup_mode === "cancel_upload"');
    expect(removeRoute).toContain(
      '"finalize_assignment_attachment_removal_server"',
    );

    const authorize = indexOfOrFail(
      downloadRoute,
      '"authorize_submission_attachment_download_secure"',
    );
    const serviceReference = indexOfOrFail(
      downloadRoute,
      "getAssignmentAttachmentStorageReference(",
    );
    expect(authorize).toBeLessThan(serviceReference);
    expect(downloadRoute).toContain("documentSignedUrlExpiresInSeconds");
    expect(downloadRoute).toContain(
      '"Cache-Control": "private, no-store, max-age=0"',
    );
    expect(downloadRoute).toContain('authorized.error.code === "42501"');
    expect(downloadRoute).toMatch(
      /authorized\.error\.code === "PGRST116" \|\|\s*authorized\.error\.code === "42501"[\s\S]*jsonError\("Submission file is unavailable\.", 404\)/,
    );
    expect(downloadRoute).not.toContain(
      'jsonError("Submission file is unavailable.", 403)',
    );
    expect(downloadRoute).toContain(
      '"Submission file could not be authorized.", 500',
    );
  });

  test("rejects malformed workspace descriptors at runtime", () => {
    expect(
      normalizeSubmissionAttachmentDescriptor({
        byte_size: 1024,
        created_at: "2026-08-26T10:00:00.000Z",
        display_file_name: "submission.pdf",
        id: "11111111-1111-4111-8111-111111111111",
        is_associated: true,
        mime_type: "application/pdf",
        status: "uploaded",
        uploaded_at: "2026-08-26T10:01:00.000Z",
      }),
    ).toMatchObject({ isAssociated: true, status: "uploaded" });
    expect(() =>
      normalizeSubmissionAttachmentDescriptor({
        byte_size: 1024,
        created_at: null,
        display_file_name: "submission.pdf",
        id: "not-a-uuid",
        mime_type: "application/pdf",
        status: "uploaded",
        uploaded_at: null,
      }),
    ).toThrow(/could not be loaded/i);
    expect(() =>
      normalizeSubmissionAttachmentDescriptor({
        byte_size: 1024,
        created_at: "not-a-timestamp",
        display_file_name: "submission.pdf",
        id: "11111111-1111-4111-8111-111111111111",
        is_associated: false,
        mime_type: "application/pdf",
        status: "uploaded",
        uploaded_at: null,
      }),
    ).toThrow(/could not be loaded/i);
    expect(clientHelper).toContain(
      '"get_student_submission_attachments_secure"',
    );
    expect(clientHelper).not.toMatch(/\.from\(["']assignment_attachments["']\)/);
  });

  test("derives, deselects, and reselects the complete desired set", () => {
    const attachment = (
      id: string,
      status: SubmissionAttachment["status"],
      isAssociated: boolean,
    ): SubmissionAttachment => ({
      byteSize: 1024,
      createdAt: "2026-08-26T10:00:00.000Z",
      displayFileName: `${id}.pdf`,
      id,
      isAssociated,
      mimeType: "application/pdf",
      status,
      uploadedAt:
        status === "uploaded" ? "2026-08-26T10:01:00.000Z" : null,
    });
    const associatedId = "11111111-1111-4111-8111-111111111111";
    const stagedId = "22222222-2222-4222-8222-222222222222";
    const pendingUploadId = "33333333-3333-4333-8333-333333333333";
    const pendingDeleteId = "44444444-4444-4444-8444-444444444444";
    const workspace = [
      attachment(associatedId, "uploaded", true),
      attachment(stagedId, "uploaded", false),
      attachment(pendingUploadId, "pending_upload", false),
      attachment(pendingDeleteId, "pending_delete", false),
    ];

    const initial = deriveSubmissionAttachmentSelection({
      attachments: workspace,
      mode: "canonical",
    });
    expect(initial).toEqual([associatedId, stagedId]);
    const deselected = toggleSubmissionAttachmentSelection({
      attachmentId: associatedId,
      selected: false,
      selectedIds: initial,
    });
    expect(deselected).toEqual([stagedId]);
    expect(
      toggleSubmissionAttachmentSelection({
        attachmentId: associatedId,
        selected: true,
        selectedIds: deselected,
      }),
    ).toEqual([associatedId, stagedId]);
  });

  test("submits the complete selected set and keeps cleanup best effort", () => {
    expect(studentAssignments).toContain(
      "p_native_attachment_ids: params.nativeAttachmentIds",
    );
    expect(studentDetail).toContain(
      "nativeAttachmentIds: selectedNativeAttachmentIds",
    );
    expect(studentPanel).toContain("deriveSubmissionAttachmentSelection");
    expect(studentPanel).toContain("getAssociatedSubmissionAttachmentIds");
    expect(studentPanel).toContain("Keep with submission");
    expect(studentPanel).toContain("Will be removed on resubmit");
    expect(studentDetail).toContain("selectedNativeAttachmentIds.length > 10");
    expect(studentDetail).toContain("mutationsDisabled={submitting}");
    expect(studentDetail).toContain("refreshAfterSubmit()");
    expect(studentDetail).toContain("Some file cleanup is incomplete");
    expect(studentDetail).toContain(
      "const savedSubmission = await submitStudentAssignment",
    );
    expect(studentDetail).toContain(
      "setDetail({ ...detail, submission: savedSubmission })",
    );
    expect(studentDetail.indexOf("await submitStudentAssignment")).toBeLessThan(
      studentDetail.indexOf("refreshAfterSubmit()"),
    );
  });

  test("keeps closed history read-only while preserving recovery and downloads", () => {
    expect(studentDetail).toContain("canSubmit={view.canSubmit}");
    expect(studentPanel).toContain("{canSubmit ? (");
    expect(studentPanel).toContain("attachment.status !== \"uploaded\" || canSubmit");
    expect(studentPanel).toContain("getSubmissionAttachmentDownloadUrl");
    expect(studentPanel).toContain("Retry cleanup");
    expect(studentPanel).not.toContain("getSupabaseClient");
    expect(studentPanel).not.toContain(".storage");
  });

  test("loads reviewer files lazily for one submission and isolates failures", () => {
    expect(coachDetail).toContain("<SubmissionAttachmentReviewPanel");
    expect(coachDetail).toContain("submissionId={selectedItem.submission.id}");
    expect(reviewerPanel).toMatch(
      /getSubmissionAttachmentsForReview\(\s*assignmentId,\s*submissionId,?\s*\)/,
    );
    expect(reviewerPanel).toContain("Submission files could not be loaded.");
    expect(reviewerPanel).toContain("Retry files");
    expect(reviewerPanel).toContain("requestVersionRef.current === requestVersion");
    expect(reviewerPanel).toContain("getSubmissionAttachmentDownloadUrl");
    expect(reviewerPanel).not.toContain("getCurrentMemberRole");
    expect(reviewerPanel).not.toMatch(/\.from\(["']assignment_attachments["']\)/);
  });

  test("separates safe legacy links and provides accessible mobile-safe controls", () => {
    expect(studentDetail).toContain("External links");
    expect(studentDetail).toContain("External link {index + 1}");
    expect(reviewerPanel).toContain("getSafeStudentAttachmentUrls(legacyUrls)");
    expect(reviewerPanel).toContain('rel="noopener noreferrer"');
    expect(studentPanel).toContain("aria-busy={busy || loading}");
    expect(studentPanel).toContain("break-all");
    expect(studentPanel).toContain("sm:flex-row");
    expect(studentPanel).toContain("Choose submission files");
    expect(studentPanel).toContain("Download ${attachment.displayFileName}");
    expect(clientHelper).not.toMatch(/object_path|bucket_name/);
  });

  test("keeps direct browser table and storage writes absent", () => {
    for (const source of [clientHelper, studentPanel, reviewerPanel, studentDetail]) {
      expect(source).not.toContain(".storage");
      expect(source).not.toMatch(/\.from\(["']assignment_attachments["']\)/);
      expect(source).not.toMatch(/\.(?:insert|update|delete|upsert)\(/);
      expect(source).not.toMatch(/service[_-]?role/i);
    }
  });
});
