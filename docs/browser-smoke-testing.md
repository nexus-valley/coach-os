# Browser Smoke Testing

CoachFort uses Playwright for lightweight browser smoke tests against production or another configured deployment.

## Install

```bash
npm install
npx playwright install chromium
```

The project intentionally installs Chromium only for now.

## Run

```bash
npm run test:e2e
```

By default, tests run against:

```text
https://coachfort.com
```

To target another deployment:

```bash
PLAYWRIGHT_BASE_URL=https://your-preview-url.example npm run test:e2e
```

Targeted suites:

```bash
npm run test:e2e:public
npm run test:e2e:auth
npm run test:e2e:prod
```

`test:e2e:public` runs public route availability and static route/security checks.
`test:e2e:auth` runs only authenticated role and module smoke tests.
`test:e2e:prod` is an alias for the full production-oriented suite.

## Authenticated Smoke Tests

Authenticated tests are skipped unless these environment variables are present:

```text
COACHFORT_OWNER_EMAIL
COACHFORT_ADMIN_EMAIL
COACHFORT_STAFF_EMAIL
COACHFORT_TRAINER_EMAIL
COACHFORT_STUDENT_EMAIL
COACHFORT_PLATFORM_OWNER_EMAIL
COACHFORT_TEST_PASSWORD
```

Do not commit secrets or `.env` files. Use local shell environment variables or a secure CI secret store.

## Covered

- Public production route availability.
- Login route availability.
- Signup, forgot-password, reset-password, and student portal login routes.
- Protected app, portal, and platform routes returning a real page or safe auth redirect.
- Optional owner/admin/staff/trainer/student/platform browser login checks.
- Owner/admin access to students, courses, finance, reports, documents, messages, and feature settings.
- Staff/trainer blocked-state checks for restricted admin modules.
- Student portal isolation checks for payments, documents, messages, assignments, and `/app` blocking.
- Platform owner access and tenant-user platform blocking.
- Legacy payment route behavior from Module 64.
- Static route guard and feature mapping checks from Module 65.
- Static client/browser scan for service-role usage in critical document and test surfaces.

## Not Covered

- Deep data mutation workflows.
- Cross-tenant database probes.
- Supabase RLS/RPC security checks.
- Payment gateway flows.
- Email, WhatsApp, SMS, or push notification delivery.
- Feature toggle mutation tests in the committed suite.
- Secure document upload/download mutation tests.

Those checks remain part of module-specific backend and security smoke tests.

## Cleanup Notes

The committed browser suite is intentionally non-destructive. It does not create
documents, invoices, payments, chats, reports, or feature-setting changes.
Module-specific smoke tests may temporarily toggle features or create records,
but those tests must restore settings and clean up records before they finish.

## Secret Safety

Never hardcode passwords, OTPs, service-role keys, or provider keys in test
files. Playwright output should not print secret values. Keep real secrets in
local shell variables, `.env.local`, or CI secret storage only.
