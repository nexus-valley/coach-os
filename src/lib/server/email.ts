type SendOtpEmailInput = {
  email: string;
  expiresInMinutes: number;
  otp: string;
  purpose: "password_reset" | "signup_email_verification";
};

function getSubject(purpose: SendOtpEmailInput["purpose"]) {
  if (purpose === "password_reset") {
    return "Your CoachFort password reset code";
  }

  return "Your CoachFort verification code";
}

function getBody(input: SendOtpEmailInput) {
  const action =
    input.purpose === "password_reset"
      ? "reset your CoachFort password"
      : "verify your CoachFort signup email";

  return [
    `Use this code to ${action}: ${input.otp}`,
    "",
    `This code expires in ${input.expiresInMinutes} minutes.`,
    "If you did not request this, you can ignore this email.",
  ].join("\n");
}

export async function sendOtpEmail(input: SendOtpEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.COACHFORT_EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[CoachFort auth] OTP email provider is not configured.", {
        emailDomain: input.email.split("@")[1]?.toLowerCase() ?? null,
        purpose: input.purpose,
      });
    }

    return {
      delivered: false,
      provider: "none",
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from,
      subject: getSubject(input.purpose),
      text: getBody(input),
      to: input.email,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to send verification email.");
  }

  return {
    delivered: true,
    provider: "resend",
  };
}
