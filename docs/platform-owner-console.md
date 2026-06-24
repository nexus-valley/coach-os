# CoachFort Platform Owner Console

Module 56 adds the CoachFort / Nexus Valley platform-owner console at `/platform`.

This console is separate from:

- `/app`: institute tenant workspace for owners/admin/staff/trainers
- `/portal`: student portal
- tenant finance in `/app/finance`

Tenant `owner` and `admin` roles do not grant platform access.

## Access Model

Platform access is controlled only by `public.platform_admin_users`.

Roles:

- `owner`: manage platform admins, plans, tenant subscriptions, support, and usage snapshots.
- `admin`: manage plans, tenant subscriptions, support, and usage snapshots.
- `finance`: manage platform subscription and payment status only.
- `support`: manage platform support notes only.

Rows must have `status = 'active'` to access `/platform`.

## Bootstrap

After reviewing and executing `supabase/module56_platform_owner_console.sql`, insert the first platform owner manually with the auth user id for the Nexus Valley / CoachFort owner account.

Do not guess the user id. Do not put service-role keys in frontend code.

```sql
insert into public.platform_admin_users (user_id, role, status)
values ('REPLACE_WITH_AUTH_USER_ID', 'owner', 'active')
on conflict (user_id) do update
set role = 'owner', status = 'active', updated_at = now();
```

After this bootstrap, the platform owner can use the provided `manage_platform_admin_user(...)` RPC to add or suspend other platform admins.

## Data Model

Module 56 creates:

- `platform_admin_users`
- `platform_subscription_plans`
- `platform_tenant_subscriptions`
- `platform_tenant_usage_snapshots`
- `platform_support_notes`
- `platform_activity_logs`

Existing tenant billing tables such as `subscriptions`, `invoices`, and `payment_transactions` are left untouched. Module 56 uses `platform_*` tables for CoachFort platform subscription state.

## RPCs

- `get_platform_dashboard()`
- `get_platform_tenants()`
- `get_platform_tenant_detail(p_tenant_id)`
- `upsert_platform_subscription_plan(...)`
- `update_tenant_subscription(...)`
- `record_platform_support_note(...)`
- `update_platform_support_note(...)`
- `capture_platform_usage_snapshot(p_tenant_id)`
- `manage_platform_admin_user(...)`

All writes go through `SECURITY DEFINER` RPCs. Direct authenticated insert/update/delete grants are revoked on platform tables.

## Security Notes

- No anon access.
- No tenant-role based platform access.
- No service-role usage in client code.
- No tenant deletion.
- No tenant impersonation.
- No external payment gateway integration.
- No real money movement.
- No destructive tenant data actions.
- Platform dashboard data is high-level by default and avoids student/payment/CRM/message/AI prompt PII.
- Support note text is stored only in `platform_support_notes`; platform activity and tenant audit metadata store `note_present` instead of full note text.

## Usage Snapshots

Usage snapshots capture high-level counts:

- students
- courses
- team members
- AI request count for the current month
- marketing campaign count
- storage as `0` with metadata noting that storage calculation is not available yet

## Known Limitations

- No payment gateway integration.
- No automatic subscription billing.
- Subscription suspension is recorded as platform subscription status only and does not enforce tenant login blocking.
- No tenant deletion or impersonation.
- No advanced storage calculation.
- No platform-level email or WhatsApp notifications.
- No multi-page platform console yet; Module 56 keeps core sections in `/platform`.

## Future Roadmap

- Platform billing provider integration.
- Tenant suspension enforcement with clear tenant-facing UX.
- Feature flags and plan limit enforcement.
- Platform support ticketing.
- Platform usage trend charts.
- Platform notifications and renewal reminders.
- Safe tenant health scoring.
