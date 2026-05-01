type MessageVariables = Record<string, string | number | null | undefined>;

type PaymentLinkMessageData = {
  amount: string;
  courseName?: string | null;
  paymentUrl?: string | null;
  studentName?: string | null;
  workspaceName: string;
};

type ReminderMessageData = {
  description?: string | null;
  dueDate: string;
  reminderTitle: string;
  studentName?: string | null;
  workspaceName: string;
};

type CertificateMessageData = {
  certificateLink: string;
  courseName: string;
  studentName: string;
  workspaceName: string;
};

type ReceiptMessageData = {
  amount: string;
  receiptLink: string;
  studentName?: string | null;
  workspaceName: string;
};

type CourseEnrollmentMessageData = {
  courseName: string;
  studentName?: string | null;
  workspaceName: string;
};

type GeneralFollowUpMessageData = {
  message: string;
  studentName?: string | null;
  workspaceName: string;
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

function withRupeePrefix(amount: string) {
  const trimmedAmount = amount.trim();

  if (
    trimmedAmount.startsWith("₹") ||
    trimmedAmount.startsWith("INR") ||
    trimmedAmount.startsWith("Rs") ||
    trimmedAmount.startsWith("$")
  ) {
    return trimmedAmount;
  }

  return `₹${trimmedAmount}`;
}

export function buildPaymentReminderMessage(data: PaymentLinkMessageData) {
  return buildWhatsAppMessage(
    "Hi {{studentName}},\n\nThis is a reminder for your payment of {{amount}} for {{courseName}}.\n\nPlease complete using this link:\n{{paymentLink}}\n\n- {{workspaceName}}",
    {
      amount: withRupeePrefix(data.amount),
      courseName: data.courseName || "your course",
      paymentLink: data.paymentUrl || "Payment link unavailable",
      studentName: data.studentName || "there",
      workspaceName: data.workspaceName,
    },
  );
}

export function buildPaymentConfirmationMessage(data: ReceiptMessageData) {
  return buildWhatsAppMessage(
    "Hi {{studentName}},\n\nYour payment of {{amount}} has been received successfully.\n\nReceipt:\n{{receiptLink}}\n\nThank you.\n- {{workspaceName}}",
    {
      amount: withRupeePrefix(data.amount),
      receiptLink: data.receiptLink,
      studentName: data.studentName || "there",
      workspaceName: data.workspaceName,
    },
  );
}

export function buildCourseEnrollmentMessage(
  data: CourseEnrollmentMessageData,
) {
  return buildWhatsAppMessage(
    "Hi {{studentName}},\n\nYou are successfully enrolled in {{courseName}}.\n\nAccess details will be shared by {{workspaceName}}.\n\nThank you.",
    {
      courseName: data.courseName,
      studentName: data.studentName || "there",
      workspaceName: data.workspaceName,
    },
  );
}

export function buildCertificateShareMessage(data: CertificateMessageData) {
  return buildWhatsAppMessage(
    "Hi {{studentName}},\n\nCongratulations!\n\nYou have successfully completed {{courseName}}.\n\nYour certificate is ready:\n{{certificateLink}}\n\n- {{workspaceName}}",
    {
      certificateLink: data.certificateLink,
      courseName: data.courseName,
      studentName: data.studentName,
      workspaceName: data.workspaceName,
    },
  );
}

export function buildReceiptShareMessage(data: ReceiptMessageData) {
  return buildWhatsAppMessage(
    "Hi {{studentName}},\n\nYour payment receipt for {{amount}} is ready.\n\nView receipt:\n{{receiptLink}}\n\n- {{workspaceName}}",
    {
      amount: withRupeePrefix(data.amount),
      receiptLink: data.receiptLink,
      studentName: data.studentName || "there",
      workspaceName: data.workspaceName,
    },
  );
}

export function buildGeneralFollowUpMessage(data: GeneralFollowUpMessageData) {
  return buildWhatsAppMessage(
    "Hi {{studentName}},\n\nThis is a quick follow-up from {{workspaceName}}.\n\n{{message}}",
    {
      message: data.message,
      studentName: data.studentName || "there",
      workspaceName: data.workspaceName,
    },
  );
}

export function buildReminderWhatsAppMessage(data: ReminderMessageData) {
  return buildWhatsAppMessage(
    "Hi {{studentName}},\n\nReminder from {{workspaceName}}:\n{{reminderTitle}}\n\nDue: {{dueDate}}\n\n{{description}}",
    {
      description: data.description || "",
      dueDate: data.dueDate,
      reminderTitle: data.reminderTitle,
      studentName: data.studentName || "there",
      workspaceName: data.workspaceName,
    },
  );
}

export function buildPaymentLinkWhatsAppMessage(data: PaymentLinkMessageData) {
  return buildPaymentReminderMessage(data);
}

export function buildCertificateWhatsAppMessage(data: CertificateMessageData) {
  return buildCertificateShareMessage(data);
}
