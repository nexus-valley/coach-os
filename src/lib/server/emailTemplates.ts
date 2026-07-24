export type CoachFortEmailTemplate = {
  html: string;
  key?: CoachFortEmailTemplateKey;
  lifecycle?: CoachFortEmailLifecycle;
  subject: string;
  text: string;
};

export type CoachFortEmailLifecycle =
  | "auth"
  | "billing"
  | "coach_onboarding"
  | "student_access"
  | "support"
  | "team_invite";

export type CoachFortEmailTemplateKey =
  | "auth.password_reset_otp"
  | "auth.signup_otp"
  | "billing.cancellation_or_expiry"
  | "billing.manual_activation_receipt"
  | "billing.payment_failed"
  | "billing.plan_activated"
  | "billing.renewal_reminder"
  | "coach.welcome"
  | "coach.workspace_ready"
  | "student.enrollment_approved"
  | "student.manual_payment_instruction"
  | "student.message_notification"
  | "student.portal_invite"
  | "student.request_received"
  | "student.session_reminder"
  | "team.invite";

export type CoachFortEmailWiringStatus =
  | "missing"
  | "template_only"
  | "wired";

export type CoachFortEmailTemplateInventoryItem = {
  builderName: string | null;
  firstPaidCustomerRequired: boolean;
  key: CoachFortEmailTemplateKey;
  lifecycle: CoachFortEmailLifecycle;
  manualFallback: string;
  notes: string;
  wiringStatus: CoachFortEmailWiringStatus;
};

type EmailAction = {
  label: string;
  url: string;
};

type EmailLayoutInput = {
  action?: EmailAction;
  body: string[];
  footerNote?: string;
  key?: CoachFortEmailTemplateKey;
  lifecycle?: CoachFortEmailLifecycle;
  preheader?: string;
  securityNote?: string;
  subject: string;
  title: string;
};

type InviteRole = "admin" | "staff" | "trainer";

const brandName = "CoachFort";
export const coachFortSupportEmail = "support@coachfort.com";
const defaultSecurityNote =
  "If you did not request this email, you can ignore it. Never share passwords, OTPs, or account access links with anyone.";

export const coachFortEmailTemplateInventory = [
  {
    builderName: "buildOtpEmail",
    firstPaidCustomerRequired: true,
    key: "auth.signup_otp",
    lifecycle: "auth",
    manualFallback: "Founder can pause signup and assist through support.",
    notes: "Wired through sendOtpEmail for signup email verification.",
    wiringStatus: "wired",
  },
  {
    builderName: "buildOtpEmail",
    firstPaidCustomerRequired: true,
    key: "auth.password_reset_otp",
    lifecycle: "auth",
    manualFallback: "Founder can verify account ownership and guide reset support.",
    notes: "Wired through sendOtpEmail for password reset OTP.",
    wiringStatus: "wired",
  },
  {
    builderName: "buildTeamInviteEmail",
    firstPaidCustomerRequired: false,
    key: "team.invite",
    lifecycle: "team_invite",
    manualFallback: "Workspace owner/admin can copy the secure invite link.",
    notes: "Wired through POST /api/team-invitations/send-email; production delivery smoke is still pending.",
    wiringStatus: "wired",
  },
  {
    builderName: "buildCoachWelcomeEmail",
    firstPaidCustomerRequired: false,
    key: "coach.welcome",
    lifecycle: "coach_onboarding",
    manualFallback: "Founder sends welcome/setup guidance manually.",
    notes: "Template exists, but no automatic send path is wired.",
    wiringStatus: "template_only",
  },
  {
    builderName: "buildWorkspaceReadyEmail",
    firstPaidCustomerRequired: false,
    key: "coach.workspace_ready",
    lifecycle: "coach_onboarding",
    manualFallback: "Founder sends workspace-ready message manually.",
    notes: "Template exists, but no automatic send path is wired.",
    wiringStatus: "template_only",
  },
  {
    builderName: "buildStudentPortalInviteEmail",
    firstPaidCustomerRequired: false,
    key: "student.portal_invite",
    lifecycle: "student_access",
    manualFallback: "Coach or founder shares student access instructions manually.",
    notes: "Template exists, but no sender route is wired.",
    wiringStatus: "template_only",
  },
  {
    builderName: null,
    firstPaidCustomerRequired: false,
    key: "billing.plan_activated",
    lifecycle: "billing",
    manualFallback: "Founder confirms activation manually after Manual Activation.",
    notes: "Missing until billing lifecycle email work is approved.",
    wiringStatus: "missing",
  },
  {
    builderName: null,
    firstPaidCustomerRequired: false,
    key: "billing.manual_activation_receipt",
    lifecycle: "billing",
    manualFallback: "Founder records and sends payment/reference details manually.",
    notes: "Missing until manual billing communication is wired.",
    wiringStatus: "missing",
  },
  {
    builderName: null,
    firstPaidCustomerRequired: false,
    key: "billing.renewal_reminder",
    lifecycle: "billing",
    manualFallback: "Founder tracks renewals externally during soft launch.",
    notes: "Missing until billing lifecycle automation is ready.",
    wiringStatus: "missing",
  },
  {
    builderName: null,
    firstPaidCustomerRequired: false,
    key: "billing.payment_failed",
    lifecycle: "billing",
    manualFallback: "Founder handles failed payments manually.",
    notes: "Missing until provider billing lifecycle is implemented.",
    wiringStatus: "missing",
  },
  {
    builderName: null,
    firstPaidCustomerRequired: false,
    key: "billing.cancellation_or_expiry",
    lifecycle: "billing",
    manualFallback: "Founder handles cancellation and expiry support manually.",
    notes: "Missing until cancellation/expiry lifecycle is implemented.",
    wiringStatus: "missing",
  },
  {
    builderName: null,
    firstPaidCustomerRequired: false,
    key: "student.request_received",
    lifecycle: "student_access",
    manualFallback: "Coach follows up from public request/inquiry UI.",
    notes: "Missing; public request records are visible in app but no email is wired.",
    wiringStatus: "missing",
  },
  {
    builderName: null,
    firstPaidCustomerRequired: false,
    key: "student.enrollment_approved",
    lifecycle: "student_access",
    manualFallback: "Coach/founder notifies student manually after approval.",
    notes: "Missing until student access lifecycle is implemented.",
    wiringStatus: "missing",
  },
  {
    builderName: null,
    firstPaidCustomerRequired: false,
    key: "student.manual_payment_instruction",
    lifecycle: "student_access",
    manualFallback: "Coach sends their own payment instructions.",
    notes: "Missing by design; CoachFort does not collect student payments during soft launch.",
    wiringStatus: "missing",
  },
  {
    builderName: null,
    firstPaidCustomerRequired: false,
    key: "student.session_reminder",
    lifecycle: "student_access",
    manualFallback: "Coach shares session reminders manually.",
    notes: "Missing/parked until notification lifecycle is approved.",
    wiringStatus: "missing",
  },
  {
    builderName: null,
    firstPaidCustomerRequired: false,
    key: "student.message_notification",
    lifecycle: "student_access",
    manualFallback: "Student checks in-app portal messages.",
    notes: "Missing/parked until notification lifecycle is approved.",
    wiringStatus: "missing",
  },
] as const satisfies readonly CoachFortEmailTemplateInventoryItem[];

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
    key: input.key,
    lifecycle: input.lifecycle,
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
    key: isPasswordReset ? "auth.password_reset_otp" : "auth.signup_otp",
    lifecycle: "auth",
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
    key: "team.invite",
    lifecycle: "team_invite",
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
    key: "student.portal_invite",
    lifecycle: "student_access",
    preheader: `${coachBrandName} invited you to the CoachFort student portal.`,
    subject: `Your ${coachBrandName} student portal`,
    title: "Open your CoachFort student portal",
  });
}

export function buildCoachWelcomeEmail(input: {
  coachName?: string | null;
  tenantName?: string | null;
}) {
  const greetingName = input.coachName?.trim() || "there";
  const workspaceName = input.tenantName?.trim() || "your coaching workspace";

  return buildCoachFortEmailLayout({
    body: [
      `Hi ${greetingName}, welcome to CoachFort.`,
      `${workspaceName} is set up for email and password access. Google login is not part of the soft-launch sign-in path.`,
      "Start by reviewing your dashboard, setting up your CoachFort-hosted branded page, and creating your first program.",
      "Student payments remain coach-managed through manual, offline, or external methods until payment gateway workflows are intentionally enabled.",
      "Please keep local copies of important uploaded documents while storage backup automation is being planned.",
    ],
    footerNote: `For onboarding help, contact ${coachFortSupportEmail}.`,
    key: "coach.welcome",
    lifecycle: "coach_onboarding",
    preheader: `Welcome to CoachFort. ${workspaceName} is ready for setup.`,
    securityNote:
      "CoachFort will never ask you to share passwords, OTPs, API keys, or private access links.",
    subject: "Welcome to CoachFort",
    title: "Welcome to CoachFort",
  });
}

export function buildWorkspaceReadyEmail(input: {
  appUrl: string;
  publicPageUrl?: string | null;
  tenantName?: string | null;
}) {
  const workspaceName = input.tenantName?.trim() || "your CoachFort workspace";
  const publicPageLine = input.publicPageUrl?.trim()
    ? `Your CoachFort-hosted public page starts here: ${input.publicPageUrl.trim()}`
    : "You can set up your CoachFort-hosted public page from workspace settings.";

  return buildCoachFortEmailLayout({
    action: {
      label: "Open CoachFort dashboard",
      url: input.appUrl,
    },
    body: [
      `${workspaceName} is ready to review.`,
      "Use your email and password to sign in, then review branding, public page settings, and your first program setup.",
      publicPageLine,
      "Starter and Growth activation is completed separately after founder-verified payment. Premium remains contact-sales and is not self-serve during soft launch.",
      "CoachFort does not collect or refund student program payments during this phase; the coach manages student payments directly.",
    ],
    footerNote: `For setup support, contact ${coachFortSupportEmail}.`,
    key: "coach.workspace_ready",
    lifecycle: "coach_onboarding",
    preheader: `${workspaceName} is ready on CoachFort.`,
    securityNote:
      "Do not share passwords, OTPs, API keys, or private access links with anyone.",
    subject: `${workspaceName} is ready on CoachFort`,
    title: "Your workspace is ready",
  });
}
