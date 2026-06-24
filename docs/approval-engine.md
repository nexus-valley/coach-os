# Approval Engine

Module 52 adds a tenant-scoped Approval Engine foundation for CoachFort.

## Purpose

The Approval Engine records controlled approval requests and decisions for sensitive or structured operational processes:

- Workflow approval gates
- Course publishing approval
- Certificate issuance approval
- Payment adjustment approval
- Student change approval
- Sensitive settings approval
- Future automation action approval

This module does not automatically mutate product records such as students, payments, courses, sessions, settings, or automations.

## Role Model

- Owner/admin: view all tenant approvals, create requests, approve/reject/cancel tenant approvals.
- Staff/trainer: create approval requests, view requests they created, view requests assigned directly to them or to their role, approve/reject only assigned approvals, cancel their own pending requests.
- Students/anonymous visitors: no internal approval access.

## Approval Lifecycle

Approval statuses:

- `pending`
- `approved`
- `rejected`
- `cancelled`

Request flow:

1. A tenant team member creates an approval request.
2. The request is assigned to a role or user.
3. An authorized approver approves or rejects it.
4. The requester or owner/admin can cancel while pending.

Approved, rejected, and cancelled requests cannot be decided again.

## Workflow Gate Integration

Approval requests can link to a `workflow_run_steps` row when the step is an `approval_gate`.

When linked:

- Approving the approval marks the workflow gate step `completed`.
- Rejecting the approval marks the workflow gate step `blocked`.
- No other product entity is changed.

If all workflow steps are completed or skipped after approval, the workflow run can be marked completed by the approval RPC.

## RPC List

All writes are handled through SECURITY DEFINER RPCs:

- `create_approval_request`
- `decide_approval_request`
- `cancel_approval_request`

Direct authenticated inserts, updates, and deletes are revoked on approval tables.

## RLS Model

Tables:

- `approval_requests`
- `approval_activity_logs`

RLS allows:

- owner/admin to read all tenant approvals
- requester to read their own approvals
- directly assigned users to read their approvals
- role-assigned users to read approvals assigned to their current tenant role

Anonymous users and students have no approval table access.

## Validation

The SQL layer validates:

- approval type allowlist
- priority allowlist
- title required and max 180 characters
- description/decision note max 1500 characters
- entity type max 80 characters
- metadata JSON object, max 3000 characters
- no `<` or `>` in user text fields
- `assigned_to` must be a tenant member
- workflow step must belong to the same tenant
- linked workflow step must be `approval_gate`

Sensitive approval types created by staff/trainer must be assigned to owner/admin.

## Audit And Activity

The engine writes:

- `approval_activity_logs`
- `audit_logs`

Audit actions:

- `approval_request_created`
- `approval_request_approved`
- `approval_request_rejected`
- `approval_request_cancelled`
- `workflow_gate_approved`
- `workflow_gate_rejected`

Audit metadata avoids storing full sensitive descriptions or decision notes.

## Known Limitations

- No multi-level approvals yet.
- No SLA reminders yet.
- No external email, WhatsApp, or SMS notifications.
- No product entity mutation on approval.
- No student portal approvals.
- No approval policy builder UI yet.

## Future Roadmap

- Multi-step approval policies.
- Approval reminders and escalation.
- Integration with automation actions requiring approval.
- Mobile API exposure for assigned approvals.
- AI-assisted approval summaries.
- Approval analytics in reports/compliance.
