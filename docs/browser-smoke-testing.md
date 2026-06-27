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

## Authenticated Smoke Tests

Authenticated tests are skipped unless these environment variables are present:

```text
COACHFORT_OWNER_EMAIL
COACHFORT_ADMIN_EMAIL
COACHFORT_STUDENT_EMAIL
COACHFORT_TEST_PASSWORD
```

Do not commit secrets or `.env` files. Use local shell environment variables or a secure CI secret store.

## Covered

- Public production route availability.
- Login route availability.
- Protected document routes returning a real page or safe auth redirect.
- Optional owner/admin/student browser login checks for Document Center.

## Not Covered

- Deep data mutation workflows.
- Cross-tenant database probes.
- Supabase RLS/RPC security checks.
- Payment gateway flows.
- Email, WhatsApp, SMS, or push notification delivery.

Those checks remain part of module-specific backend and security smoke tests.
