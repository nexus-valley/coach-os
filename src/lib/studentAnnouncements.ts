import type {
  StudentAnnouncementSummary,
} from "@/src/lib/announcements";

const announcementIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidAnnouncementDeepLink(value: string | null) {
  return Boolean(value && announcementIdPattern.test(value));
}

export function getStudentAnnouncementAudienceLabel(
  announcement: Pick<
    StudentAnnouncementSummary,
    "audience_type" | "cohort_name" | "course_title"
  >,
) {
  if (announcement.audience_type === "program") {
    return announcement.course_title
      ? `Program: ${announcement.course_title}`
      : "Program announcement";
  }

  if (announcement.audience_type === "cohort") {
    return announcement.cohort_name
      ? `Cohort: ${announcement.cohort_name}`
      : "Cohort announcement";
  }

  return "All students";
}

export function mergeStudentAnnouncementPage(
  current: StudentAnnouncementSummary[],
  incoming: StudentAnnouncementSummary[],
) {
  const seen = new Set(current.map((announcement) => announcement.id));
  return [
    ...current,
    ...incoming.filter((announcement) => !seen.has(announcement.id)),
  ];
}

export function markStudentAnnouncementReadLocally(
  announcement: StudentAnnouncementSummary,
  notificationId: string,
) {
  if (announcement.notification_id !== notificationId) {
    return announcement;
  }

  return {
    ...announcement,
    attention_state: "read" as const,
  };
}
