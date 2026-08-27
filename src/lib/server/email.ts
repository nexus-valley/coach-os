import {
  buildOtpEmail,
  type CoachFortEmailTemplate,
} from "@/src/lib/server/emailTemplates";

type SendOtpEmailInput = {
  email: string;
  expiresInMinutes: number;
  otp: string;
  purpose: "password_reset" | "signup_email_verification";
};

type SendTransactionalEmailInput = {
  email: string;
  failureMessage?: string;
  idempotencyKey?: string;
  logContext: Record<string, unknown>;
  template: CoachFortEmailTemplate;
};

export type CoachFortEmailErrorClass =
  | "configuration"
  | "permanent"
  | "timeout"
  | "transient";

export class CoachFortEmailDeliveryError extends Error {
  readonly code: string;
  readonly errorClass: CoachFortEmailErrorClass;
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(params: {
    code: string;
    errorClass: CoachFortEmailErrorClass;
    httpStatus?: number | null;
    message: string;
    retryable: boolean;
  }) {
    super(params.message);
    this.name = "CoachFortEmailDeliveryError";
    this.code = params.code;
    this.errorClass = params.errorClass;
    this.httpStatus = params.httpStatus ?? null;
    this.retryable = params.retryable;
  }
}

const resendTimeoutMs = 10_000;

function providerErrorCode(value: unknown) {
  if (!value || typeof value !== "object") {
    return "provider_rejected";
  }

  const candidate = (value as { name?: unknown }).name;
  return typeof candidate === "string" && /^[a-z0-9_]{1,80}$/i.test(candidate)
    ? candidate.toLowerCase()
    : "provider_rejected";
}

function classifyProviderStatus(status: number, code: string) {
  const retryable =
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    code === "concurrent_idempotent_requests";

  return {
    errorClass: retryable ? ("transient" as const) : ("permanent" as const),
    retryable,
  };
}

export async function sendCoachFortTransactionalEmail(
  input: SendTransactionalEmailInput,
) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.COACHFORT_EMAIL_FROM;
  const replyTo = process.env.COACHFORT_EMAIL_REPLY_TO;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.info(
        "[CoachFort email] Transactional email provider is not configured.",
        {
          emailDomain: input.email.split("@")[1]?.toLowerCase() ?? null,
          ...input.logContext,
        },
      );
    }

    return {
      delivered: false,
      provider: "none",
      providerMessageId: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resendTimeoutMs);
  let response: Response;

  try {
    response = await fetch("https://api.resend.com/emails", {
      body: JSON.stringify({
        from,
        html: input.template.html,
        reply_to: replyTo || undefined,
        subject: input.template.subject,
        text: input.template.text,
        to: input.email,
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Resend retains this key for 24 hours. The durable outbox remains an
        // at-least-once boundary after that provider window expires.
        ...(input.idempotencyKey
          ? { "Idempotency-Key": input.idempotencyKey }
          : {}),
      },
      method: "POST",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new CoachFortEmailDeliveryError({
        code: "provider_timeout",
        errorClass: "timeout",
        message: input.failureMessage ?? "Unable to send email.",
        retryable: true,
      });
    }

    throw new CoachFortEmailDeliveryError({
      code: "provider_network_error",
      errorClass: "transient",
      message: input.failureMessage ?? "Unable to send email.",
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let responseBody: unknown = null;
    try {
      responseBody = await response.json();
    } catch {
      // The public error boundary intentionally ignores provider response text.
    }

    const code = providerErrorCode(responseBody);
    const classification = classifyProviderStatus(response.status, code);
    throw new CoachFortEmailDeliveryError({
      code,
      errorClass: classification.errorClass,
      httpStatus: response.status,
      message: input.failureMessage ?? "Unable to send email.",
      retryable: classification.retryable,
    });
  }

  let responseBody: { id?: unknown };
  try {
    responseBody = (await response.json()) as { id?: unknown };
  } catch {
    throw new CoachFortEmailDeliveryError({
      code: "provider_response_invalid",
      errorClass: "transient",
      httpStatus: response.status,
      message: input.failureMessage ?? "Unable to send email.",
      retryable: true,
    });
  }
  const providerMessageId =
    typeof responseBody.id === "string" && responseBody.id.trim()
      ? responseBody.id.trim()
      : null;

  if (!providerMessageId) {
    throw new CoachFortEmailDeliveryError({
      code: "provider_response_invalid",
      errorClass: "transient",
      httpStatus: response.status,
      message: input.failureMessage ?? "Unable to send email.",
      retryable: true,
    });
  }

  return {
    delivered: true,
    provider: "resend",
    providerMessageId,
  };
}

export async function sendOtpEmail(input: SendOtpEmailInput) {
  return sendCoachFortTransactionalEmail({
    email: input.email,
    failureMessage: "Unable to send verification email.",
    logContext: {
      purpose: input.purpose,
      template: "otp",
    },
    template: buildOtpEmail(input),
  });
}
