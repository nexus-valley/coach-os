export const studentPortalInvitationSendErrorCodes = [
  "server_admin_not_configured",
  "unauthorized",
  "forbidden",
  "invalid_request",
  "eligibility_read_failed",
  "invitation_prepare_failed",
  "invitation_not_sendable",
  "email_not_configured",
  "email_delivery_failed",
  "invitation_delivery_record_failed",
] as const;

export type StudentPortalInvitationSendErrorCode =
  (typeof studentPortalInvitationSendErrorCodes)[number];

export type StudentPortalInvitationErrorPayload = {
  error_code: StudentPortalInvitationSendErrorCode;
  message: string;
  safe_provider_code?: string;
  status: "needs_attention";
};

const postgresCodePattern = /^[0-9A-Z]{5}$/;
const postgrestCodePattern = /^PGRST[0-9A-Z]{3}$/;

export function isStudentPortalInvitationSendErrorCode(
  value: unknown,
): value is StudentPortalInvitationSendErrorCode {
  return (
    typeof value === "string" &&
    studentPortalInvitationSendErrorCodes.some((code) => code === value)
  );
}

export function getSafePostgrestCode(value: unknown) {
  const candidate =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "code" in value
        ? Reflect.get(value, "code")
        : null;

  if (typeof candidate !== "string") {
    return null;
  }

  const normalized = candidate.trim().toUpperCase();

  if (
    !postgresCodePattern.test(normalized) &&
    !postgrestCodePattern.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function createStudentPortalInvitationErrorPayload(params: {
  errorCode: StudentPortalInvitationSendErrorCode;
  message: string;
  providerError?: unknown;
}): StudentPortalInvitationErrorPayload {
  const safeProviderCode = getSafePostgrestCode(params.providerError);

  return {
    error_code: params.errorCode,
    message: params.message,
    ...(safeProviderCode ? { safe_provider_code: safeProviderCode } : {}),
    status: "needs_attention",
  };
}

export class StudentPortalInvitationActionError extends Error {
  readonly errorCode: StudentPortalInvitationSendErrorCode | null;
  readonly safeProviderCode: string | null;

  constructor(params: {
    errorCode?: unknown;
    message: string;
    safeProviderCode?: unknown;
  }) {
    super(params.message);
    this.name = "StudentPortalInvitationActionError";
    this.errorCode = isStudentPortalInvitationSendErrorCode(params.errorCode)
      ? params.errorCode
      : null;
    this.safeProviderCode = getSafePostgrestCode(params.safeProviderCode);
  }
}
