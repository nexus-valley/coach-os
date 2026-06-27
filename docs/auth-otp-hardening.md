# Module 61: Signup OTP and Password Reset Hardening

## Purpose

Module 61 hardens CoachFort authentication for email/password users by adding server-managed OTP verification for institute signup and password reset.

Google OAuth remains unchanged and does not require OTP.

## Routes

- `/signup`: email/password signup now requests and verifies a 6-digit OTP before creating the Supabase auth user.
- `/login`: adds a `Forgot password?` link.
- `/forgot-password`: requests a password reset OTP with a generic response.
- `/reset-password`: verifies OTP and resets the password using server-only Supabase admin logic.

## API Routes

- `POST /api/auth/request-otp`
- `POST /api/auth/verify-otp`
- `POST /api/auth/reset-password`

The browser never receives service-role credentials and never manages OTP hashes directly.

## Data Model

Migration: `supabase/module61_auth_otp_hardening.sql`

Tables:

- `auth_otp_challenges`
- `auth_otp_audit_logs`

OTP challenges store only hashes, expiry, attempt counters, lock/cooldown data, and safe metadata. Plain OTP values are never stored.

## Workspace Creation Guard

The migration updates `create_workspace_with_owner(...)` and onboarding insert policies so email/password users must have a consumed signup OTP challenge before workspace creation.

OAuth users with a non-email auth provider can continue onboarding without OTP.

## Email Provider

The server email abstraction is Resend-ready:

- `RESEND_API_KEY`
- `COACHFORT_EMAIL_FROM`

If no provider is configured, the API still returns a generic response and logs only non-sensitive provider status in development. It never logs OTP values.

## Required Environment Variables

- `COACHFORT_OTP_SECRET`: server-only HMAC secret, at least 32 characters.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only, required for password reset/admin updates.
- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`.
- `RESEND_API_KEY` and `COACHFORT_EMAIL_FROM` for real email delivery.

Do not expose these in client code or commit real values.

## Security Rules

- OTP length: 6 numeric digits.
- Expiry: 10 minutes.
- Max verification attempts: 5.
- Resend cooldown: 60 seconds.
- Hourly request limit: 5 per email/purpose.
- OTP is consumed after successful verification.
- Password reset uses a short-lived server-generated reset token after OTP verification.
- Password reset responses do not reveal whether an email exists.
- Audit metadata excludes OTPs, passwords, and raw emails.

## Known Limitations

- Real email delivery requires Resend configuration.
- No SMS/WhatsApp OTP provider.
- No scheduled cleanup job for expired challenges yet.
- Existing invite acceptance remains routed through normal signup/login and is not otherwise changed.
