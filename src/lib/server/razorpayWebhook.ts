import { createHash, createHmac, timingSafeEqual } from "crypto";

export type RazorpayWebhookConfig = {
  mode: "test";
  webhookSecret: string;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

export function getRazorpayWebhookConfig(): RazorpayWebhookConfig {
  const mode = requiredEnv("RAZORPAY_MODE");

  if (mode !== "test") {
    throw new Error("Razorpay webhook processing is restricted to test mode.");
  }

  return {
    mode,
    webhookSecret: requiredEnv("RAZORPAY_WEBHOOK_SECRET"),
  };
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function verifyRazorpayWebhookSignature(params: {
  rawBody: string;
  signature: string | null;
  webhookSecret: string;
}) {
  const signature = params.signature?.trim() ?? "";

  if (!signature || !/^[a-f0-9]+$/i.test(signature)) {
    return false;
  }

  const expected = createHmac("sha256", params.webhookSecret)
    .update(params.rawBody, "utf8")
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function parseRazorpayWebhookPayload(rawBody: string) {
  const value = JSON.parse(rawBody) as unknown;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Razorpay webhook payload must be a JSON object.");
  }

  return value as Record<string, unknown>;
}
