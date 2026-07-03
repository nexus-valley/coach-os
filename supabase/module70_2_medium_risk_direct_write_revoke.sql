begin;

-- Module 70.2: Medium-risk direct write grant revoke.
--
-- Modules 69.3 through 69.6 moved these browser/client write paths behind
-- production-smoked SECURITY DEFINER RPCs:
--
-- 69.3 sessions/attendance:
--   create_session_secure, update_session_secure,
--   update_session_status_secure, update_session_meeting_details_secure,
--   mark_attendance_secure, bulk_mark_attendance_secure
--
-- 69.4 assignments/submissions:
--   create_assignment_secure, update_assignment_secure,
--   update_assignment_status_secure, submit_assignment_secure,
--   review_assignment_submission_secure
--
-- 69.5 invitations/trainer assignments/delegated permissions:
--   create_team_invitation_secure, cancel_team_invitation_secure,
--   resend_team_invitation_secure, accept_team_invitation,
--   assign_trainer_to_course_secure, remove_trainer_from_course_secure,
--   assign_trainer_to_cohort_secure, remove_trainer_from_cohort_secure,
--   grant_delegated_permission_secure, revoke_delegated_permission_secure,
--   expire_delegated_permissions_secure
--
-- 69.6 notifications/preferences/communication/reminders:
--   create_notification_secure, mark_notification_read_secure,
--   archive_notification_secure, ensure_notification_preferences_secure,
--   update_notification_preferences_secure, queue_communication_log_secure,
--   create_reminder_secure, update_reminder_status_secure,
--   delete_reminder_secure
--
-- This patch only removes ordinary browser/client write privileges from
-- anon/authenticated roles. It preserves SELECT grants, schema usage, RLS
-- policies, and RPC execute grants.

revoke insert, update, delete on table public.sessions from anon, authenticated;
revoke insert, update, delete on table public.attendance_records from anon, authenticated;
revoke insert, update, delete on table public.assignments from anon, authenticated;
revoke insert, update, delete on table public.assignment_submissions from anon, authenticated;
revoke insert, update, delete on table public.team_invitations from anon, authenticated;
revoke insert, update, delete on table public.trainer_course_assignments from anon, authenticated;
revoke insert, update, delete on table public.trainer_cohort_assignments from anon, authenticated;
revoke insert, update, delete on table public.delegated_permissions from anon, authenticated;
revoke insert, update, delete on table public.notifications from anon, authenticated;
revoke insert, update, delete on table public.notification_preferences from anon, authenticated;
revoke insert, update, delete on table public.communication_logs from anon, authenticated;
revoke insert, update, delete on table public.reminders from anon, authenticated;

-- Rollback, if direct browser writes must be temporarily restored during an
-- incident. Prefer fixing callers to use the secure RPCs before using this.
--
-- grant insert, update, delete on table public.sessions to authenticated;
-- grant insert, update, delete on table public.attendance_records to authenticated;
-- grant insert, update, delete on table public.assignments to authenticated;
-- grant insert, update, delete on table public.assignment_submissions to authenticated;
-- grant insert, update, delete on table public.team_invitations to authenticated;
-- grant insert, update, delete on table public.trainer_course_assignments to authenticated;
-- grant insert, update, delete on table public.trainer_cohort_assignments to authenticated;
-- grant insert, update, delete on table public.delegated_permissions to authenticated;
-- grant insert, update, delete on table public.notifications to authenticated;
-- grant insert, update, delete on table public.notification_preferences to authenticated;
-- grant insert, update, delete on table public.communication_logs to authenticated;
-- grant insert, update, delete on table public.reminders to authenticated;

commit;
