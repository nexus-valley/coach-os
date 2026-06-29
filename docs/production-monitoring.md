# Production Monitoring

Module 67 adds production monitoring and safe error tracking for CoachFort.

## Provider

CoachFort uses the official Sentry SDK for Next.js.

Monitoring is disabled automatically when no Sentry DSN is configured, so local
development and preview builds continue to work without provider credentials.

## Environment Variables

Configure these in Vercel or the local shell as needed:

```text
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_ENVIRONMENT=
NEXT_PUBLIC_APP_ENV=
NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA=
```

`NEXT_PUBLIC_SENTRY_DSN` is the only browser-visible value. Keep
`SENTRY_AUTH_TOKEN` server-side only. Do not commit real values.

## Captured Events

- Browser runtime errors through Next client instrumentation.
- Server and route runtime errors through `instrumentation.ts`.
- App Router error boundaries through `app/error.tsx`, `app/global-error.tsx`,
  and `app/app/error.tsx`.
- Selected high-risk API failures for document upload/download/remove and OTP
  request/reset server failures.

## Scrubbing

Events are scrubbed before being sent. The scrubber redacts fields whose keys
look like:

- passwords or passcodes
- auth tokens, authorization headers, cookies, secrets, service-role keys
- OTPs, OTP hashes, verification codes, reset tokens
- signed URLs
- storage bucket/path values
- payment identifiers and card-like fields
- file contents

Sentry is configured with `sendDefaultPii: false`. User email and IP address are
not intentionally attached.

## Health Endpoint

`GET /api/health` returns a non-sensitive payload:

```json
{
  "status": "ok",
  "timestamp": "2026-06-29T00:00:00.000Z",
  "environment": "production",
  "release": "shortsha",
  "monitoringEnabled": true
}
```

The endpoint does not expose tenant data, user data, database credentials,
service-role keys, provider tokens, or database connectivity details.

## Source Maps

Source map upload is enabled only when all of these are configured:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

Builds do not fail if these values are missing. Source maps are deleted after
upload when upload is enabled.

## Vercel Setup

1. Create a Sentry project for the Next.js app.
2. Add `NEXT_PUBLIC_SENTRY_DSN` and optionally `SENTRY_DSN`.
3. Add `SENTRY_ENVIRONMENT=production` or use Vercel's environment labels.
4. Add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` only if source
   map upload should run during production builds.
5. Configure Sentry alerts for new issues, high error rate, and health-check
   failures through the provider dashboard.

## Local Testing

Run:

```bash
npx tsc --noEmit
npm run lint
npm run build
npm run test:e2e
npm run test:e2e:public
```

To test event delivery locally, set a Sentry DSN in the local environment and
trigger a real local error. Do not add a public test-error route to production.

## Disable Monitoring

Remove the DSN environment variables. The runtime config remains installed, but
capture helpers become no-ops.

## Privacy Notes

Monitoring is for operational failures, not product analytics. Do not send raw
student data, document contents, OTPs, passwords, payment details, private
notes, AI prompts/responses, or signed URLs to Sentry.
