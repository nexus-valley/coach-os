export function getSafeStudentNotificationActionUrl(
  actionUrl: string | null | undefined,
) {
  if (
    !actionUrl ||
    !actionUrl.startsWith("/") ||
    actionUrl.startsWith("//") ||
    actionUrl !== actionUrl.trim() ||
    actionUrl.includes("\\") ||
    /[\u0000-\u001f\u007f\s]/.test(actionUrl)
  ) {
    return null;
  }

  try {
    const decodedActionUrl = decodeURI(actionUrl);

    if (
      decodedActionUrl.includes("\\") ||
      /[\u0000-\u001f\u007f\s]/.test(decodedActionUrl)
    ) {
      return null;
    }

    const portalOrigin = "https://student-portal.invalid";
    const parsed = new URL(actionUrl, portalOrigin);
    const decodedParsed = new URL(decodedActionUrl, portalOrigin);
    const hasSafePortalBoundary = (candidate: URL) =>
      candidate.origin === portalOrigin &&
      (candidate.pathname === "/portal" ||
        candidate.pathname.startsWith("/portal/"));

    if (!hasSafePortalBoundary(parsed) || !hasSafePortalBoundary(decodedParsed)) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function getSafeStudentNotificationTimestamp(
  value: string | null | undefined,
) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : value;
}

export function getStudentNotificationActionLabel(input: {
  actionUrl: string;
  type: string;
}) {
  if (
    input.type === "assignment_notice" &&
    input.actionUrl.startsWith("/portal/assignments/")
  ) {
    return "View assignment";
  }

  return "Open notification";
}
