import {
  buildCoachWelcomeEmail,
  buildSubscriptionLifecycleEmail,
  buildWorkspaceReadyEmail,
  type CoachFortEmailTemplate,
} from "@/src/lib/server/emailTemplates";

export const transactionalEmailTemplateKeys = [
  "coach.welcome",
  "coach.workspace_ready",
  "billing.subscription_lifecycle",
] as const;

export type TransactionalEmailTemplateKey =
  (typeof transactionalEmailTemplateKeys)[number];

type JsonObject = Record<string, unknown>;
const maxTemplatePayloadBytes = 8192;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(payload: JsonObject, key: string) {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("Transactional email template payload is invalid.");
  }
  return value;
}

function requiredString(payload: JsonObject, key: string) {
  const value = optionalString(payload, key)?.trim();
  if (!value) {
    throw new Error("Transactional email template payload is invalid.");
  }
  return value;
}

function assertExactKeys(payload: JsonObject, allowed: readonly string[]) {
  if (Object.keys(payload).some((key) => !allowed.includes(key))) {
    throw new Error("Transactional email template payload is invalid.");
  }
}

function assertPayloadSize(payload: JsonObject) {
  if (
    Buffer.byteLength(JSON.stringify(payload), "utf8") > maxTemplatePayloadBytes
  ) {
    throw new Error("Transactional email template payload is invalid.");
  }
}

function requiredHttpUrl(payload: JsonObject, key: string) {
  const value = requiredString(payload, key);

  if (value.length > 2048) {
    throw new Error("Transactional email template payload is invalid.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Transactional email template payload is invalid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Transactional email template payload is invalid.");
  }

  return value;
}

export function isTransactionalEmailTemplateKey(
  value: string,
): value is TransactionalEmailTemplateKey {
  return transactionalEmailTemplateKeys.some((key) => key === value);
}

export function renderTransactionalEmailTemplate(
  templateKey: string,
  rawPayload: unknown,
): CoachFortEmailTemplate {
  if (!isTransactionalEmailTemplateKey(templateKey) || !isObject(rawPayload)) {
    throw new Error("Transactional email template is unsupported.");
  }

  assertPayloadSize(rawPayload);

  if (templateKey === "coach.welcome") {
    assertExactKeys(rawPayload, ["coachName", "tenantName"]);
    return buildCoachWelcomeEmail({
      coachName: optionalString(rawPayload, "coachName"),
      tenantName: optionalString(rawPayload, "tenantName"),
    });
  }

  if (templateKey === "billing.subscription_lifecycle") {
    assertExactKeys(rawPayload, [
      "deadlineDate",
      "event",
      "planName",
      "subscriptionUrl",
      "supportUrl",
      "workspaceName",
    ]);
    const event = requiredString(rawPayload, "event");
    if (
      ![
        "grace_ending",
        "grace_started",
        "renewal_due_soon",
        "subscription_expired",
        "trial_ending",
        "trial_expired",
      ].includes(event)
    ) {
      throw new Error("Transactional email template payload is invalid.");
    }
    const deadlineDate = requiredString(rawPayload, "deadlineDate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) {
      throw new Error("Transactional email template payload is invalid.");
    }

    return buildSubscriptionLifecycleEmail({
      deadlineDate,
      event: event as Parameters<
        typeof buildSubscriptionLifecycleEmail
      >[0]["event"],
      planName: optionalString(rawPayload, "planName"),
      subscriptionUrl: requiredHttpUrl(rawPayload, "subscriptionUrl"),
      supportUrl: requiredHttpUrl(rawPayload, "supportUrl"),
      workspaceName: requiredString(rawPayload, "workspaceName"),
    });
  }

  assertExactKeys(rawPayload, ["appUrl", "publicPageUrl", "tenantName"]);
  return buildWorkspaceReadyEmail({
    appUrl: requiredHttpUrl(rawPayload, "appUrl"),
    publicPageUrl: optionalString(rawPayload, "publicPageUrl"),
    tenantName: optionalString(rawPayload, "tenantName"),
  });
}
