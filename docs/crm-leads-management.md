# CRM & Leads Management

Module 53 adds an internal CRM pipeline for enquiries and admissions follow-up.
It complements, but does not replace, public website lead capture.

## Relationship to Public Site Leads

- `public_site_leads` remains the raw inbound enquiry table used by the public
  website form.
- `crm_leads` is the internal working pipeline used by tenant team members.
- Owner/admin users can import a `public_site_leads` row into `crm_leads`.
- Public site leads are not deleted or mutated by CRM import.
- Duplicate CRM imports for the same public site lead are rejected.

## Role Access Model

- Owner/admin: see all tenant CRM leads, import public leads, assign/reassign,
  update any status, add notes, and manage follow-up tasks.
- Staff: can create leads, view/update assigned leads, add notes, and manage
  assigned follow-ups.
- Trainer: can view/update assigned leads, add notes, and manage assigned
  follow-ups.
- Student/anon: no CRM access.

Staff and trainer visibility is assignment-scoped through `assigned_to` or
`assigned_role`. Helper functions return strict true/false to avoid nullable
authorization checks.

## Data Model

- `crm_leads`: internal lead pipeline, assignment, status, priority, source,
  tags, follow-up dates, and optional link to a public site lead.
- `crm_lead_notes`: controlled notes with private-note support.
- `crm_follow_up_tasks`: manual follow-up work items for leads.
- `crm_activity_logs`: append-style CRM activity trail.

## RPC Write Model

Direct authenticated insert/update/delete is revoked on CRM tables. Writes use:

- `create_crm_lead`
- `create_crm_lead_from_public_site_lead`
- `update_crm_lead`
- `add_crm_lead_note`
- `create_crm_follow_up_task`
- `update_crm_follow_up_task`

RPCs validate tenant membership, assignment scope, status/priority/source
allowlists, same-tenant course/assignee references, text length, metadata size,
and unsafe `<` or `>` characters.

## Audit And Activity

CRM RPCs write safe metadata to `audit_logs` and append CRM-specific events to
`crm_activity_logs`.

Audit metadata intentionally avoids full note bodies and direct lead PII. Lead
contact details remain in the CRM tables under tenant-scoped RLS.

## Known Limitations

- No automatic lead-to-student conversion.
- No email, WhatsApp, or SMS sending.
- No campaign manager or marketing automation.
- No bulk CSV import UI.
- Direct user assignment is supported by SQL but the first UI focuses on
  role-based assignment.
- Approval/workflow integration is documented for future modules but not wired
  in this foundation.

## Future Roadmap

- Approval-gated lead conversion to student.
- Lead onboarding workflow start after conversion.
- Automation reminders for overdue follow-ups.
- Campaign attribution and lead source analytics.
- Mobile CRM endpoints and push reminders.
