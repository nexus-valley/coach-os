import { Webhook } from "svix";

export const supportedResendEmailEventTypes = [
  "email.bounced",
  "email.complained",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.sent",
  "email.suppressed",
] as const;

export type SupportedResendEmailEventType =
  (typeof supportedResendEmailEventTypes)[number];

export type ResendBounceType = "permanent" | "transient" | "undetermined";

export type VerifiedResendEmailEvent = {
  bounceType: ResendBounceType | null;
  createdAt: string;
  eventType: SupportedResendEmailEventType;
  providerMessageId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeBounceType(value: unknown): ResendBounceType {
  if (typeof value !== "string") {
    return "undetermined";
  }

  switch (value.trim().toLowerCase()) {
    case "permanent":
      return "permanent";
    case "temporary":
    case "transient":
      return "transient";
    case "undetermined":
    default:
      return "undetermined";
  }
}

export function isSupportedResendEmailEventType(
  value: string,
): value is SupportedResendEmailEventType {
  return supportedResendEmailEventTypes.some((item) => item === value);
}

export function verifyResendEmailWebhook(params: {
  rawBody: string;
  signature: string;
  signingSecret: string;
  svixId: string;
  svixTimestamp: string;
}): VerifiedResendEmailEvent | null {
  const verified = new Webhook(params.signingSecret).verify(params.rawBody, {
    "svix-id": params.svixId,
    "svix-signature": params.signature,
    "svix-timestamp": params.svixTimestamp,
  });

  if (!isRecord(verified)) {
    throw new Error("Verified Resend webhook payload is invalid.");
  }

  const eventType = typeof verified.type === "string" ? verified.type : "";
  if (!isSupportedResendEmailEventType(eventType)) {
    return null;
  }

  const data = isRecord(verified.data) ? verified.data : null;
  const providerMessageId =
    data && typeof data.email_id === "string" ? data.email_id.trim() : "";
  const createdAt =
    typeof verified.created_at === "string" ? verified.created_at.trim() : "";
  const bounceType =
    eventType === "email.bounced"
      ? normalizeBounceType(isRecord(data?.bounce) ? data.bounce.type : null)
      : null;

  if (!providerMessageId || !createdAt || Number.isNaN(Date.parse(createdAt))) {
    throw new Error("Verified Resend webhook payload is incomplete.");
  }

  return { bounceType, createdAt, eventType, providerMessageId };
}
