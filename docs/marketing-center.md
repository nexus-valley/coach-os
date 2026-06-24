# Marketing Center

Module 54 adds a secure marketing planning foundation for CoachFort.
It builds on CRM leads without sending real WhatsApp, email, or SMS messages.

## Purpose

Marketing Center supports:

- campaign planning
- template drafting
- CRM lead audience selection
- manual touch logging
- campaign activity history
- future provider readiness

It does not implement external provider sending, campaign automation, or
automatic lead conversion.

## Relationship With CRM

- Campaign audiences reference `crm_leads`.
- Staff/trainer access to campaign leads also requires
  `public.crm_lead_is_visible(lead_id)`.
- Marketing does not update `crm_leads.status`.
- Marketing does not create students.
- Marketing audit metadata avoids lead PII.

## Role Access Model

- Owner/admin: manage all campaigns, templates, audience rows, and activity.
- Staff: view assigned campaigns, create self-assigned drafts, add visible CRM
  leads to visible campaigns, and log manual touches.
- Trainer: view assigned campaigns, create self-assigned drafts, add visible CRM
  leads to visible campaigns, and log manual touches.
- Student/anon: no access.

## Data Model

- `marketing_campaigns`: campaign plan, status, assignment, dates, budget.
- `marketing_message_templates`: internal template library.
- `marketing_campaign_leads`: campaign audience members linked to CRM leads.
- `marketing_campaign_activities`: append-style campaign activity and manual
  touch log.

## RPC List

- `create_marketing_campaign`
- `update_marketing_campaign`
- `create_marketing_template`
- `update_marketing_template`
- `add_leads_to_marketing_campaign`
- `update_marketing_campaign_lead`
- `log_marketing_touch`

Direct authenticated writes are revoked. RPCs validate tenant membership,
assignment scope, CRM lead visibility, safe text, metadata size, and allowlists.

## Security Model

- No anon table or RPC access.
- No direct authenticated insert/update/delete on marketing tables.
- SECURITY DEFINER RPCs enforce tenant and role checks manually.
- Helper functions return strict booleans and avoid PostgreSQL keyword variable
  names.
- Audit logs store counts/status IDs only, not full messages, notes, email, or
  phone values.

## Known Limitations

- No WhatsApp/email/SMS provider integration.
- No campaign sending or send buttons.
- No campaign approval requirement yet.
- No campaign automation or scheduled jobs.
- No AI-generated templates yet.
- No advanced analytics beyond placeholder counters.

## Future Roadmap

- Approval-gated campaign launch.
- Workflow-driven campaign preparation.
- Automation reminders for follow-ups.
- Provider integrations for WhatsApp/email/SMS.
- AI-assisted draft generation.
- Mobile campaign task visibility.
