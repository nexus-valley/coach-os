# CoachFort Full Work-Completed Review Document - Word Draft

Prepared for CoachFort / Nexus Valley  
Repository: `C:\Users\Admin\NexusValley\coach-os`  
Scope: Complete project through Module 56.1 - Platform Console UX & Data Refinement  
Date: 2026-06-25

---

# Executive Summary

CoachFort is a multi-tenant SaaS platform for coaching academies and institutes. It now includes a public landing surface, tenant workspace, student portal, public tenant website builder, CRM, marketing planning, finance tracking, workflow and approval foundations, AI assistant foundation, mobile API readiness, audit/compliance, backup readiness, delegated permissions, and a CoachFort platform-owner console.

The product supports these major user types:

1. CoachFort platform owner/admin/support/finance through `/platform`.
2. Institute owner/admin through `/app`.
3. Staff through scoped `/app` workflows.
4. Trainer through scoped `/app` workflows.
5. Student through `/portal`.
6. Public visitor/lead through `/` and `/site/[tenantSlug]`.

Current maturity: CoachFort is beyond a simple MVP shell. It is ready for controlled MVP demos and pilot use by a small coaching academy, with the caveat that online payment gateway integration, push notifications, full academy-student chat, mobile app wrapper, and platform billing automation are still future work.

Recommended next module: **Module 57 - Academy-Student Chat**.

---

# Product Architecture

The product is built with Next.js App Router and Supabase.

Main surfaces:

- `/`: public CoachFort landing page.
- `/login`, `/signup`, `/onboarding`, `/invite/[token]`: auth and onboarding.
- `/app`: institute tenant workspace.
- `/portal`: student portal.
- `/site/[tenantSlug]`: public tenant website.
- `/platform`: CoachFort/Nexus Valley platform owner console.
- `/api/assistant/message`: authenticated AI assistant API route.

Core models:

- Tenant model: `tenants`, `tenant_members`.
- Team roles: owner, admin, staff, trainer.
- Student portal model: `student_portal_accounts`, separate from tenant members.
- Platform admin model: `platform_admin_users`, separate from tenant members.
- Public lead model: `public_site_leads`.
- Audit model: `audit_logs` plus module-specific activity logs.

Security model:

- Supabase Auth for identity.
- Row-level security on sensitive tables.
- Tenant scoped helpers such as `is_tenant_member` and `has_tenant_role`.
- Student portal scoped through active student links.
- Platform console scoped through active platform admin records.
- SECURITY DEFINER RPCs for high-risk writes.
- Direct table writes revoked for many sensitive modules.

---

# Feature and Module Review

## Foundation: Landing, Auth, Tenant Workspace

CoachFort includes a public landing page, email/password auth, Google OAuth helpers, signup, login, onboarding, team invitation acceptance, tenant creation, tenant membership, and role-aware internal app shell.

Main routes:

- `/`
- `/login`
- `/signup`
- `/onboarding`
- `/invite/[token]`
- `/app`

Main files:

- `app/page.tsx`
- `src/components/auth/*`
- `src/components/layout/AppShell.tsx`
- `src/lib/auth.ts`
- `src/lib/tenant.ts`
- `src/lib/team.ts`
- `src/lib/teamInvitations.ts`
- `src/lib/permissions.ts`

Main tables:

- `profiles`
- `tenants`
- `tenant_members`
- `team_invitations`

Business value: tenants can onboard, invite teams, and operate inside a secure workspace.

Limitations: no enterprise SSO or custom role builder yet.

## Students, Courses, Cohorts, Enrollments

CoachFort supports core academy records: students, courses, sections, lessons, cohorts, cohort members, and enrollments.

Main routes:

- `/app/students`
- `/app/students/[studentId]`
- `/app/courses`
- `/app/courses/[courseId]`
- `/app/cohorts`
- `/app/cohorts/[cohortId]`
- `/app/enrollments`

Main tables:

- `students`
- `courses`
- `course_sections`
- `lessons`
- `cohorts`
- `cohort_members`
- `enrollments`

Business value: institute owners can manage academic structure and student rosters.

Security notes: tenant-scoped RLS, trainer assignment helpers, and role-aware UI.

Limitations: no document center or advanced content management yet.

## Sessions, Attendance, Assignments, Certificates

CoachFort supports session scheduling, attendance, assignments, submissions, and certificate display/generation workflows.

Main routes:

- `/app/sessions`
- `/app/sessions/[sessionId]`
- `/app/assignments`
- `/app/assignments/[assignmentId]`
- `/app/certificates`
- `/app/certificates/[enrollmentId]`
- `/portal/sessions`
- `/portal/assignments`
- `/portal/certificates`

Main tables:

- `sessions`
- `attendance_records`
- `assignments`
- `assignment_submissions`

Main RPCs:

- `mark_delegated_attendance`
- `review_delegated_assignment_submission`
- `create_delegated_session`
- `update_delegated_session`
- `update_delegated_session_status`

Business value: daily teaching and learning operations are supported.

Limitations: no full video-provider integration and no advanced grading/rubric engine yet.

## Notifications, Reminders, Messaging

The system includes in-app notifications, preferences, communication logs, reminders, and internal conversation tables.

Main routes:

- `/app/notifications`
- `/app/reminders`
- `/app/messages`
- `/app/messages/[threadId]`
- `/portal/notifications`

Main tables:

- `notifications`
- `notification_preferences`
- `communication_logs`
- `reminders`
- `conversation_threads`
- `conversation_participants`
- `conversation_messages`

Business value: operational follow-up and communication foundations.

Limitations: student-facing chat was deferred after RLS recursion issues; this is why Module 57 is recommended.

## Delegated Permissions

Delegated permissions allow temporary, scoped exceptions without weakening base RBAC.

Main route:

- `/app/permissions`

Main table:

- `delegated_permissions`

Main RPCs:

- `find_active_delegated_permission_for_action`
- `log_delegated_permission_used`
- delegated attendance/session/assignment RPCs

Business value: owners/admins can safely grant exceptional permissions for real-world workflows.

Security notes: scopes, expiry, revocation, tenant boundary, and audit logging are enforced.

## Automation, Audit, Compliance, Backup

CoachFort includes automation rules/runs, audit logs, compliance center, and backup/export readiness.

Main routes:

- `/app/automations`
- `/app/activity`
- `/app/compliance`
- `/app/backup`

Main tables:

- `automation_rules`
- `automation_rule_conditions`
- `automation_rule_actions`
- `automation_runs`
- `automation_run_logs`
- `audit_logs`
- `backup_export_logs`

Business value: operational accountability and readiness for enterprise expectations.

Limitations: no external notification provider execution and no full infrastructure restore workflow.

## Student Portal

The student portal is separate from the internal app and uses `student_portal_accounts`.

Main routes:

- `/portal/login`
- `/portal`
- `/portal/courses`
- `/portal/sessions`
- `/portal/assignments`
- `/portal/certificates`
- `/portal/payments`
- `/portal/notifications`
- `/portal/profile`
- `/portal/assistant`

Business value: students can self-serve their learning dashboard.

Security notes: linked active student only; no tenant-wide data.

Limitations: no academy-student chat yet.

## Module 47 - White Label Branding

Adds tenant branding settings and applies branding to app and student portal surfaces.

Main route:

- `/app/settings/branding`

Main RPC:

- `update_tenant_branding_settings`

Security notes: validates colors and URLs; no custom scripts or unsafe HTML.

## Module 48 - Public Website Builder

Adds tenant public site settings, public route, and lead capture.

Main routes:

- `/site/[tenantSlug]`
- `/app/settings/public-site`

Main table:

- `public_site_leads`

Main RPCs:

- `get_public_site`
- `submit_public_site_lead`
- `update_public_site_settings`

Security notes: no broad public table SELECT; only safe public fields are returned.

## Module 49 - Mobile API Readiness

Adds mobile-safe RPC boundaries for team and student mobile apps.

Main route:

- `/app/mobile-readiness`

Main RPCs:

- `get_mobile_bootstrap`
- `get_mobile_student_home`
- `get_mobile_trainer_home`
- `get_mobile_team_home`
- `get_mobile_notifications`
- `get_mobile_offline_manifest`

Security notes: manual scoping for SECURITY DEFINER RPCs.

## Module 50 - AI Assistant Foundation

Adds team and student assistant foundations with safe context and mock/provider abstraction.

Main routes:

- `/app/assistant`
- `/portal/assistant`
- `/api/assistant/message`

Main tables:

- `ai_conversations`
- `ai_messages`
- `ai_request_logs`

Main RPC:

- `record_ai_assistant_exchange`

Security notes: no client provider key, no autonomous writes, no full database dump.

## Module 51 - Workflow Builder

Adds human-controlled workflow templates, runs, steps, and activity.

Main route:

- `/app/workflows`

Main tables:

- `workflow_templates`
- `workflow_template_steps`
- `workflow_runs`
- `workflow_run_steps`
- `workflow_activity_logs`

Security notes: RPC-only writes and assignment checks; no product data mutation.

## Module 52 - Approval Engine

Adds approval records, decision lifecycle, and workflow gate integration.

Main route:

- `/app/approvals`

Main tables:

- `approval_requests`
- `approval_activity_logs`

Security notes: approval decisions only update approval/workflow gate records, not product entities.

## Module 53 - CRM and Leads Management

Adds internal lead pipeline, notes, tasks, public lead import, and activity.

Main route:

- `/app/crm`

Main tables:

- `crm_leads`
- `crm_lead_notes`
- `crm_follow_up_tasks`
- `crm_activity_logs`

Security notes: PII protected, assigned/scoped access for staff/trainer, direct writes denied.

## Module 54 - Marketing Center

Adds campaign planning, templates, audience selection, and manual touch logging.

Main route:

- `/app/marketing`

Main tables:

- `marketing_campaigns`
- `marketing_message_templates`
- `marketing_campaign_leads`
- `marketing_campaign_activities`

Security notes: no WhatsApp/email/SMS sending and no CRM status mutation.

## Module 55 - Tenant Finance Center

Adds tenant-level finance records: settings, fee plans, invoices, payments, receipts, adjustments, activity.

Main routes:

- `/app/finance`
- `/portal/payments`

Main tables:

- `finance_settings`
- `finance_fee_plans`
- `finance_invoices`
- `finance_payments`
- `finance_receipts`
- `finance_adjustments`
- `finance_activity_logs`

Security notes: owner/admin internal writes; students use safe summary RPC only.

## Module 56 and 56.1 - Platform Owner Console

Adds CoachFort platform-owner console and UX refinement.

Main route:

- `/platform`

Main tables:

- `platform_admin_users`
- `platform_subscription_plans`
- `platform_tenant_subscriptions`
- `platform_tenant_usage_snapshots`
- `platform_support_notes`
- `platform_activity_logs`

Main RPCs:

- `get_platform_dashboard`
- `get_platform_tenants`
- `get_platform_tenant_detail`
- `upsert_platform_subscription_plan`
- `update_tenant_subscription`
- `record_platform_support_note`
- `update_platform_support_note`
- `capture_platform_usage_snapshot`
- `manage_platform_admin_user`

Security notes: platform access is based only on `platform_admin_users`, not tenant roles.

---

# Route Inventory Summary

Page routes discovered: 60  
API routes discovered: 1

Key route groups:

- Public: `/`, `/site/[tenantSlug]`
- Auth/onboarding: `/login`, `/signup`, `/onboarding`, `/invite/[token]`
- Tenant app: `/app` and `/app/*`
- Student portal: `/portal` and `/portal/*`
- Platform owner: `/platform`
- API: `/api/assistant/message`

---

# Database Inventory Summary

Unique public tables discovered: 72.

Major table groups:

- Foundation: `profiles`, `tenants`, `tenant_members`
- Academic: `students`, `courses`, `course_sections`, `lessons`, `cohorts`, `cohort_members`, `enrollments`
- Operations: `sessions`, `attendance_records`, `assignments`, `assignment_submissions`, `reminders`
- Communications: `notifications`, `notification_preferences`, `communication_logs`, `conversation_threads`, `conversation_participants`, `conversation_messages`
- Finance/payments: `payment_links`, `subscriptions`, `invoices`, `invoice_items`, `payment_transactions`, `finance_*`
- Audit/automation/security: `audit_logs`, `automation_*`, `delegated_permissions`, `backup_export_logs`
- Student portal: `student_portal_accounts`, `lesson_progress`
- Public site/CRM/marketing: `public_site_leads`, `crm_*`, `marketing_*`
- AI/workflows/approvals: `ai_*`, `workflow_*`, `approval_*`
- Platform: `platform_*`

---

# RPC / Function Inventory Summary

Unique public SQL functions/RPCs discovered: 129.

Major groups:

- Tenant/auth helpers.
- Invitation and onboarding RPCs.
- Automation trigger RPCs.
- Delegated action RPCs.
- Student portal helpers.
- Public site RPCs.
- Mobile API RPCs.
- AI assistant record RPC.
- Workflow RPCs.
- Approval RPCs.
- CRM RPCs.
- Marketing RPCs.
- Tenant finance RPCs.
- Platform owner console RPCs.

---

# Access Control Matrix Summary

Platform owner:

- Full access to `/platform`.
- No automatic tenant workspace access unless separately a tenant member.

Institute owner/admin:

- Full or near-full tenant workspace access.
- No platform access.

Staff:

- Scoped tenant operations, CRM/marketing/workflow/approval access where assigned.
- No platform access.

Trainer:

- Scoped teaching, attendance, assignment, CRM/marketing/workflow/approval access where assigned.
- No platform access.

Student:

- Student portal only.
- Own data only.
- No `/app` or `/platform`.

Public/anon:

- Public landing and enabled public tenant site only.
- Public lead submission through safe RPC.

---

# Security Review

The security design is strong for an MVP-stage SaaS:

- Tenant isolation is consistently present.
- Student portal isolation is separate from tenant team membership.
- Platform owner access is separate from tenant roles.
- Sensitive writes increasingly use SECURITY DEFINER RPCs with manual validation.
- Direct insert/update/delete is revoked on many newer sensitive tables.
- Audit and activity logging are broad and improving.
- PII protection has been explicitly handled in CRM, finance, platform, public site, and assistant modules.
- No payment gateway integration or real money movement exists yet.
- No platform impersonation or tenant deletion feature was found.
- No service-role key is used in browser/client code.

---

# MVP Readiness

CoachFort is MVP-ready for controlled pilots with a small coaching academy.

Ready areas:

- Tenant onboarding and team roles.
- Student/course/cohort/session management.
- Attendance and assignment workflows.
- Student portal.
- Public lead capture.
- CRM follow-up.
- Marketing planning.
- Tenant finance tracking.
- Audit/compliance.
- Backup readiness.
- Platform owner oversight.

Important caveats:

- No real payment gateway yet.
- No push notifications.
- No full academy-student chat yet.
- No mobile app wrapper yet.
- No platform billing automation.

---

# Recommended Next Module

## Module 57 - Academy-Student Chat

This should be the next module because it makes the student portal and academy operations feel complete.

Benefits:

- Direct academy-to-student communication.
- Less dependence on WhatsApp.
- Supports doubts, support requests, reminders, announcements, and trainer follow-up.
- Improves MVP demo quality.
- Builds naturally on existing conversation tables.

The implementation should use conservative student-facing RLS/RPCs and avoid broad tenant-wide message exposure.

---

# Future Roadmap

- Academy-student chat.
- HR/team operations.
- Document center.
- Marketplace/add-ons.
- Developer API and webhooks.
- Enterprise suite.
- Payment gateway integration.
- Advanced analytics.
- Mobile app wrapper.
- Push notifications.
- Exports.
- Tenant suspension enforcement.
- Platform billing automation.
- Tax/GST compliance.
- Rich lesson/content system.
- Workflow-action approvals.

---

# Review Counts

- Page routes: 60.
- API routes: 1.
- Database tables: 72.
- Public SQL functions/RPCs: 129.
- SQL migration files: 47.
- Component directories: 41.
- Service/helper files: 50.

---

# Documentation Gaps

- Early modules have SQL/code but limited standalone docs.
- No complete RLS policy reference document.
- No production deployment runbook.
- No user help documentation.
- No consolidated test evidence archive.

---

# Conclusion

CoachFort has reached a broad, credible SaaS MVP foundation. It has strong tenant separation, a dedicated student portal, a public lead funnel, internal operations modules, CRM/marketing/finance foundations, and platform-owner oversight. The next highest-impact feature is academy-student chat, followed by payment gateway integration, push notifications, exports, and platform billing automation.
