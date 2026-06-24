# Workflow Builder

Module 51 adds a human-controlled workflow foundation for CoachFort.

## Purpose

Workflow Builder tracks repeatable institute processes such as student onboarding, course launches, payment follow-up, assignment review, session preparation, and certificate issuance checklists.

It does not execute product actions automatically.

## Workflow vs Automation

- Automation engine: event-triggered rules that can create internal notifications, reminders, logs, and future integrations.
- Workflow Builder: structured manual processes, checklist runs, assigned tasks, and audit trails.

Future modules may connect automation to workflow starts, but only through explicit, permissioned paths.

## Role Access

- Owner/admin: create, edit, archive templates; start workflow runs; view all tenant runs and activity.
- Staff/trainer: view assigned workflow runs/tasks; update assigned step status and notes.
- Students/anonymous users: no internal workflow access.

## Data Model

- `workflow_templates`: tenant-scoped reusable process definitions.
- `workflow_template_steps`: ordered template steps.
- `workflow_runs`: live human-controlled instances started from active templates.
- `workflow_run_steps`: task/checklist instances assigned to a user or role.
- `workflow_activity_logs`: append-style workflow activity trail.

## RPC Write Model

Direct authenticated inserts/updates/deletes are revoked for workflow tables. Writes use SECURITY DEFINER RPCs:

- `create_workflow_template`
- `update_workflow_template`
- `archive_workflow_template`
- `start_workflow_run`
- `update_workflow_run_step`

The RPCs validate tenant membership, owner/admin management rights, assigned task access, text length, step limits, metadata shape, and status transitions.

## Security Model

- RLS is enabled on all workflow tables.
- Owner/admin can read all tenant workflow data.
- Staff/trainer can read visible runs and assigned steps only.
- Staff/trainer can update only assigned steps through the RPC.
- No workflow step updates students, payments, attendance, sessions, courses, automations, or settings.
- Workflow events are written to `audit_logs` and `workflow_activity_logs`.

## Limits

- Maximum 50 steps per template.
- Maximum step order 100.
- HTML-like `<` and `>` characters are rejected in editable text.
- Metadata must be a small JSON object.
- No drag-and-drop builder yet.
- No workflow automation execution yet.
- No approval engine integration yet.
- No student portal workflow exposure.

## Future Roadmap

- Approval gates backed by a dedicated approval engine.
- Automation-triggered workflow starts.
- Mobile API exposure for assigned workflow tasks.
- AI-assisted workflow template suggestions.
- More granular assignee selection by individual user.
- Workflow analytics in reports and operations.
