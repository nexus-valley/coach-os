export type StudentPortalInvitationAcceptanceErrorCode =
  | "email_mismatch"
  | "invitation_expired"
  | "invitation_unavailable"
  | "needs_attention";

type AcceptanceFailure = {
  code: StudentPortalInvitationAcceptanceErrorCode;
  httpStatus: number;
  message: string;
};

const wrongIdentityMessage =
  "sign in with the email address that received this invitation.";

const acceptanceFailures: Record<
  StudentPortalInvitationAcceptanceErrorCode,
  AcceptanceFailure
> = {
  email_mismatch: {
    code: "email_mismatch",
    httpStatus: 409,
    message:
      "This invitation was sent to a different email address. Continue with the email address that received it.",
  },
  invitation_expired: {
    code: "invitation_expired",
    httpStatus: 410,
    message: "This invitation has expired. Ask your coach to send a new one.",
  },
  invitation_unavailable: {
    code: "invitation_unavailable",
    httpStatus: 410,
    message:
      "This invitation is no longer available. Ask your coach for a new invitation.",
  },
  needs_attention: {
    code: "needs_attention",
    httpStatus: 409,
    message:
      "Portal access needs attention. Please contact your coach or CoachFort support.",
  },
};

function getProviderField(value: unknown, field: "code" | "message") {
  if (!value || typeof value !== "object" || !(field in value)) {
    return "";
  }

  const candidate = Reflect.get(value, field);
  return typeof candidate === "string" ? candidate.trim() : "";
}

export function classifyStudentPortalInvitationAcceptanceError(
  providerError: unknown,
): StudentPortalInvitationAcceptanceErrorCode {
  const providerCode = getProviderField(providerError, "code").toUpperCase();
  const normalizedMessage = getProviderField(providerError, "message")
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (
    providerCode === "42501" &&
    normalizedMessage === wrongIdentityMessage
  ) {
    return "email_mismatch";
  }

  if (normalizedMessage.includes("expired")) {
    return "invitation_expired";
  }

  if (
    normalizedMessage.includes("not found") ||
    normalizedMessage.includes("invalid") ||
    normalizedMessage.includes("revoked")
  ) {
    return "invitation_unavailable";
  }

  return "needs_attention";
}

export function classifyStudentPortalInvitationAcceptanceResult(
  result: unknown,
): StudentPortalInvitationAcceptanceErrorCode | null {
  if (!result || typeof result !== "object") {
    return "needs_attention";
  }

  const accessStatus = Reflect.get(result, "access_status");
  const status = Reflect.get(result, "status");

  if (accessStatus === "access_active") {
    return null;
  }

  if (accessStatus === "invitation_expired" || status === "expired") {
    return "invitation_expired";
  }

  if (status === "revoked") {
    return "invitation_unavailable";
  }

  return "needs_attention";
}

export function getStudentPortalInvitationAcceptanceFailure(
  code: StudentPortalInvitationAcceptanceErrorCode,
) {
  return acceptanceFailures[code];
}

export function shouldClearStudentPortalInvitationToken(
  code: string,
) {
  return code === "invitation_expired" || code === "invitation_unavailable";
}
