# Institute HR / Team Operations

Module 58 adds an institute-level Team Operations foundation for CoachFort. It helps academy owners and admins maintain operational team profiles, workload visibility, lifecycle status, and internal notes without replacing the core authentication and RBAC model.

## Purpose

Team Operations is for lightweight HR-style visibility inside each tenant workspace. It is not payroll, not identity management, and not a replacement for `tenant_members`.

`tenant_members` remains the source of truth for system access roles:

- `owner`
- `admin`
- `staff`
- `trainer`

## Route

- `/app/team-operations`

The route is shown in the AppShell navigation only for owner/admin roles.

## Roles

Owner/admin:

- View all tenant team operation records.
- Create/update operational team profiles.
- Add and view internal notes.
- View activity/lifecycle logs.
- View trainer workload summaries.

Staff/trainer:

- Blocked from Module 58 in the foundation release.
- Future self-service can expose a safe own-profile view without internal notes.

Student/public/anon:

- No access.

Platform admin:

- No access by platform role alone. Platform console does not expose HR notes.

## Data Model

Module 58 adds:

- `team_member_profiles`
- `team_member_notes`
- `team_member_activity_logs`

Profiles are keyed by `(tenant_id, user_id)` and sit on top of existing `tenant_members`.

Stored profile fields include:

- staff code
- display name override
- designation
- department
- employment type
- employment status
- work location
- joining date
- exit date
- non-sensitive operational notes

The module intentionally does not store:

- salary
- bank details
- government IDs
- medical or health data
- personal address
- documents

## RPCs

All writes go through SECURITY DEFINER RPCs:

- `get_team_operations_dashboard(p_tenant_id)`
- `get_team_member_operations_detail(p_tenant_id, p_user_id)`
- `upsert_team_member_profile(...)`
- `update_team_member_status(p_tenant_id, p_user_id, p_employment_status, p_exit_date)`
- `add_team_member_note(p_tenant_id, p_user_id, p_note, p_note_type)`

Direct table writes are revoked from `authenticated`.

## UI Sections

The page includes:

- overview cards
- team directory
- filters by search, role, employment status, and employment type
- selected member detail panel
- profile form
- trainer workload summary
- course/cohort assignment lists
- owner/admin-only internal notes
- lifecycle activity timeline

## Workload Summary

Trainer workload is summarized using safe counts:

- assigned courses count
- assigned cohorts count
- upcoming sessions count
- active student count through assigned courses/cohorts

Student names, emails, phones, or private student records are not exposed in this summary.

## Security Model

- RLS is enabled on all Module 58 tables.
- Direct table SELECT is owner/admin-only.
- Direct insert/update/delete is revoked from `authenticated`.
- Writes are performed only through RPCs.
- RPCs require the actor to be an owner/admin in the same tenant.
- Target users must already be members of the same tenant.
- The module does not change `tenant_members.role`.
- The module does not remove users from a tenant.
- The module does not suspend login access automatically.

## Audit / Activity

Team operation events are written to `team_member_activity_logs` and safe `audit_logs` metadata.

Activity/audit metadata includes identifiers, status transitions, note type, and `note_present`, but never copies full internal note bodies.

## Validation

The SQL validates:

- enum allowlists for employment type/status/location/note type
- text lengths
- no HTML-like `<` or `>` in user-provided text
- metadata JSON is an object and size-limited
- joining date is not after exit date
- target user exists in `tenant_members`

## Known Limitations

- No payroll.
- No salary or compensation records.
- No document storage.
- No leave approval workflow.
- No biometric attendance.
- No staff self-service.
- No automatic account suspension.
- No exports.
- No team onboarding workflow automation.

## Future Improvements

- Staff/trainer own-profile read-only view.
- Leave request and approval workflow.
- HR document center.
- Training/certification tracking for team members.
- Team workload exports.
- Optional delegated HR permissions.
- Workflow integration for onboarding and exits.
- Approval requirements for sensitive status changes.
