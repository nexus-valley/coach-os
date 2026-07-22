export type CoachFortEmailTemplate = {
  html: string;
  subject: string;
  text: string;
};

type EmailAction = {
  label: string;
  url: string;
};

type EmailLayoutInput = {
  action?: EmailAction;
  body: string[];
  footerNote?: string;
  preheader?: string;
  securityNote?: string;
  subject: string;
  title: string;
};

type InviteRole = "admin" | "staff" | "trainer";

const brandName = "CoachFort";
const defaultSecurityNote =
  "If you did not request this email, you can ignore it. Never share passwords, OTPs, or account access links with anyone.";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTextSection(lines: string[]) {
  return lines.filter(Boolean).join("\n\n");
}

function formatDate(value?: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function buildCoachFortEmailLayout(
  input: EmailLayoutInput,
): CoachFortEmailTemplate {
  const securityNote = input.securityNote ?? defaultSecurityNote;
  const text = formatTextSection([
    input.title,
    ...input.body,
    input.action ? `${input.action.label}: ${input.action.url}` : "",
    input.footerNote ?? "",
    securityNote,
    `${brandName} transactional email`,
  ]);
  const htmlBody = input.body
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;color:#425b76;font-size:15px;line-height:1.6;">${escapeHtml(
          paragraph,
        )}</p>`,
    )
    .join("");
  const actionHtml = input.action
    ? `<div style="margin:28px 0;"><a href="${escapeHtml(
        input.action.url,
      )}" style="display:inline-block;border-radius:10px;background:#145da0;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 18px;">${escapeHtml(
        input.action.label,
      )}</a></div><p style="margin:0 0 16px;color:#66788f;font-size:13px;line-height:1.6;">If the button does not work, paste this link into your browser:<br><span style="word-break:break-all;">${escapeHtml(
        input.action.url,
      )}</span></p>`
    : "";
  const footerNoteHtml = input.footerNote
    ? `<p style="margin:0 0 16px;color:#66788f;font-size:13px;line-height:1.6;">${escapeHtml(
        input.footerNote,
      )}</p>`
    : "";

  return {
    html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><title>${escapeHtml(
      input.subject,
    )}</title></head><body style="margin:0;background:#f4f8fb;font-family:Arial,Helvetica,sans-serif;color:#0b1f33;">${
      input.preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
            input.preheader,
          )}</div>`
        : ""
    }<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f8fb;padding:24px 0;"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d8e8f0;border-radius:16px;overflow:hidden;"><tr><td style="padding:24px 28px;border-bottom:1px solid #e5eef4;"><p style="margin:0;color:#145da0;font-size:14px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">${brandName}</p></td></tr><tr><td style="padding:30px 28px;"><h1 style="margin:0 0 18px;color:#0b1f33;font-size:26px;line-height:1.25;">${escapeHtml(
      input.title,
    )}</h1>${htmlBody}${actionHtml}${footerNoteHtml}<div style="margin-top:26px;border-top:1px solid #e5eef4;padding-top:18px;"><p style="margin:0;color:#66788f;font-size:12px;line-height:1.6;">${escapeHtml(
      securityNote,
    )}</p></div></td></tr></table><p style="margin:18px 0 0;color:#8aa0b4;font-size:12px;">${brandName} transactional email</p></td></tr></table></body></html>`,
    subject: input.subject,
    text,
  };
}

export function buildOtpEmail(input: {
  expiresInMinutes: number;
  otp: string;
  purpose: "password_reset" | "signup_email_verification";
}) {
  const isPasswordReset = input.purpose === "password_reset";
  const action = isPasswordReset
    ? "reset your CoachFort password"
    : "verify your CoachFort signup email";

  return buildCoachFortEmailLayout({
    body: [
      `Use this verification code to ${action}:`,
      input.otp,
      `This code expires in ${input.expiresInMinutes} minutes.`,
    ],
    preheader: `Your ${brandName} verification code expires in ${input.expiresInMinutes} minutes.`,
    subject: isPasswordReset
      ? "Your CoachFort password reset code"
      : "Your CoachFort verification code",
    title: isPasswordReset
      ? "Reset your CoachFort password"
      : "Verify your CoachFort email",
  });
}

export function buildTeamInviteEmail(input: {
  expiresAt?: string | null;
  inviteUrl: string;
  recipientEmail: string;
  role: InviteRole;
  tenantName?: string | null;
}) {
  const expiry = formatDate(input.expiresAt);
  const workspaceName = input.tenantName?.trim() || "a CoachFort workspace";

  return buildCoachFortEmailLayout({
    action: {
      label: "Accept invitation",
      url: input.inviteUrl,
    },
    body: [
      `You have been invited to join ${workspaceName} as ${input.role}.`,
      "Accept the invitation with the email address that received this message.",
      expiry ? `This invite expires on ${expiry}.` : "This invite may expire.",
    ],
    footerNote:
      "This invitation gives access only after sign-in and workspace permission checks are complete.",
    preheader: `You have been invited to join ${workspaceName} on ${brandName}.`,
    subject: `Invitation to join ${workspaceName} on ${brandName}`,
    title: "You have a CoachFort team invitation",
  });
}

export function buildStudentPortalInviteEmail(input: {
  expiresAt?: string | null;
  inviteUrl: string;
  studentName?: string | null;
  tenantName?: string | null;
}) {
  const expiry = formatDate(input.expiresAt);
  const coachBrandName = input.tenantName?.trim() || "your coaching business";
  const greeting = input.studentName?.trim()
    ? `${input.studentName.trim()}, your student portal is ready.`
    : "Your student portal is ready.";

  return buildCoachFortEmailLayout({
    action: {
      label: "Open student portal",
      url: input.inviteUrl,
    },
    body: [
      greeting,
      `${coachBrandName} has enabled your CoachFort student portal for courses, sessions, documents, messages, and coaching updates.`,
      expiry ? `This access link expires on ${expiry}.` : "Use the link to sign in with your student account.",
    ],
    footerNote:
      "This is not a payment link. Do not share your password or OTP with anyone.",
    preheader: `${coachBrandName} invited you to the CoachFort student portal.`,
    subject: `Your ${coachBrandName} student portal`,
    title: "Open your CoachFort student portal",
  });
}
