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
  logContext: Record<string, unknown>;
  template: CoachFortEmailTemplate;
};

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
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
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
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(input.failureMessage ?? "Unable to send email.");
  }

  return {
    delivered: true,
    provider: "resend",
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
