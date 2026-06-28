# Secure Document Upload & Storage

Module 63 adds private file upload and signed-download support to the Module 59 Document Center.

## Bucket

Bucket name:

- `coachfort-documents`

The bucket must remain private:

- no public bucket
- no permanent public URLs
- no unauthenticated storage access

## Storage Path

Files are stored under a tenant and document scoped path:

```text
tenant/{tenant_id}/documents/{document_id}/{safe_file_name}
```

The path includes both `tenant_id` and `document_id`. File names are sanitized and path traversal is rejected.

## File Limits

Initial allowed types:

- PDF
- PNG
- JPG/JPEG
- DOC/DOCX
- XLS/XLSX

Blocked by default:

- EXE
- JS
- HTML
- SVG
- ZIP, except Office Open XML formats validated as DOCX/XLSX

Maximum file size:

- 10 MB

The server checks file extension, MIME type, size, and basic file signature bytes. Full malware/virus scanning is future work.

## API Routes

- `POST /api/documents/upload`
- `POST /api/documents/download-url`
- `POST /api/documents/remove-file`

All routes require an authenticated Supabase bearer token. The browser never receives a service-role key.

## Authorization Model

Upload/remove:

- owner/admin only
- document must belong to the tenant
- document must be active
- `documents` feature must be enabled
- `document_uploads` feature must be enabled

Download:

- team users must pass existing document access checks
- students must pass existing student document visibility checks
- students can access only their own visible active documents
- internal/compliance/general private documents are not student-downloadable
- the API obtains bucket/path through `get_authorized_document_storage_reference()` after authorization
- helper functions remain private; normal users do not get broad helper execution grants

## Signed URLs

Downloads use short-lived signed URLs generated server-side after authorization.

Default lifetime:

- 120 seconds

Signed URLs, storage paths, and service-role credentials are not stored in activity/audit metadata.
The API response includes the signed URL and safe file metadata only; it does not return `storage_bucket` or `storage_path` to the browser.

## Activity / Audit Logging

Logged actions:

- `document_file_upload_prepared`
- `document_file_uploaded`
- `document_file_replaced`
- `document_file_removed`
- `document_download_url_requested`
- `document_download_unauthorized`

Metadata includes safe file facts such as file name, MIME type, size, actor type, and presence flags. It must not include signed URLs, service-role keys, file contents, or raw long storage paths.

## Feature Access

Module 62 controls this module:

- `documents`: controls Document Center route visibility.
- `document_uploads`: controls upload/remove actions.

If `document_uploads` is disabled, locked, or coming soon, upload controls are hidden/locked and the upload API rejects requests.

## Known Limitations

- No virus scanning yet.
- No file version history.
- No bulk upload.
- No student upload/submission workflow.
- No automated orphan-file cleanup job.
- No retention/expiry policy enforcement.
- No mobile camera capture flow.

## Future Roadmap

- Virus/malware scanning before marking uploads complete.
- Versioned document files.
- Student submission/request workflows.
- Scheduled cleanup for orphaned storage objects.
- Expiry reminders for compliance documents.
- Preview thumbnails for images/PDFs.
