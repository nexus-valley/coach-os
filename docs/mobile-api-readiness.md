# CoachFort Mobile API Readiness

Module 49 prepares CoachFort for future Android and iOS clients by defining stable,
tenant-scoped RPC payloads. Mobile clients should authenticate with Supabase Auth,
then call the RPCs below instead of reading many raw tables directly.

## Authentication Model

Team users sign in with the same Supabase Auth account used by `/login`.
The mobile bootstrap resolves `tenant_members` first and returns a team context for
`owner`, `admin`, `staff`, or `trainer`.

Student users sign in with the same Supabase Auth account used by `/portal/login`.
If the user is not a team member, the bootstrap resolves an active
`student_portal_accounts` link and returns a student context.

Users with neither a team membership nor an active student portal link receive a
`mode: "none"` bootstrap response and should be sent to onboarding or support.

## RPC Contract

All Module 49 RPCs are authenticated-only `SECURITY DEFINER` functions. They return
compact JSON payloads and enforce role or student-link scoping internally.

### `public.get_mobile_bootstrap()`

Startup context for all mobile apps.

Returns one of:

```json
{
  "mode": "team",
  "role": "trainer",
  "tenant": { "id": "...", "brand_name": "..." },
  "sections": ["dashboard", "sessions"],
  "permissions": { "can_manage_attendance": true },
  "unread_notifications": 3
}
```

```json
{
  "mode": "student",
  "student": { "id": "...", "full_name": "..." },
  "tenant": { "id": "...", "student_portal_theme_color": "#145da0" },
  "sections": ["home", "courses", "sessions"],
  "unread_notifications": 1
}
```

### `public.get_mobile_student_home()`

For linked students only. Returns the student's profile summary, enrolled course
count, upcoming sessions, pending assignments, pending payment count, notification
summary, and tenant branding.

The student can only see data derived from their own `student_portal_accounts`
link, enrollments, cohort memberships, payment links, assignments, and
notifications.

### `public.get_mobile_trainer_home()`

For trainer team users. Returns assigned upcoming sessions, pending submissions,
delegated permission count, unread notifications, and tenant branding.

Trainer data is scoped through `trainer_course_assignments`,
`trainer_cohort_assignments`, direct session assignment, and assignment ownership.

### `public.get_mobile_team_home()`

For team users. Returns role-aware operational counts:

- active students
- active courses/cohorts
- sessions in the next seven days
- pending payments where the role is allowed to see payment operations
- unread notifications

Trainer results remain scoped to assigned courses/cohorts.

### `public.get_mobile_notifications(p_limit, p_offset)`

Returns notifications for the authenticated user only. Pagination is capped to 50
items per call.

### `public.get_mobile_offline_manifest()`

Returns safe sync metadata:

- server time
- context mode
- tenant id
- accessible sections
- last updated timestamps by category

This is not a full offline data export.

## Mobile Clients Should Not

- Use service-role keys.
- Query raw tenant-wide tables for student views.
- Cache another role's bootstrap context.
- Assume direct table access will remain stable.
- Store secrets, payment provider keys, or private tenant metadata locally.
- Treat `get_mobile_offline_manifest()` as a full backup or export endpoint.

## Push Notification Readiness

Push notifications are documentation-only in Module 49. A future module should add a
tenant-scoped `device_tokens` table with:

- `tenant_id`
- `user_id`
- optional `student_id`
- platform (`ios`, `android`, `web`)
- encrypted token storage or token hash strategy
- active/revoked status
- `last_seen_at`

No FCM/APNs server key should ever be exposed to a mobile client.

## Security Notes

- Team context is resolved before student context.
- Students are not added to `tenant_members`.
- Student payloads are linked-student only.
- Trainer payloads use trainer assignment scoping.
- Owner/admin summaries are tenant-scoped.
- Notification payloads are always user-specific.
- Public site RPCs remain separate from authenticated mobile RPCs.

## Developer Preview

The internal route `/app/mobile-readiness` shows the current authenticated user's
bootstrap payload, role-aware home payload, notifications payload, and offline
manifest. It is a read-only validation surface for team users and is not intended
for students.
