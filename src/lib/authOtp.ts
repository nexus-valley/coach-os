export type AuthOtpPurpose = "password_reset" | "signup_email_verification";

async function postAuthOtp<TResponse>(
  path: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
  } & TResponse;

  if (!response.ok) {
    throw new Error(payload.message ?? "Unable to complete this request.");
  }

  return payload;
}

export function requestAuthOtp(params: {
  email: string;
  purpose: AuthOtpPurpose;
}) {
  return postAuthOtp<{ message: string }>("/api/auth/request-otp", params);
}

export function verifyAuthOtp(params: {
  email: string;
  otp: string;
  purpose: AuthOtpPurpose;
}) {
  return postAuthOtp<{ resetToken?: string | null; verified: boolean }>(
    "/api/auth/verify-otp",
    params,
  );
}

export function resetPasswordWithOtp(params: {
  email: string;
  newPassword: string;
  resetToken: string;
}) {
  return postAuthOtp<{ message: string }>("/api/auth/reset-password", params);
}
