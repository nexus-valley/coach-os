# Document Center

Module 59 adds a secure Document Center foundation for CoachFort. It stores
document metadata, reference links, linked entities, visibility flags, and
activity logs. It does not implement private file upload or Supabase Storage
download behavior yet.

## Routes

- `/app/documents`: tenant document center for owners and admins.
- `/portal/documents`: student-facing document list and detail view.

## Storage Approach

Module 59 was metadata-only. Module 63 adds private Supabase Storage upload and
signed-download support through server-only API routes. The Document Center still
supports metadata-only records and external references.

The data model supports future storage references:

- `file_name`
- `file_mime_type`
- `file_size_bytes`
- `storage_bucket`
- `storage_path`
- `external_url`
- `upload_status`

Private uploads use the `coachfort-documents` private bucket. Downloads are
served through short-lived signed URLs only after authorization.

## Document Types

- `student`: student-specific files such as admission forms, progress reports,
  and fee-related references.
- `course`: syllabus, study material, timetables, and reading material.
- `cohort`: batch timetables and cohort-specific references.
- `session`: class notes, worksheets, or recording references.
- `internal`: policies, SOPs, and staff handover references.
- `compliance`: legal, tax, audit, and compliance references.
- `general`: tenant-level document references that are not tied to a specific
  entity.

## Access Model

Owner/admin:

- Full tenant document metadata access.
- Create, update, archive, and view activity logs.
- Manage student/trainer/staff visibility flags.

Staff:

- Blocked from `/app/documents` in Module 59.
- Database helpers support limited future staff-visible internal/general reads,
  but no route is exposed yet.

Trainer:

- Blocked from `/app/documents` in Module 59.
- Database helpers support future trainer-visible course/cohort/session reads
  only when the trainer is assigned to that scope.

Student:

- Can access `/portal/documents`.
- Can see only active documents explicitly marked `student_visible = true` and
  linked to their own student record, enrolled course, cohort, or eligible
  session.
- Cannot create, update, archive, or see internal/compliance documents.

Public/anon:

- No document access.

Platform:

- No platform console document visibility. A platform user must also be a tenant
  member with the right tenant role to access tenant documents.

## Data Model

`document_records` stores tenant-scoped document metadata and visibility:

- tenant, document type, title, description, category
- linked student/course/cohort/session/team member
- file/reference metadata
- upload status
- visibility scope and visibility flags
- active/archived status
- metadata JSON
- created/updated/archive audit fields

`document_activity_logs` stores safe activity events:

- document created
- document updated
- document archived
- document viewed
- document reference opened
- document visibility changed

Activity metadata intentionally excludes document contents, storage paths,
external URLs, long descriptions, and private note bodies.

## RPCs

Team:

- `get_document_center_dashboard(p_tenant_id)`
- `get_document_detail(p_document_id)`
- `create_document_record(...)`
- `update_document_record(...)`
- `archive_document_record(p_document_id)`

Student:

- `get_student_documents()`
- `get_student_document_detail(p_document_id)`

Shared:

- `record_document_view(p_document_id)`

All writes are through SECURITY DEFINER RPCs. Direct authenticated
insert/update/delete is revoked for document tables.

## RLS Model

- RLS is enabled on all document tables.
- `anon` has no table privileges.
- Direct table writes are revoked from `authenticated`.
- Direct `document_records` select is owner/admin-only to avoid exposing raw
  storage paths or metadata columns to students or scoped team users.
- Student and scoped team reads use SECURITY DEFINER RPCs that return controlled
  JSON only.
- `document_activity_logs` direct select is owner/admin-only.

## Validation

RPCs validate:

- title required, max 180
- description max 1000
- category max 80
- file name max 240
- external URL must be HTTPS
- file size non-negative
- allowlisted document type, upload status, visibility scope, and status
- linked entities belong to the same tenant
- document type and linked entity compatibility
- metadata JSON is an object and max 3000 characters
- text rejects HTML-like `<` and `>`

## UI Behavior

Internal `/app/documents` shows:

- overview cards
- search/type/status filters
- document list
- detail panel
- create/edit metadata form
- visibility flags
- file/reference metadata
- activity timeline
- archive action

Student `/portal/documents` shows:

- shared document list
- selected document detail
- safe external reference link if present
- no edit, archive, upload, or submission controls

## Privacy Rules

Do not expose:

- document contents
- private storage paths to unauthorized users
- private external URLs to unauthorized users
- one student document to another student
- internal/compliance documents to students
- HR notes
- finance notes or payment references
- AI prompts/responses
- CRM private notes
- platform support notes

## Known Limitations

- No virus scanning yet.
- No document file versioning.
- No document versioning.
- No OCR or full-text search inside files.
- No e-signature.
- No expiry/reminder automation.
- No bulk upload.
- No export.
- No mobile upload.

## Future Roadmap

- Private Supabase Storage bucket with strict storage policies.
- Server-generated signed URLs.
- Document versioning and expiry reminders.
- Student upload/request workflow.
- Approval integration for sensitive document release.
- Workflow integration for admissions and compliance checklists.
- Mobile app document capture.
- Advanced search and tagging.
