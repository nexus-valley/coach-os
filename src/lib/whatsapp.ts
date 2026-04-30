type MessageVariables = Record<string, string | number | null | undefined>;

type PaymentLinkMessageData = {
  amount: string;
  courseName?: string | null;
  paymentUrl?: string | null;
  studentName?: string | null;
  workspaceName: string;
};

type ReminderMessageData = {
  dueDate: string;
  reminderTitle: string;
  studentName?: string | null;
  workspaceName: string;
};

type CertificateMessageData = {
  certificateUrl: string;
  courseName: string;
  studentName: string;
};

export function formatIndianPhoneNumber(phone?: string | null) {
  if (!phone) {
    return "";
  }

  const digits = phone.replace(/\D/g, "");

  if (digits.length === 10) {
    return `91${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    return digits;
  }

  if (digits.length > 10) {
    return `91${digits.slice(-10)}`;
  }

  return "";
}

export function buildWhatsAppMessage(
  template: string,
  variables: MessageVariables,
) {
  return Object.entries(variables).reduce((message, [key, value]) => {
    const replacement = value === null || value === undefined ? "" : String(value);

    return message.replaceAll(`{{${key}}}`, replacement);
  }, template);
}

export function buildWhatsAppShareUrl(
  phone: string | null | undefined,
  message: string,
) {
  const normalizedPhone = formatIndianPhoneNumber(phone);
  const encodedMessage = encodeURIComponent(message);

  if (!normalizedPhone) {
    return `https://wa.me/?text=${encodedMessage}`;
  }

  return `https://wa.me/${normalizedPhone}?text=${encodedMessage}`;
}

export function buildPaymentLinkWhatsAppMessage(
  data: PaymentLinkMessageData,
) {
  const courseText = data.courseName ? ` for ${data.courseName}` : "";

  return buildWhatsAppMessage(
    "Hi {{studentName}}, please complete your payment of {{amount}}{{courseText}} using this link:\n{{paymentUrl}}\n- {{workspaceName}}",
    {
      amount: data.amount,
      courseText,
      paymentUrl: data.paymentUrl || "Payment link unavailable",
      studentName: data.studentName || "there",
      workspaceName: data.workspaceName,
    },
  );
}

export function buildReminderWhatsAppMessage(data: ReminderMessageData) {
  return buildWhatsAppMessage(
    "Hi {{studentName}}, reminder from {{workspaceName}}: {{reminderTitle}}. Due: {{dueDate}}.",
    {
      dueDate: data.dueDate,
      reminderTitle: data.reminderTitle,
      studentName: data.studentName || "there",
      workspaceName: data.workspaceName,
    },
  );
}

export function buildCertificateWhatsAppMessage(data: CertificateMessageData) {
  return buildWhatsAppMessage(
    "Hi {{studentName}}, congratulations on completing {{courseName}}. Your certificate is ready.\n{{certificateUrl}}",
    {
      certificateUrl: data.certificateUrl,
      courseName: data.courseName,
      studentName: data.studentName,
    },
  );
}
