# CoachFort Regression Test Accounts

These accounts are for repeatable CoachFort regression and demo testing only. Do not use them for customer data or production operations outside controlled validation.

## Tenant

- Name: CoachFort Regression Academy
- Slug: coachfort-regression
- Login URL: https://coachfort.com/login

## Setup

Run the setup script with a Supabase service role key available only in your local/admin environment:

```bash
npm run regression:accounts
```

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional environment variables:

- `REGRESSION_TEST_PASSWORD`
- `REGRESSION_INCLUDE_OPTIONAL_ACCOUNTS=true`

If `REGRESSION_TEST_PASSWORD` is omitted, the script uses the default regression password from the Module 43.4 setup request. The script never prints the password or service role key.

## Required Accounts

| Role | Email | Purpose |
| --- | --- | --- |
| Owner | owner.regression@coachfort.demo | Full workspace ownership, billing, settings, permissions, operations |
| Admin | admin.regression@coachfort.demo | Admin management flows and pending delegated permission requests |
| Staff | staff.regression@coachfort.demo | Staff restrictions, read-only/limited operational flows |
| Trainer | trainer.regression@coachfort.demo | Trainer scoping, assignments, attendance, sessions, delegated exceptions |
| Student | student.regression@coachfort.demo | Student Auth identity plus linked `students` table record where supported |

## Optional Accounts

Set `REGRESSION_INCLUDE_OPTIONAL_ACCOUNTS=true` to create these additional staff users:

| Department | Email | Purpose |
| --- | --- | --- |
| Finance | finance.regression@coachfort.demo | Payment/report delegated permission testing |
| Sales | sales.regression@coachfort.demo | Lead/student intake testing |
| Support | support.regression@coachfort.demo | Support/communication testing |

## Notes

- The script is idempotent and never deletes users, tenants, memberships, or student records.
- `tenant_members.role` currently supports `owner`, `admin`, `staff`, and `trainer`. The student account is created in Supabase Auth and linked to a `students` row, but is not inserted as a `tenant_members` role unless the production role model later supports it.
- Re-running the script updates Auth metadata, profiles, tenant ownership, tenant member roles, and the linked regression student record.
- Keep `SUPABASE_SERVICE_ROLE_KEY` out of source control and frontend code.
