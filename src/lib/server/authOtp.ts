import crypto from "node:crypto";

import { sendOtpEmail } from "@/src/lib/server/email";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export type OtpPurpose = "password_reset" | "signup_email_verification";

const supportedPurposes = new Set<OtpPurpose>([
  "password_reset",
  "signup_email_verification",
]);

const otpLength = 6;
const otpExpiresInMinutes = 10;
const resendCooldownSeconds = 60;
const maxRequestsPerHour = 5;
const maxVerifyAttempts = 5;
const genericOtpResponse =
  "If this email is registered, we have sent a verification code.";

type ChallengeRow = {
  attempt_count: number;
  consumed_at: string | null;
  email_domain: string | null;
  email_normalized: string;
  expires_at: string;
  id: string;
  locked_until: string | null;
  purpose: OtpPurpose;
  verification_token_hash: string | null;
  verified_at: string | null;
};

function getOtpSecret() {
  const secret = process.env.COACHFORT_OTP_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("COACHFORT_OTP_SECRET must be configured server-side.");
  }

  return secret;
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Email is required.");
  }

  const email = value.trim().toLowerCase();
  const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

  if (!emailPattern.test(email) || email.length > 254) {
    throw new Error("Enter a valid email address.");
  }

  return email;
}

export function normalizePurpose(value: unknown) {
  if (
    value !== "signup_email_verification" &&
    value !== "password_reset"
  ) {
    throw new Error("Unsupported OTP purpose.");
  }

  return value satisfies OtpPurpose;
}

function getEmailDomain(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? null;
}

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? null;
}

function hmac(value: string) {
  return crypto
    .createHmac("sha256", getOtpSecret())
    .update(value)
    .digest("hex");
}

function hashOtp(params: { email: string; otp: string; purpose: OtpPurpose }) {
  return hmac(`otp:${params.purpose}:${params.email}:${params.otp}`);
}

function hashResetToken(params: {
  email: string;
  purpose: OtpPurpose;
  token: string;
}) {
  return hmac(`reset-token:${params.purpose}:${params.email}:${params.token}`);
}

function timingSafeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function generateOtp() {
  const max = 10 ** otpLength;
  return crypto.randomInt(0, max).toString().padStart(otpLength, "0");
}

function generateResetToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function getRequestHashes(request: Request) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent");

  return {
    createdIpHash: ip ? hmac(`ip:${ip}`) : null,
    userAgentHash: userAgent ? hmac(`ua:${userAgent}`) : null,
  };
}

async function writeOtpAudit(params: {
  action:
    | "otp_failed_verification"
    | "otp_rate_limited"
    | "password_reset_completed"
    | "password_reset_otp_requested"
    | "password_reset_otp_verified"
    | "signup_otp_requested"
    | "signup_otp_verified";
  challengeId?: string | null;
  email: string;
  metadata?: Record<string, unknown>;
  purpose: OtpPurpose;
}) {
  try {
    const supabase = getSupabaseAdminClient();
    await supabase.from("auth_otp_audit_logs").insert({
      action: params.action,
      challenge_id: params.challengeId ?? null,
      email_domain: getEmailDomain(params.email),
      metadata: params.metadata ?? {},
      purpose: params.purpose,
    });
  } catch {
    // OTP audit must not leak secrets or block generic auth responses.
  }
}

function getRequestAuditAction(purpose: OtpPurpose) {
  return purpose === "password_reset"
    ? "password_reset_otp_requested"
    : "signup_otp_requested";
}

function getVerifiedAuditAction(purpose: OtpPurpose) {
  return purpose === "password_reset"
    ? "password_reset_otp_verified"
    : "signup_otp_verified";
}

async function enforceRequestRateLimit(params: {
  email: string;
  purpose: OtpPurpose;
}) {
  const supabase = getSupabaseAdminClient();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("auth_otp_challenges")
    .select("id,last_sent_at")
    .eq("email_normalized", params.email)
    .eq("purpose", params.purpose)
    .gte("created_at", oneHourAgo)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const recent = data ?? [];
  const latest = recent[0];

  if (latest?.last_sent_at) {
    const elapsedSeconds =
      (Date.now() - new Date(latest.last_sent_at).getTime()) / 1000;

    if (elapsedSeconds < resendCooldownSeconds) {
      await writeOtpAudit({
        action: "otp_rate_limited",
        challengeId: latest.id,
        email: params.email,
        metadata: { reason: "cooldown" },
        purpose: params.purpose,
      });
      throw new Error("Please wait before requesting another code.");
    }
  }

  if (recent.length >= maxRequestsPerHour) {
    await writeOtpAudit({
      action: "otp_rate_limited",
      challengeId: latest?.id ?? null,
      email: params.email,
      metadata: { reason: "hourly_limit" },
      purpose: params.purpose,
    });
    throw new Error("Please wait before requesting another code.");
  }
}

export async function requestOtp(params: {
  email: string;
  purpose: OtpPurpose;
  request: Request;
}) {
  if (!supportedPurposes.has(params.purpose)) {
    throw new Error("Unsupported OTP purpose.");
  }

  await enforceRequestRateLimit(params);

  const supabase = getSupabaseAdminClient();
  const otp = generateOtp();
  const emailDomain = getEmailDomain(params.email);
  const { createdIpHash, userAgentHash } = getRequestHashes(params.request);
  const expiresAt = new Date(
    Date.now() + otpExpiresInMinutes * 60 * 1000,
  ).toISOString();
  const delivery = await sendOtpEmail({
    email: params.email,
    expiresInMinutes: otpExpiresInMinutes,
    otp,
    purpose: params.purpose,
  });

  const { data, error } = await supabase
    .from("auth_otp_challenges")
    .insert({
      created_ip_hash: createdIpHash,
      email_domain: emailDomain,
      email_normalized: params.email,
      expires_at: expiresAt,
      last_sent_at: new Date().toISOString(),
      metadata: {
        delivery_provider: delivery.provider,
        email_delivered: delivery.delivered,
      },
      otp_hash: hashOtp({
        email: params.email,
        otp,
        purpose: params.purpose,
      }),
      purpose: params.purpose,
      resend_count: 0,
      user_agent_hash: userAgentHash,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  await writeOtpAudit({
    action: getRequestAuditAction(params.purpose),
    challengeId: data.id,
    email: params.email,
    metadata: {
      delivery_provider: delivery.provider,
      email_delivered: delivery.delivered,
    },
    purpose: params.purpose,
  });

  return {
    message: genericOtpResponse,
  };
}

async function getLatestActiveChallenge(params: {
  email: string;
  purpose: OtpPurpose;
}) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("auth_otp_challenges")
    .select(
      "id,purpose,email_normalized,email_domain,expires_at,consumed_at,verified_at,attempt_count,locked_until,verification_token_hash",
    )
    .eq("email_normalized", params.email)
    .eq("purpose", params.purpose)
    .is("completed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as ChallengeRow | null) ?? null;
}

export async function verifyOtp(params: {
  email: string;
  otp: string;
  purpose: OtpPurpose;
}) {
  if (!/^\d{6}$/.test(params.otp)) {
    throw new Error("Invalid or expired code.");
  }

  const supabase = getSupabaseAdminClient();
  const challenge = await getLatestActiveChallenge(params);

  if (!challenge) {
    throw new Error("Invalid or expired code.");
  }

  if (challenge.consumed_at) {
    throw new Error("Invalid or expired code.");
  }

  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    throw new Error("Invalid or expired code.");
  }

  if (
    challenge.locked_until &&
    new Date(challenge.locked_until).getTime() > Date.now()
  ) {
    throw new Error("Too many attempts. Request a new code.");
  }

  const expected = hashOtp({
    email: params.email,
    otp: params.otp,
    purpose: params.purpose,
  });

  const { data: fullChallenge, error: fullChallengeError } = await supabase
    .from("auth_otp_challenges")
    .select("otp_hash")
    .eq("id", challenge.id)
    .single();

  if (fullChallengeError) {
    throw fullChallengeError;
  }

  const matches = timingSafeEqualHex(fullChallenge.otp_hash, expected);

  if (!matches) {
    const nextAttemptCount = challenge.attempt_count + 1;
    await supabase
      .from("auth_otp_challenges")
      .update({
        attempt_count: nextAttemptCount,
        locked_until:
          nextAttemptCount >= maxVerifyAttempts
            ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
            : null,
      })
      .eq("id", challenge.id);

    await writeOtpAudit({
      action: "otp_failed_verification",
      challengeId: challenge.id,
      email: params.email,
      metadata: {
        reason:
          nextAttemptCount >= maxVerifyAttempts
            ? "max_attempts_locked"
            : "invalid_code",
      },
      purpose: params.purpose,
    });

    throw new Error(
      nextAttemptCount >= maxVerifyAttempts
        ? "Too many attempts. Request a new code."
        : "Invalid or expired code.",
    );
  }

  const resetToken =
    params.purpose === "password_reset" ? generateResetToken() : null;

  const { error } = await supabase
    .from("auth_otp_challenges")
    .update({
      consumed_at: new Date().toISOString(),
      verification_token_hash: resetToken
        ? hashResetToken({
            email: params.email,
            purpose: params.purpose,
            token: resetToken,
          })
        : null,
      verified_at: new Date().toISOString(),
    })
    .eq("id", challenge.id);

  if (error) {
    throw error;
  }

  await writeOtpAudit({
    action: getVerifiedAuditAction(params.purpose),
    challengeId: challenge.id,
    email: params.email,
    metadata: { result: "success" },
    purpose: params.purpose,
  });

  return {
    resetToken,
    verified: true,
  };
}

async function findUserIdByEmail(email: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data?.id as string | undefined) ?? null;
}

export async function resetPasswordWithToken(params: {
  email: string;
  newPassword: string;
  resetToken: string;
}) {
  if (params.newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const supabase = getSupabaseAdminClient();
  const tokenHash = hashResetToken({
    email: params.email,
    purpose: "password_reset",
    token: params.resetToken,
  });
  const { data: challenge, error } = await supabase
    .from("auth_otp_challenges")
    .select(
      "id,purpose,email_normalized,email_domain,expires_at,consumed_at,verified_at,completed_at,verification_token_hash",
    )
    .eq("email_normalized", params.email)
    .eq("purpose", "password_reset")
    .eq("verification_token_hash", tokenHash)
    .not("verified_at", "is", null)
    .is("completed_at", null)
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (
    !challenge ||
    new Date(challenge.expires_at).getTime() < Date.now()
  ) {
    throw new Error("Password reset verification has expired.");
  }

  const userId = await findUserIdByEmail(params.email);

  if (userId) {
    const updateResult = await supabase.auth.admin.updateUserById(userId, {
      password: params.newPassword,
    });

    if (updateResult.error) {
      throw updateResult.error;
    }
  }

  const completedAt = new Date().toISOString();
  const updateChallenge = await supabase
    .from("auth_otp_challenges")
    .update({
      completed_at: completedAt,
      verification_token_hash: null,
    })
    .eq("id", challenge.id);

  if (updateChallenge.error) {
    throw updateChallenge.error;
  }

  await writeOtpAudit({
    action: "password_reset_completed",
    challengeId: challenge.id,
    email: params.email,
    metadata: { user_found: Boolean(userId) },
    purpose: "password_reset",
  });

  return {
    message: "Your password has been reset. You can now log in.",
  };
}
