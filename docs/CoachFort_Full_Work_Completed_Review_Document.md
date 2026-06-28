# CoachFort Full Work-Completed Review Document

Prepared for: CoachFort / Nexus Valley  
Repository: `C:\Users\Admin\NexusValley\coach-os`  
Review scope: Full repository through Module 56.1 - Platform Console UX & Data Refinement  
Review date: 2026-06-25

## 1. Executive Summary

CoachFort is a multi-tenant SaaS platform for coaching academies, institutes, and independent trainers. It supports institute operations across student management, courses, cohorts, sessions, attendance, assignments, payments, receipts, certificates, CRM, marketing planning, tenant finance, student portal, public website, AI assistant, workflow/approval foundations, and a CoachFort platform-owner console.

The product now has six major user surfaces:

- Public visitor: landing page and tenant public site with lead capture.
- Institute owner/admin/staff/trainer: `/app` tenant workspace.
- Student: `/portal` student portal.
- CoachFort platform owner/admin/support/finance: `/platform` console.
- Demo/regression users: stable accounts and seeded tenant tooling.
- Future mobile clients: mobile-safe RPC readiness layer.

Current maturity is beyond a simple MVP shell. The application has working operational modules, role-aware navigation, tenant-scoped data, RLS-backed security, student portal isolation, public lead capture, CRM/marketing/finance foundations, audit/compliance, backup/export readiness, and platform-owner management. The product is MVP-ready for controlled pilot use by a small coaching academy if operational expectations are clear: online payment collection, push notifications, advanced chat, mobile wrapper, and automated billing are not implemented yet.

Recommended next module: **Module 57 - Academy-Student Chat**. This is the most important next UX/product gap because communication is core to academy workflows and demo completeness.

## 2. Product Architecture

### Web App Structure

CoachFort is a Next.js App Router application. The main route groups are:

- `/`: public marketing/landing page.
- `/login`, `/signup`, `/onboarding`, `/invite/[token]`: authentication and workspace setup.
- `/app`: internal tenant workspace.
- `/portal`: student portal.
- `/site/[tenantSlug]`: public tenant website.
- `/platform`: CoachFort/Nexus Valley platform-owner console.
- `/api/assistant/message`: authenticated AI assistant API route.

The frontend is organized under `src/components/*` by feature and `src/lib/*` for data/service helpers. Supabase is used for auth, Postgres tables, RLS, and RPCs.

### Tenant App `/app`

The tenant workspace uses `src/components/layout/AppShell.tsx`. Navigation is role-aware through `src/lib/permissions.ts`. Tenant roles are `owner`, `admin`, `staff`, and `trainer`. The app supports dashboard, students, courses, cohorts, sessions, assignments, payments, finance, workflows, approvals, CRM, marketing, reports, audit/compliance, backup, settings, public site, and other modules.

### Student Portal `/portal`

The student portal is intentionally separate from tenant `tenant_members`. Access is based on `student_portal_accounts` and helpers in `src/lib/studentPortalAuth.ts` and `src/lib/studentPortal.ts`. Students see only their own courses, sessions, assignments, certificates, payments/receipts, notifications, profile, and assistant context.

### Platform Owner Console `/platform`

The platform console is separate from tenant ownership. Access is controlled by `platform_admin_users`, not `tenant_members`. Roles include `owner`, `admin`, `support`, and `finance`. The console manages platform subscription plans, tenant subscription status, support notes, usage snapshots, and platform activity.

### Public Site `/site/[tenantSlug]`

The public site builder exposes only explicitly public tenant branding, public site copy, and published course previews. Leads are captured through safe RPCs and stored in `public_site_leads`.

### Authentication Model

Supabase Auth powers login/signup/OAuth. Team users log in through `/login`. Students use `/portal/login`. Role-aware redirect logic distinguishes tenant members from linked student portal accounts. The platform owner console uses the same Supabase Auth identity but checks `platform_admin_users`.

### Security/RLS Design

The project uses a layered security model:

- Supabase RLS on tables.
- Tenant helper functions such as `is_tenant_member`, `has_tenant_role`, and module-specific visibility helpers.
- Separate student portal link model.
- Separate platform admin model.
- SECURITY DEFINER RPCs for sensitive delegated, mobile, workflow, approval, CRM, marketing, finance, public-site, assistant, and platform actions.
- Direct insert/update/delete revoked on high-risk module tables where RPCs are the intended write path.

## 3. Module / Feature Review

### Landing Page and Marketing Shell

- Purpose: Public entry point for CoachFort.
- Routes: `/`.
- Main files: `app/page.tsx`, `src/components/layout/MarketingHeader.tsx`.
- Tables: none directly.
- Roles: public.
- User actions: view product positioning and navigate to login/signup.
- Business value: top-of-funnel product introduction.
- Security notes: no private data.
- Limitations: not a full marketing website/CMS.
- Future: richer product pages, pricing, testimonials, demo booking.

### Authentication, Signup, Login, Onboarding

- Purpose: Create users, log in, create/reuse tenant workspace, accept invitations.
- Routes: `/login`, `/signup`, `/onboarding`, `/invite/[token]`.
- Main files: `src/components/auth/*`, `src/lib/auth.ts`, `src/lib/tenant.ts`, `src/lib/teamInvitations.ts`.
- Tables: `profiles`, `tenants`, `tenant_members`, `team_invitations`.
- RPCs: `create_workspace_with_owner`, `accept_team_invitation`, `get_team_invitation_by_token`.
- Roles: public until login; team members after login.
- Business value: tenant onboarding and team access.
- Security notes: invitation tokens, tenant membership RLS, safe redirect behavior.
- Limitations: no enterprise SSO.
- Future: SAML/OIDC, richer onboarding checklist.

### App Shell and Role-Based Access

- Purpose: Shared tenant workspace navigation and role-aware access.
- Routes: `/app/*`.
- Main files: `src/components/layout/AppShell.tsx`, `src/lib/permissions.ts`, `src/lib/team.ts`.
- Tables: `tenant_members`.
- RPCs/functions: `is_tenant_member`, `is_tenant_owner`, `has_tenant_role`.
- Roles: owner/admin/staff/trainer.
- Business value: clear tenant workspace separation.
- Security notes: UI filtering is backed by RLS/RPC checks.
- Limitations: role model is fixed.
- Future: custom role builder.

### Dashboard and Operations

- Purpose: Role-specific dashboards and operational overview.
- Routes: `/app`, `/app/operations`.
- Main files: `src/components/dashboard/*`, `src/lib/dashboard.ts`, `src/lib/operations.ts`.
- Tables: tenant operational tables.
- Roles: owner/admin/staff/trainer with role-specific widgets.
- Business value: day-to-day workspace landing view.
- Security notes: respects role and tenant scope.
- Limitations: analytics depth is moderate.
- Future: configurable dashboards and trend charts.

### Students

- Purpose: Student records and profiles.
- Routes: `/app/students`, `/app/students/[studentId]`.
- Main files: `src/components/students/*`, `src/lib/students.ts`.
- Tables: `students`.
- Roles: owner/admin; staff/trainer limited by permissions/assignments where implemented.
- Business value: central student CRM/academic record.
- Security notes: tenant-scoped, PII-sensitive.
- Limitations: no document vault.
- Future: student document center, custom fields, import/export.

### Courses, Sections, Lessons

- Purpose: Course catalog and content structure.
- Routes: `/app/courses`, `/app/courses/[courseId]`.
- Main files: `src/components/courses/*`, `src/lib/courses.ts`.
- Tables: `courses`, `course_sections`, `lessons`.
- Roles: owner/admin; trainer/staff limited by role and assignment patterns.
- Business value: academic product setup.
- Security notes: tenant-scoped, public site exposes only published previews.
- Limitations: no rich lesson content/RAG yet.
- Future: content authoring, media library, SCORM-like tracking.

### Cohorts and Enrollments

- Purpose: Group students and connect students to courses/cohorts.
- Routes: `/app/cohorts`, `/app/cohorts/[cohortId]`, `/app/enrollments`.
- Main files: `src/components/cohorts/*`, `src/components/enrollments/*`, `src/lib/cohorts.ts`, `src/lib/enrollments.ts`.
- Tables: `cohorts`, `cohort_members`, `enrollments`.
- Roles: owner/admin/staff/trainer depending scope.
- Business value: batch-based coaching operations.
- Security notes: trainer assignment and tenant RLS support scoped access.
- Limitations: no complex academic calendar engine.
- Future: cohort lifecycle automation and waitlists.

### Sessions, Live Classes, Attendance

- Purpose: Schedule/manage sessions and attendance.
- Routes: `/app/sessions`, `/app/sessions/[sessionId]`.
- Main files: `src/components/sessions/*`, `src/lib/sessions.ts`, `src/lib/attendance.ts`.
- Tables: `sessions`, `attendance_records`.
- RPCs: `mark_delegated_attendance`, `create_delegated_session`, `update_delegated_session`, `update_delegated_session_status`.
- Roles: owner/admin; trainer/staff with assignment/delegated scope.
- Business value: class delivery and attendance tracking.
- Security notes: delegated permission RPCs validate scope and audit usage.
- Limitations: no integrated video provider execution.
- Future: calendar sync, meeting integrations, auto reminders.

### Assignments and Submissions

- Purpose: Homework/assignment creation and review.
- Routes: `/app/assignments`, `/app/assignments/[assignmentId]`, `/portal/assignments`.
- Main files: `src/components/assignments/*`, `src/lib/assignments.ts`, `src/lib/submissions.ts`.
- Tables: `assignments`, `assignment_submissions`.
- RPCs: `review_delegated_assignment_submission`.
- Roles: owner/admin/trainer; students through portal for own assignments/submissions.
- Business value: learning workflow beyond sessions.
- Security notes: trainer impersonation protection and student scoping.
- Limitations: no plagiarism or rubric engine.
- Future: AI feedback and rubric grading.

### Certificates

- Purpose: Generate/view certificates.
- Routes: `/app/certificates`, `/app/certificates/[enrollmentId]`, `/portal/certificates`.
- Main files: `src/components/certificates/*`, `src/lib/certificates.ts`.
- Tables: primarily enrollment/student/course data; no dedicated certificate table found in inventory.
- Roles: owner/admin; student own certificates.
- Business value: completion proof.
- Security notes: tenant/student-scoped.
- Limitations: certificate issuance workflow can be expanded.
- Future: dedicated certificate records, verification URLs.

### Payments, Receipts, Payment Links, Tenant Subscription Billing

- Purpose: Early payment tracking, receipts, links, and SaaS billing foundation.
- Routes: `/app/payments`, `/app/payment-links`, `/app/receipts`, `/app/receipts/[paymentId]`, `/app/subscription`.
- Main files: `src/components/payments/*`, `src/components/payment-links/*`, `src/components/receipts/*`, `src/components/subscription/*`, `src/lib/payments.ts`, `src/lib/paymentLinks.ts`, `src/lib/receipts.ts`, `src/lib/billing.ts`, `src/lib/subscriptions.ts`.
- Tables: `payment_links`, `subscriptions`, `invoices`, `invoice_items`, `payment_transactions`.
- Roles: owner/admin primarily.
- Business value: financial workflow foundation.
- Security notes: no real gateway; tenant-scoped.
- Limitations: separate from Module 55 tenant finance center; platform billing still manual.
- Future: payment gateway integration, reconciliation, taxation.

### Notifications, Communication Logs, Reminders

- Purpose: In-app notifications, preferences, communications, reminders.
- Routes: `/app/notifications`, `/app/reminders`, `/portal/notifications`.
- Main files: `src/components/notifications/*`, `src/components/reminders/*`, `src/lib/notifications.ts`, `src/lib/reminders.ts`, `src/lib/communication.ts`.
- Tables: `notifications`, `notification_preferences`, `communication_logs`, `reminders`.
- Roles: tenant roles; students for own notifications.
- Business value: operational follow-up and alerts.
- Security notes: tenant/user scoped.
- Limitations: no push notifications yet.
- Future: push/device tokens, email/WhatsApp sending.

### Messaging / Conversation Foundation

- Purpose: Internal conversation schema and UI foundation.
- Routes: `/app/messages`, `/app/messages/[threadId]`.
- Main files: `src/components/messages/*`, `src/lib/messages.ts`, `src/lib/conversations.ts`.
- Tables: `conversation_threads`, `conversation_participants`, `conversation_messages`.
- Roles: tenant team users.
- Business value: internal communication foundation.
- Security notes: student conversation RLS was intentionally disabled for portal until safe design.
- Limitations: academy-student chat is not complete.
- Future: Module 57 Academy-Student Chat.

### Reports and Activity/Audit

- Purpose: Reports, activity timeline, audit logging.
- Routes: `/app/reports`, `/app/activity`.
- Main files: `src/components/reports/*`, `src/components/activity/*`, `src/lib/reports.ts`, `src/lib/auditLogger.ts`, `src/lib/activityFormatter.ts`.
- Tables: `audit_logs`.
- Roles: owner/admin for sensitive audit; reports based on permissions.
- Business value: operational accountability.
- Security notes: metadata intentionally limited in later modules.
- Limitations: export/report depth can grow.
- Future: scheduled reports, custom analytics.

### Automation Engine

- Purpose: Automation rules, conditions, actions, run logs, secure trigger execution.
- Routes: `/app/automations`.
- Main files: `src/components/automations/*`, `src/lib/automations.ts`, `src/lib/automationRunner.ts`, `src/lib/automationTriggers.ts`.
- Tables: `automation_rules`, `automation_rule_conditions`, `automation_rule_actions`, `automation_runs`, `automation_run_logs`.
- RPCs: `run_automation_trigger`, `is_valid_automation_trigger`.
- Roles: owner/admin.
- Business value: repeatable workflow automation foundation.
- Security notes: trigger validation and secure execution added.
- Limitations: no external provider execution.
- Future: automation approvals, notification senders.

### Delegated Permissions

- Purpose: Temporary/exception permissions scoped to workspace/course/cohort/session/student/assignment.
- Routes: `/app/permissions`.
- Main files: `src/components/security/PermissionsPageClient.tsx`, `src/lib/delegatedPermissions.ts`, `src/lib/permissions.ts`.
- Tables: `delegated_permissions`.
- RPCs: delegated action RPCs for attendance, assignments, sessions.
- Roles: owner/admin manage grants; delegated users receive scoped action rights.
- Business value: practical exception handling without broad RBAC changes.
- Security notes: expired/revoked/pending grants do not apply; usage audited.
- Limitations: not every product action is delegated.
- Future: delegated finance/admin approvals.

### Student Portal and Role-Specific Dashboards

- Purpose: Dedicated student portal and role-specific internal dashboards.
- Routes: `/portal`, `/portal/login`, `/portal/courses`, `/portal/sessions`, `/portal/assignments`, `/portal/certificates`, `/portal/payments`, `/portal/notifications`, `/portal/profile`; internal `/app/student-portal`.
- Main files: `src/components/portal/*`, `src/lib/studentPortal.ts`, `src/lib/studentPortalAuth.ts`.
- Tables: `student_portal_accounts`, student/course/session/finance related tables.
- Roles: linked active students only.
- Business value: student self-service MVP.
- Security notes: student portal does not rely on tenant_members; conversation reads disabled after RLS recursion.
- Limitations: no academy-student chat yet.
- Future: chat, push reminders, mobile wrapper.

### Backup and Recovery Center

- Purpose: Owner/admin backup/export readiness center.
- Routes: `/app/backup`.
- Main files: `src/components/backup/BackupRecoveryPage.tsx`, `src/lib/backup.ts`.
- Tables: `backup_export_logs`.
- Roles: owner/admin.
- Business value: trust and operational safety.
- Security notes: export logs append-only; no service-role in browser.
- Limitations: not a full Supabase infrastructure backup system.
- Future: automated backup integration and restore workflows.

### Audit and Compliance Center

- Purpose: Owner/admin compliance overview, audit timeline, filters, export.
- Routes: `/app/compliance`.
- Main files: `src/components/compliance/ComplianceCenterPage.tsx`, `src/lib/compliance.ts`.
- Tables: `audit_logs`, automation/delegation/payment-related sources.
- Roles: owner/admin.
- Business value: accountability for sensitive operations.
- Security notes: tenant-scoped audit read model.
- Limitations: depends on modules writing useful audit events.
- Future: compliance packs and scheduled exports.

### Module 47 - White Label Branding

- Purpose: Tenant-level brand customization.
- Routes: `/app/settings/branding`, applied to `/portal` and app branding.
- Main files: `src/components/branding-settings/*`, `src/lib/tenantSettings.ts`.
- Tables: branding fields on `tenants`.
- RPCs: `update_tenant_branding_settings`.
- Roles: owner/admin edit; tenant users/students read safe branding.
- Business value: white-label readiness.
- Security notes: SQL/app validation for colors/URLs; no unsafe HTML/scripts.
- Limitations: no file upload/storage manager.
- Future: asset upload, email branding.

### Module 48 - Public Website Builder

- Purpose: Tenant-branded public site and lead capture.
- Routes: `/site/[tenantSlug]`, `/app/settings/public-site`.
- Main files: `src/components/public-site/*`, `src/components/public-site-settings/*`, `src/lib/publicSite.ts`.
- Tables: `public_site_leads`, public site fields on `tenants`.
- RPCs: `get_public_site`, `submit_public_site_lead`, `update_public_site_settings`.
- Roles: public visitors read safe published site; owner/admin configure.
- Business value: prospect acquisition and lead capture.
- Security notes: no public table SELECT; public RPC returns safe fields only.
- Limitations: simple landing page builder.
- Future: custom sections, SEO, analytics.

### Module 49 - Mobile API Readiness

- Purpose: Stable mobile-safe RPC boundaries for future Android/iOS.
- Routes: `/app/mobile-readiness` developer preview.
- Main files: `src/components/mobile-readiness/*`, `src/lib/mobileApi.ts`, `src/lib/mobileTypes.ts`.
- Tables: no new tables.
- RPCs: `get_mobile_bootstrap`, `get_mobile_student_home`, `get_mobile_trainer_home`, `get_mobile_team_home`, `get_mobile_notifications`, `get_mobile_offline_manifest`.
- Roles: role-aware team users and linked students.
- Business value: future mobile app foundation.
- Security notes: manually scoped SECURITY DEFINER RPCs.
- Limitations: no mobile app wrapper or push tokens.
- Future: React Native wrapper, push notifications, offline sync.

### Module 50 - AI Assistant Foundation

- Purpose: Secure assistant foundation for team and student contexts.
- Routes: `/app/assistant`, `/portal/assistant`, `/api/assistant/message`.
- Main files: `src/components/assistant/*`, `src/lib/ai/*`.
- Tables: `ai_conversations`, `ai_messages`, `ai_request_logs`.
- RPCs: `record_ai_assistant_exchange`.
- Roles: team users and linked students with scoped contexts.
- Business value: guided operations and student help.
- Security notes: no provider key in client; mock fallback; no autonomous writes.
- Limitations: no RAG/vector search, no AI actions.
- Future: course Q&A, assignment feedback, approved action execution.

### Module 51 - Workflow Builder

- Purpose: Human-controlled workflow templates, runs, steps, and activity.
- Routes: `/app/workflows`.
- Main files: `src/components/workflows/*`, `src/lib/workflows.ts`.
- Tables: `workflow_templates`, `workflow_template_steps`, `workflow_runs`, `workflow_run_steps`, `workflow_activity_logs`.
- RPCs: workflow create/update/archive/start/update-step functions.
- Roles: owner/admin manage; staff/trainer assigned tasks.
- Business value: structured operations/checklists.
- Security notes: no product-data mutation; direct writes denied; assignment hotfix applied.
- Limitations: no automation execution integration.
- Future: workflow approvals and automation triggers.

### Module 52 - Approval Engine

- Purpose: Approval records and decisions, including workflow gates.
- Routes: `/app/approvals`.
- Main files: `src/components/approvals/*`, `src/lib/approvals.ts`.
- Tables: `approval_requests`, `approval_activity_logs`.
- RPCs: `create_approval_request`, `decide_approval_request`, `cancel_approval_request`.
- Roles: owner/admin broad; staff/trainer requested/assigned approvals.
- Business value: controlled sensitive decision process.
- Security notes: does not mutate product entities except linked workflow gate status.
- Limitations: no multi-level approval policies.
- Future: SLA reminders, approval policies, external notifications.

### Module 53 - CRM and Leads Management

- Purpose: Internal lead pipeline from public/manual/referral/walk-in sources.
- Routes: `/app/crm`.
- Main files: `src/components/crm/CrmPage.tsx`, `src/lib/crm.ts`.
- Tables: `crm_leads`, `crm_lead_notes`, `crm_follow_up_tasks`, `crm_activity_logs`, `public_site_leads` link.
- RPCs: CRM lead/create/update/import/note/follow-up functions.
- Roles: owner/admin all; staff/trainer assigned/scoped.
- Business value: admissions/sales follow-up.
- Security notes: PII protected; direct writes denied; public leads imported safely.
- Limitations: no automatic lead-to-student conversion.
- Future: conversion workflow, imports, campaign integration.

### Module 54 - Marketing Center

- Purpose: Campaign planning, template library, campaign audience, manual touches.
- Routes: `/app/marketing`.
- Main files: `src/components/marketing/MarketingCenterPage.tsx`, `src/lib/marketing.ts`.
- Tables: `marketing_campaigns`, `marketing_message_templates`, `marketing_campaign_leads`, `marketing_campaign_activities`.
- RPCs: marketing campaign/template/audience/touch functions.
- Roles: owner/admin manage; staff/trainer assigned/scoped.
- Business value: campaign readiness without sending.
- Security notes: no external messages sent; no CRM status mutation.
- Limitations: no real email/WhatsApp/SMS provider.
- Future: provider integration, approvals before launch, analytics.

### Module 55 - Tenant Finance Center

- Purpose: Tenant-level institute finance: fee plans, invoices, payments, receipts, adjustments.
- Routes: `/app/finance`, `/portal/payments`.
- Main files: `src/components/finance/FinanceCenterPage.tsx`, `src/components/portal/StudentPortalPayments.tsx`, `src/lib/finance.ts`.
- Tables: `finance_settings`, `finance_fee_plans`, `finance_invoices`, `finance_payments`, `finance_receipts`, `finance_adjustments`, `finance_activity_logs`.
- RPCs: finance settings, fee plan, invoice, payment, receipt, adjustment, dashboard, student summary functions.
- Roles: owner/admin internal; students read own safe finance summary through RPC.
- Business value: fee tracking and receipts for academies.
- Security notes: student direct SELECT blocked; no gateway; no reference/notes exposed in portal summary.
- Limitations: no real online payment collection.
- Future: Razorpay/Stripe/UPI, tax/GST, exports.

### Module 56 and 56.1 - Platform Owner Console

- Purpose: CoachFort/Nexus Valley console for platform admins.
- Routes: `/platform`.
- Main files: `src/components/platform/PlatformOwnerConsolePage.tsx`, `src/lib/platform.ts`, `docs/platform-owner-console.md`.
- Tables: `platform_admin_users`, `platform_subscription_plans`, `platform_tenant_subscriptions`, `platform_tenant_usage_snapshots`, `platform_support_notes`, `platform_activity_logs`.
- RPCs: platform dashboard/tenant/detail/plan/subscription/support/usage/admin functions.
- Roles: platform owner/admin/support/finance only.
- Business value: platform-level tenant health, support, and subscription oversight.
- Security notes: independent from tenant_members; tenant owners do not get platform access.
- Limitations: no platform billing automation, no tenant suspension enforcement, no impersonation.
- Future: billing automation, feature flags, admin management UI, exports.

## 4. Route Inventory

Page routes discovered: 60. API routes discovered: 1.

| Route | Purpose | User type | Access role | Status |
|---|---|---|---|---|
| `/` | Public landing page | Public visitor | Public | Built |
| `/login` | Team login | Team user | Public before auth | Built |
| `/signup` | Signup | New user | Public | Built |
| `/onboarding` | Tenant onboarding | Authenticated user | No tenant yet | Built |
| `/invite/[token]` | Team invitation accept | Invited user | Token-based | Built |
| `/demo` | Demo workspace hooks | Demo user | Authenticated/demo | Built |
| `/app` | Role-specific dashboard | Team | Owner/admin/staff/trainer | Built |
| `/app/activity` | Activity timeline | Team | Owner/admin | Built |
| `/app/approvals` | Approval center | Team | Owner/admin/staff/trainer scoped | Built |
| `/app/assignments` | Assignment list | Team | Role/scoped | Built |
| `/app/assignments/[assignmentId]` | Assignment detail | Team | Role/scoped | Built |
| `/app/assistant` | Team AI assistant | Team | Owner/admin/staff/trainer | Built |
| `/app/automations` | Automation rules | Team | Owner/admin | Built |
| `/app/backup` | Backup and recovery | Team | Owner/admin | Built |
| `/app/certificates` | Certificates | Team | Owner/admin/scoped | Built |
| `/app/certificates/[enrollmentId]` | Certificate detail | Team | Owner/admin/scoped | Built |
| `/app/cohorts` | Cohort list | Team | Role/scoped | Built |
| `/app/cohorts/[cohortId]` | Cohort detail | Team | Role/scoped | Built |
| `/app/compliance` | Audit/compliance center | Team | Owner/admin | Built |
| `/app/courses` | Course list | Team | Role/scoped | Built |
| `/app/courses/[courseId]` | Course detail | Team | Role/scoped | Built |
| `/app/crm` | CRM leads | Team | Owner/admin/staff/trainer scoped | Built |
| `/app/enrollments` | Enrollment management | Team | Role/scoped | Built |
| `/app/finance` | Tenant finance center | Team | Owner/admin | Built |
| `/app/marketing` | Marketing center | Team | Owner/admin/staff/trainer scoped | Built |
| `/app/messages` | Internal messages | Team | Tenant members | Built |
| `/app/messages/[threadId]` | Message thread | Team | Thread participants/scoped | Built |
| `/app/mobile-readiness` | Mobile API preview | Team | Team roles | Built |
| `/app/notifications` | Notifications | Team | Tenant members | Built |
| `/app/operations` | Operations console | Team | Owner/admin | Built |
| `/app/payment-links` | Payment links | Team | Owner/admin | Built |
| `/app/payments` | Payments | Team | Owner/admin/staff limited | Built |
| `/app/permissions` | Delegated permissions | Team | Owner/admin | Built |
| `/app/receipts` | Receipts | Team | Owner/admin | Built |
| `/app/receipts/[paymentId]` | Receipt detail | Team | Owner/admin | Built |
| `/app/reminders` | Reminders | Team | Tenant members/scoped | Built |
| `/app/reports` | Reports | Team | Owner/admin/scoped | Built |
| `/app/sessions` | Sessions | Team | Role/scoped/delegated | Built |
| `/app/sessions/[sessionId]` | Session detail | Team | Role/scoped/delegated | Built |
| `/app/settings` | Workspace settings/team | Team | Owner/admin | Built |
| `/app/settings/branding` | Branding settings | Team | Owner/admin | Built |
| `/app/settings/public-site` | Public site settings | Team | Owner/admin | Built |
| `/app/student-portal` | Internal student portal preview | Team | Owner/admin | Built |
| `/app/student-portal/[studentId]` | Student portal preview detail | Team | Owner/admin | Built |
| `/app/students` | Student list | Team | Role/scoped | Built |
| `/app/students/[studentId]` | Student detail | Team | Role/scoped | Built |
| `/app/subscription` | Tenant SaaS subscription UI | Team | Owner/admin | Built |
| `/app/workflows` | Workflow builder | Team | Owner/admin/staff/trainer scoped | Built |
| `/portal/login` | Student login | Student | Public before auth | Built |
| `/portal` | Student dashboard | Student | Active linked student | Built |
| `/portal/courses` | Student courses | Student | Own data | Built |
| `/portal/sessions` | Student sessions | Student | Own data | Built |
| `/portal/assignments` | Student assignments | Student | Own data | Built |
| `/portal/certificates` | Student certificates | Student | Own data | Built |
| `/portal/payments` | Student finance summary | Student | Own data via RPC | Built |
| `/portal/notifications` | Student notifications | Student | Own data | Built |
| `/portal/profile` | Student profile | Student | Own profile | Built |
| `/portal/assistant` | Student AI assistant | Student | Own context | Built |
| `/site/[tenantSlug]` | Public tenant site | Public visitor | Public enabled tenant only | Built |
| `/platform` | Platform owner console | Platform admin | platform_admin_users only | Built |
| `/api/assistant/message` | Assistant API route | Team/student | Bearer auth + scoped context | Built |

## 5. Database Inventory

Unique public tables discovered: 72.

| Table | Module/Feature | Purpose | Scope | Sensitive | RLS |
|---|---|---|---|---|---|
| `profiles` | Auth foundation | User profile mirror | User/platform | Yes | Yes |
| `tenants` | Tenant foundation | Workspace/institute records | Tenant | Yes | Yes |
| `tenant_members` | RBAC | Team membership/role | Tenant | Yes | Yes |
| `students` | Students | Student records | Tenant | Yes | Yes |
| `courses` | Courses | Course records | Tenant/public-safe subset | Partial | Yes |
| `course_sections` | Courses | Course sections | Tenant | No | Yes |
| `lessons` | Courses | Lessons | Tenant/student scoped | Partial | Yes |
| `enrollments` | Enrollments | Student-course links | Tenant/student | Yes | Yes |
| `cohorts` | Cohorts | Cohort/batch records | Tenant | Partial | Yes |
| `cohort_members` | Cohorts | Student-cohort membership | Tenant/student | Yes | Yes |
| `lesson_progress` | Student portal | Student lesson progress | Student | Yes | Yes |
| `reminders` | Reminders | Follow-up reminders | Tenant/user | Partial | Yes |
| `automation_rules` | Automation | Automation rules | Tenant | No | Yes |
| `automation_rule_conditions` | Automation | Rule conditions | Tenant | No | Yes |
| `automation_rule_actions` | Automation | Rule actions | Tenant | Partial | Yes |
| `automation_runs` | Automation | Automation executions | Tenant | Partial | Yes |
| `automation_run_logs` | Automation | Execution logs | Tenant | Partial | Yes |
| `payment_links` | Payments | Manual payment links | Tenant | Yes | Yes |
| `audit_logs` | Audit | Activity/audit events | Tenant | Yes | Yes |
| `trainer_course_assignments` | Trainer scoping | Trainer-course assignment | Tenant | Partial | Yes |
| `trainer_cohort_assignments` | Trainer scoping | Trainer-cohort assignment | Tenant | Partial | Yes |
| `team_invitations` | Team | Invitation tokens | Tenant | Yes | Yes |
| `subscriptions` | Tenant subscription | Tenant SaaS subscription foundation | Tenant | Partial | Yes |
| `invoices` | Tenant subscription | SaaS billing invoices | Tenant | Yes | Yes |
| `invoice_items` | Tenant subscription | Invoice line items | Tenant | Partial | Yes |
| `payment_transactions` | Tenant subscription | Manual transaction records | Tenant | Yes | Yes |
| `sessions` | Sessions | Class/live session records | Tenant/student scoped | Partial | Yes |
| `attendance_records` | Attendance | Attendance records | Tenant/student | Yes | Yes |
| `notifications` | Notifications | In-app notifications | Tenant/user/student | Partial | Yes |
| `notification_preferences` | Notifications | User notification preferences | User | Partial | Yes |
| `communication_logs` | Communications | Logged communications | Tenant | Yes | Yes |
| `assignments` | Assignments | Assignment records | Tenant/student scoped | Partial | Yes |
| `assignment_submissions` | Assignments | Student submissions/reviews | Tenant/student | Yes | Yes |
| `conversation_threads` | Messaging | Conversation threads | Tenant | Yes | Yes |
| `conversation_participants` | Messaging | Thread participants | Tenant/user | Yes | Yes |
| `conversation_messages` | Messaging | Message bodies | Tenant/user | Yes | Yes |
| `demo_seed_records` | Demo | Demo seed tracking | Tenant/demo | Partial | Yes |
| `delegated_permissions` | Delegation | Scoped temporary permissions | Tenant | Yes | Yes |
| `student_portal_accounts` | Student portal | Auth-user to student link | Tenant/student | Yes | Yes |
| `backup_export_logs` | Backup | Backup/export audit trail | Tenant | Partial | Yes |
| `public_site_leads` | Public site/CRM | Public inquiry leads | Tenant | Yes | Yes |
| `ai_conversations` | AI assistant | Assistant conversations | Tenant/user/student | Yes | Yes |
| `ai_messages` | AI assistant | Prompt/response content | Tenant/user/student | Yes | Yes |
| `ai_request_logs` | AI assistant | Metadata-only usage logs | Tenant/user/student | Partial | Yes |
| `workflow_templates` | Workflows | Workflow template records | Tenant | Partial | Yes |
| `workflow_template_steps` | Workflows | Template steps | Tenant | Partial | Yes |
| `workflow_runs` | Workflows | Workflow runs | Tenant | Partial | Yes |
| `workflow_run_steps` | Workflows | Run steps/tasks | Tenant/user | Partial | Yes |
| `workflow_activity_logs` | Workflows | Workflow activity | Tenant | Partial | Yes |
| `approval_requests` | Approvals | Approval records | Tenant/user | Yes | Yes |
| `approval_activity_logs` | Approvals | Approval activity | Tenant | Partial | Yes |
| `crm_leads` | CRM | Internal leads | Tenant | Yes | Yes |
| `crm_lead_notes` | CRM | Lead notes | Tenant | Yes | Yes |
| `crm_follow_up_tasks` | CRM | Follow-up tasks | Tenant/user | Yes | Yes |
| `crm_activity_logs` | CRM | CRM activity | Tenant | Partial | Yes |
| `marketing_campaigns` | Marketing | Campaigns | Tenant | Partial | Yes |
| `marketing_message_templates` | Marketing | Message templates | Tenant | Partial | Yes |
| `marketing_campaign_leads` | Marketing | Campaign audience | Tenant/lead | Yes | Yes |
| `marketing_campaign_activities` | Marketing | Campaign activity | Tenant | Partial | Yes |
| `finance_settings` | Tenant finance | Numbering/settings | Tenant | Partial | Yes |
| `finance_fee_plans` | Tenant finance | Fee plans | Tenant | Partial | Yes |
| `finance_invoices` | Tenant finance | Student invoices | Tenant/student | Yes | Yes |
| `finance_payments` | Tenant finance | Manual payments | Tenant/student | Yes | Yes |
| `finance_receipts` | Tenant finance | Receipts | Tenant/student | Yes | Yes |
| `finance_adjustments` | Tenant finance | Discounts/adjustments | Tenant/student | Yes | Yes |
| `finance_activity_logs` | Tenant finance | Finance activity | Tenant | Partial | Yes |
| `platform_admin_users` | Platform console | Platform admin access | Platform | Yes | Yes |
| `platform_subscription_plans` | Platform console | CoachFort plans | Platform | No | Yes |
| `platform_tenant_subscriptions` | Platform console | Tenant platform subscription status | Platform/tenant | Partial | Yes |
| `platform_tenant_usage_snapshots` | Platform console | High-level usage counts | Platform/tenant | No | Yes |
| `platform_support_notes` | Platform console | Platform support notes | Platform/tenant | Yes | Yes |
| `platform_activity_logs` | Platform console | Platform activity metadata | Platform/tenant | Partial | Yes |

## 6. RPC / Function Inventory

Unique public functions/RPCs discovered: 129. The list below is grouped by module.

| Module | Functions / RPCs | Purpose and security |
|---|---|---|
| Base auth/tenant | `set_updated_at`, `handle_new_user_profile`, `is_tenant_member`, `user_owns_tenant`, `create_workspace_with_owner`, `is_tenant_owner`, `has_tenant_role` | Core tenant membership, ownership, profile, and workspace creation helpers. Used by RLS and app flows. |
| Team invitations | `get_team_invitation_by_token`, `accept_team_invitation` | Token-based team invitation lookup/acceptance; tenant-scoped. |
| Subscription foundation | `seed_foundation_subscriptions` | Seeds tenant subscription foundation rows. |
| Assignments | `assignment_student_in_roster`, `prevent_trainer_submission_impersonation` | Assignment roster checks and trainer anti-impersonation. |
| Automation | `run_automation_trigger`, `is_valid_automation_trigger` | Secure trigger execution and validation. |
| Delegated permissions | `delegated_permission_scope_is_valid`, `find_active_delegated_permission_for_action`, `log_delegated_permission_used`, `mark_delegated_attendance`, `review_delegated_assignment_submission`, `create_delegated_session`, `update_delegated_session`, `update_delegated_session_status` | Scoped delegated actions, expiry/revocation checks, audit usage logging. |
| Student portal | `has_active_student_portal_account`, `has_any_active_student_portal_account` | Student portal link checks independent from tenant_members. |
| Branding/public site | `update_tenant_branding_settings`, `get_public_site`, `submit_public_site_lead`, `update_public_site_settings` | Safe branding/public website settings and public lead capture. |
| Mobile API | `mobile_tenant_branding_json`, `mobile_team_sections_json`, `mobile_role_permissions_json`, `get_mobile_bootstrap`, `get_mobile_student_home`, `get_mobile_trainer_home`, `get_mobile_team_home`, `get_mobile_notifications`, `get_mobile_offline_manifest` | Mobile-safe startup/home/notification/offline metadata. |
| AI assistant | `record_ai_assistant_exchange` | Stores assistant messages/logs with scoped access and metadata-only request logs. |
| Workflow builder | `workflow_current_role`, `workflow_step_is_assigned`, `workflow_run_is_visible`, `validate_workflow_text`, `workflow_validate_steps`, `insert_workflow_activity`, `create_workflow_template`, `update_workflow_template`, `archive_workflow_template`, `start_workflow_run`, `update_workflow_run_step` | RPC-only workflow template/run/step writes with assignment checks. |
| Approval engine | `approval_current_role`, `approval_user_role`, `approval_is_visible`, `validate_approval_text`, `normalize_approval_metadata`, `insert_approval_activity`, `approval_type_requires_admin`, `create_approval_request`, `decide_approval_request`, `cancel_approval_request` | Approval lifecycle and workflow gate integration. |
| CRM | `crm_user_role`, `crm_current_role`, `crm_is_owner_admin`, `crm_lead_is_visible`, `crm_follow_up_task_is_visible`, `validate_crm_text`, `normalize_crm_email`, `normalize_crm_phone`, `normalize_crm_metadata`, `normalize_crm_tags`, `insert_crm_activity`, `create_crm_lead`, `create_crm_lead_from_public_site_lead`, `update_crm_lead`, `add_crm_lead_note`, `create_crm_follow_up_task`, `update_crm_follow_up_task` | CRM visibility, validation, activity, and RPC-only writes. |
| Marketing | `marketing_user_role`, `marketing_current_member_role`, `marketing_is_owner_admin`, `marketing_campaign_is_visible`, `marketing_template_is_visible`, `marketing_campaign_lead_is_visible`, `validate_marketing_text`, `normalize_marketing_metadata`, `insert_marketing_activity`, `create_marketing_campaign`, `update_marketing_campaign`, `create_marketing_template`, `update_marketing_template`, `add_leads_to_marketing_campaign`, `update_marketing_campaign_lead`, `log_marketing_touch` | Campaign/template/audience/manual-touch foundations without external sending. |
| Tenant finance | `finance_current_role`, `finance_is_owner_admin`, `finance_student_can_access`, `finance_row_is_visible`, `validate_finance_text`, `normalize_finance_metadata`, `insert_finance_activity`, `finance_recalculate_invoice`, `upsert_finance_settings`, `create_fee_plan`, `update_fee_plan`, `create_invoice`, `update_invoice`, `void_invoice`, `record_payment`, `cancel_payment`, `apply_invoice_adjustment`, `get_finance_dashboard`, `get_student_finance_summary` | Owner/admin finance writes and student-safe summary RPC. |
| Platform console | `platform_current_role`, `is_platform_admin`, `platform_can_manage_admins`, `platform_can_manage_billing`, `platform_can_manage_support`, `platform_can_view_tenant`, `platform_normalize_text`, `platform_validate_json_object`, `platform_log_activity`, `get_platform_dashboard`, `get_platform_tenants`, `get_platform_tenant_detail`, `upsert_platform_subscription_plan`, `update_tenant_subscription`, `record_platform_support_note`, `update_platform_support_note`, `capture_platform_usage_snapshot`, `manage_platform_admin_user` | Platform-only access independent of tenant roles; RPC-only platform writes. |

## 7. Access Control Matrix

Legend: Full = full feature access; Limited = scoped/action-limited; Read = read-only/safe view; Blocked = no access.

| Section | Platform owner | Institute owner | Admin | Staff | Trainer | Student | Public/anon |
|---|---|---|---|---|---|---|---|
| `/platform` | Full | Blocked | Blocked | Blocked | Blocked | Blocked | Blocked |
| Public site `/site/[tenantSlug]` | Public read | Configure | Configure | Blocked | Blocked | Public read | Public read |
| `/app` dashboard | Blocked unless tenant member | Full | Full | Limited | Limited | Blocked | Blocked |
| Students | Blocked unless tenant member | Full | Full | Limited | Limited/scoped | Own portal only | Blocked |
| Courses/cohorts/sessions | Blocked unless tenant member | Full | Full | Limited | Limited/scoped | Own portal read | Published previews only |
| Assignments | Blocked unless tenant member | Full | Full | Limited | Limited/scoped | Own assignments | Blocked |
| Attendance | Blocked unless tenant member | Full | Full | Limited/delegated | Limited/delegated | Own summary where exposed | Blocked |
| Payments/receipts legacy | Blocked unless tenant member | Full | Full | Limited | Blocked | Own portal finance summary | Blocked |
| Tenant finance center | Blocked unless tenant member | Full | Full | Blocked | Blocked | Own safe summary | Blocked |
| CRM | Blocked unless tenant member | Full | Full | Assigned/scoped | Assigned/scoped | Blocked | Lead submit only via public site |
| Marketing | Blocked unless tenant member | Full | Full | Assigned/scoped | Assigned/scoped | Blocked | Blocked |
| Workflows | Blocked unless tenant member | Full | Full | Assigned tasks | Assigned tasks | Blocked | Blocked |
| Approvals | Blocked unless tenant member | Full | Full | Requested/assigned | Requested/assigned | Blocked | Blocked |
| Compliance/audit | Blocked unless tenant member | Full | Full | Blocked | Blocked | Blocked | Blocked |
| Backup/recovery | Blocked unless tenant member | Full | Full | Blocked | Blocked | Blocked | Blocked |
| AI assistant | Platform not connected | Team scope | Team scope | Team scope limited | Trainer scope | Student scope | Blocked |
| Mobile RPCs | Blocked unless platform future | Team bootstrap | Team bootstrap | Team bootstrap | Trainer bootstrap | Student bootstrap | Blocked |

## 8. Security Review

- Tenant isolation: tenant tables are scoped by tenant_id and RLS helpers. Owner/admin/staff/trainer access is separate from platform admin access.
- Student isolation: student portal uses `student_portal_accounts`, not `tenant_members`. Student finance uses safe summary RPC instead of direct table SELECT.
- Platform isolation: `/platform` uses `platform_admin_users` only. Tenant owner/admin roles do not grant platform access.
- RLS approach: all sensitive module tables enable RLS; recent modules revoke direct writes and use RPC-only write paths.
- RPC-only write approach: delegated actions, workflow, approvals, CRM, marketing, finance, public site, AI logs, mobile, and platform writes use SECURITY DEFINER RPCs with explicit validation.
- Audit logging: `audit_logs` plus module-specific activity logs capture safe metadata for critical operations.
- PII protection: CRM, finance, support, AI, and student data are intentionally scoped. Later modules avoid copying full notes, prompts, references, or private notes into audit metadata.
- Payment safety: no payment gateway integration, no real money movement, and manual-only recording in tenant finance.
- Service-role safety: frontend uses anon Supabase client. Service-role key is only intended for local/admin scripts such as regression account creation.
- Destructive actions: no tenant deletion or platform impersonation feature was found.

## 9. MVP Readiness Review

CoachFort is MVP-ready for a small coaching academy pilot with the following capabilities:

- Tenant onboarding and team roles.
- Student, course, cohort, session, attendance, assignment, certificate foundations.
- Student portal with own data.
- Public tenant site and lead capture.
- CRM follow-up and marketing planning.
- Manual tenant finance tracking with invoices/payments/receipts.
- Audit/compliance and backup readiness.
- Platform owner console for CoachFort operations.

The MVP is strongest for manual/operational workflows. The largest product-experience gap is communication between academy and students. **Academy-student chat is recommended next** because it improves day-to-day usability, student engagement, support, reminders, doubts, and demo completeness while reducing dependence on WhatsApp.

## 10. Recommended Next Module

### Module 57 - Academy-Student Chat

Why it should be next:

- Enables direct academy-to-student communication.
- Makes the student portal feel complete and active.
- Reduces operational dependence on WhatsApp.
- Supports doubts, reminders, announcements, support requests, and trainer follow-up.
- Builds on existing conversation tables but must add safe student-facing RLS/RPCs.
- Helps MVP demos because prospects expect communication inside a student portal.

Recommended design:

- `/app/messages` for team-side academy/student threads.
- `/portal/messages` or `/portal/chat` for students.
- Thread types: direct student support, cohort announcement, course discussion.
- Strict student visibility: own direct threads, enrolled course/cohort student-safe threads only.
- No broad tenant announcements unless explicitly student-visible.
- Optional future: attachments, push notifications, AI summaries, unread counters.

## 11. Known Gaps / Future Roadmap

- Academy-student chat.
- HR/team operations.
- Document center for students, staff, and compliance.
- Marketplace/add-ons.
- Developer API and webhooks.
- Enterprise suite: custom roles, SSO, audit retention policies.
- Payment gateway integration: Razorpay/Stripe/UPI.
- Advanced analytics and trend dashboards.
- Mobile app wrapper for Android/iOS.
- Push notifications and device tokens.
- Data exports across modules.
- Tenant suspension enforcement.
- Platform billing automation.
- Tax/GST compliance and invoice exports.
- Rich course content, media library, and RAG search.
- Workflow/approval integration with controlled product actions.

## 12. Documentation Inventory and Gaps

Existing docs:

- `ai-assistant-foundation.md`
- `approval-engine.md`
- `crm-leads-management.md`
- `marketing-center.md`
- `mobile-api-readiness.md`
- `platform-owner-console.md`
- `regression-test-accounts.md`
- `tenant-finance-center.md`
- `workflow-builder.md`

Documentation gaps:

- Early modules 1-46 have SQL/code but limited consolidated documentation.
- No single product architecture document existed before this review.
- No full RLS policy reference document.
- No operational runbook for production deployments.
- No module-by-module test evidence archive.
- No end-user help docs for institute owners, staff, trainers, or students.

## 13. Review Counts

- Page routes: 60.
- API routes: 1.
- Unique database tables discovered: 72.
- Unique public SQL functions/RPCs discovered: 129.
- SQL migration files in `supabase/`: 47.
- Feature component directories in `src/components/`: 41.
- Service/helper files in `src/lib/`: 50.

## 14. Modules That Were Unclear

Some early module numbers are not represented as explicit SQL files in the current migration naming sequence. Foundation work for landing page, auth, shell, tenant creation, initial dashboards, payments, receipts, reports, branding, and early student portal appears across `schema.sql`, early `module*.sql` files, `app/`, and `src/`, but not every early feature has a one-to-one module document. This review therefore maps early work by feature and source files rather than claiming exact module numbering for every early step.

## 15. Overall Conclusion

CoachFort has progressed from a tenant workspace foundation into a broad coaching-institute SaaS product with student portal, public site, CRM, marketing planning, tenant finance, workflow/approval foundations, AI assistant foundation, mobile API readiness, compliance, backup readiness, delegated permissions, and platform-owner operations.

The codebase is mature enough for MVP demos and controlled academy pilots. Before a broader commercial launch, the highest-impact next investments are academy-student chat, production runbooks, export/report polish, payment gateway integration, push notifications, and platform billing automation.
