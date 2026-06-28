# Feature Access & Module Toggles

Module 62 adds tenant-level feature access controls for CoachFort. It lets a workspace owner/admin enable or disable optional modules without removing routes or weakening tenant RLS.

## Purpose

CoachFort supports solo coaches, trainers, small coaching centres, and larger institutes. Not every tenant needs every module. Feature Access provides a safe tenant-level switchboard so modules can be hidden from navigation and guarded at route level while preserving existing data and routes.

This module does not implement Razorpay, UPI, Stripe, live class providers, push notifications, or file upload storage.

## Route

Tenant owners/admins manage features at:

- `/app/settings/features`

Disabled module routes remain available but render a safe message:

> This module is not enabled for your workspace.

## Feature Keys

- `dashboard`
- `students`
- `courses`
- `attendance`
- `assignments`
- `finance`
- `reports`
- `documents`
- `document_uploads`
- `messages`
- `crm`
- `marketing`
- `automations`
- `workflows`
- `approvals`
- `team_operations`
- `audit_compliance`
- `backup_recovery`
- `website_builder`
- `certificates`
- `payment_gateway`
- `live_classes`
- `notifications`
- `mobile_pwa`

## Status Meanings

- `enabled`: The module is available in navigation and route guards allow access, subject to normal role permissions.
- `disabled`: The module is hidden from navigation and direct route access shows the unavailable message.
- `locked_by_plan`: Reserved for future platform subscription enforcement. Tenant owners/admins cannot set this status directly.
- `coming_soon`: The module is visible in settings as planned but is not available as an enabled module.

Core features `dashboard`, `students`, and `courses` cannot be disabled.

## Tenant-Level Control

The tenant-level source of truth is `tenant_feature_settings`.

Owner/admin can update optional feature statuses through RPCs. Staff, trainers, students, public users, and platform-only users cannot manage tenant feature settings.

## Platform Plan Integration

Module 56 already includes platform subscription plan metadata via `platform_subscription_plans.features_json`. Module 62 is designed to support later plan-based enforcement through `locked_by_plan` and `source = plan`, but it does not implement full billing or plan enforcement.

Platform owner/admin roles may manage settings through the secure RPC layer when needed for support or subscription administration.

## Navigation Behavior

App navigation now checks feature access after role permissions:

- `/app/finance` uses `finance`
- `/app/documents` uses `documents`
- `/app/reports` uses `reports`
- `/app/messages` uses `messages`
- `/app/team-operations` uses `team_operations`
- `/app/marketing` uses `marketing`
- `/app/crm` uses `crm`
- `/app/automations` uses `automations`
- `/app/workflows` uses `workflows`
- `/app/approvals` uses `approvals`
- `/app/settings/public-site` uses `website_builder`
- `/app/payments` and `/app/receipts` redirect to `/app/finance`
- `/app/payment-links` shows a gateway-on-hold notice and does not create new
  payment links

Student portal navigation checks portal-safe feature access:

- Payments use `finance`
- Documents use `documents`
- Messages use `messages`
- Certificates use `certificates`
- Notifications use `notifications`
- Assignments use `assignments`
- Courses use `courses`
- Sessions use `attendance`

## Security Model

- RLS is enabled on feature settings and activity logs.
- Normal authenticated direct writes are revoked.
- Owner/admin direct SELECT is allowed for their tenant.
- Platform admins can read/manage through existing platform-admin helpers.
- Staff/trainer/student navigation uses safe RPC output and cannot update settings.
- Students can only read portal-safe feature availability for their tenant.
- No service-role keys are used in client/browser code.
- No payment gateway integration is added.
- Finance Center remains the canonical tenant fee, invoice, payment, and receipt
  workflow.
- Feature changes are logged in `tenant_feature_activity_logs` and `audit_logs`.

## RPCs

- `get_tenant_feature_access(p_tenant_id uuid)`
- `get_effective_feature_access(p_tenant_id uuid)`
- `get_portal_feature_access(p_tenant_id uuid)`
- `update_tenant_feature_access(p_tenant_id uuid, p_feature_key text, p_status text)`
- `bulk_update_tenant_feature_access(p_tenant_id uuid, p_features jsonb)`

Helper functions are internal and not granted to `authenticated`.

## Known Limitations

- Platform subscription plan enforcement is not automated yet.
- No payment gateway module is enabled.
- Legacy payment-link creation is intentionally disabled until a real provider
  integration is approved.
- No live class provider integration exists.
- Document upload controls are governed separately by `document_uploads`.
- Disabled routes are guarded in the main optional modules, but future routes must be explicitly mapped to feature keys.
- Route guards are UI-level safeguards; sensitive data access remains controlled by existing RLS/RPC rules in each module.

## Future Improvements

- Platform plan feature mapping UI.
- Tenant plan upgrade prompts.
- Per-role feature delegation inside enabled modules.
- Usage-based feature limits.
- Bulk feature templates for tenant categories.
- Feature availability previews in platform tenant detail.
