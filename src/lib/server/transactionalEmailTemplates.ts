import {
  buildCoachWelcomeEmail,
  buildWorkspaceReadyEmail,
  type CoachFortEmailTemplate,
} from "@/src/lib/server/emailTemplates";

export const transactionalEmailTemplateKeys = [
  "coach.welcome",
  "coach.workspace_ready",
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

  assertExactKeys(rawPayload, ["appUrl", "publicPageUrl", "tenantName"]);
  return buildWorkspaceReadyEmail({
    appUrl: requiredHttpUrl(rawPayload, "appUrl"),
    publicPageUrl: optionalString(rawPayload, "publicPageUrl"),
    tenantName: optionalString(rawPayload, "tenantName"),
  });
}
