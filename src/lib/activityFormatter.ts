import type { AuditLog, AuditLogSeverity } from "@/src/lib/auditLogger";

export const activityActionOptions = [
  ["all", "All actions"],
  ["student_created", "Student Created"],
  ["student_updated", "Student Updated"],
  ["student_deleted", "Student Deleted"],
  ["course_created", "Course Created"],
  ["cohort_created", "Cohort Created"],
  ["cohort_updated", "Cohort Updated"],
  ["cohort_deleted", "Cohort Deleted"],
  ["course_section_created", "Course Section Created"],
  ["course_section_updated", "Course Section Updated"],
  ["course_section_deleted", "Course Section Deleted"],
  ["lesson_created", "Lesson Created"],
  ["lesson_updated", "Lesson Updated"],
  ["lesson_deleted", "Lesson Deleted"],
  ["enrollment_created", "Enrollment Added"],
  ["enrollment_deleted", "Enrollment Removed"],
  ["payment_created", "Payment Recorded"],
  ["payment_deleted", "Payment Deleted"],
  ["payment_link_created", "Payment Link Created"],
  ["payment_link_sent", "Payment Link Sent"],
  ["payment_link_updated", "Payment Link Updated"],
  ["payment_link_deleted", "Payment Link Deleted"],
  ["payment_link_converted", "Payment Link Converted"],
  ["receipt_generated", "Receipt Generated"],
  ["certificate_generated", "Certificate Generated"],
  ["reminder_created", "Reminder Created"],
  ["reminder_completed", "Reminder Completed"],
  ["reminder_status_updated", "Reminder Updated"],
  ["reminder_deleted", "Reminder Deleted"],
  ["invitation_created", "Invitation Created"],
  ["invitation_resent", "Invitation Resent"],
  ["invitation_revoked", "Invitation Revoked"],
  ["invitation_accepted", "Invitation Accepted"],
  ["role_changed", "Role Changed"],
  ["access_denied", "Access Denied"],
  ["team_member_removed", "Team Member Removed"],
  ["settings_updated", "Settings Updated"],
  ["workspace_branding_updated", "Workspace Branding Updated"],
  ["session_created", "Session Created"],
  ["session_updated", "Session Updated"],
  ["session_completed", "Session Completed"],
  ["session_canceled", "Session Canceled"],
  ["attendance_marked", "Attendance Marked"],
  ["attendance_bulk_marked", "Attendance Bulk Marked"],
  ["assignment_created", "Assignment Created"],
  ["assignment_updated", "Assignment Updated"],
  ["assignment_published", "Assignment Published"],
  ["assignment_closed", "Assignment Closed"],
  ["assignment_submitted", "Assignment Submitted"],
  ["assignment_reviewed", "Assignment Reviewed"],
  ["notification_created", "Notification Created"],
  ["notification_read", "Notification Read"],
  ["notification_archived", "Notification Archived"],
  ["communication_logged", "Communication Logged"],
  ["subscription_plan_changed", "Subscription Plan Changed"],
  ["subscription_created", "Subscription Created"],
  ["subscription_canceled", "Subscription Canceled"],
  ["invoice_created", "Invoice Created"],
  ["invoice_paid", "Invoice Paid"],
  ["payment_recorded", "Payment Recorded"],
  ["plan_updated", "Plan Updated"],
  ["trial_started", "Trial Started"],
  ["trial_expired", "Trial Expired"],
  ["workspace_limit_reached", "Workspace Limit Reached"],
  ["trainer_assigned_course", "Trainer Assigned Course"],
  ["trainer_removed_course", "Trainer Removed Course"],
  ["trainer_assigned_cohort", "Trainer Assigned Cohort"],
  ["trainer_removed_cohort", "Trainer Removed Cohort"],
  ["demo_data_loaded", "Demo Data Loaded"],
] as const;

export const activityEntityOptions = [
  ["all", "All entities"],
  ["student", "Students"],
  ["course", "Courses"],
  ["cohort", "Cohorts"],
  ["course_section", "Course sections"],
  ["lesson", "Lessons"],
  ["enrollment", "Enrollments"],
  ["payment", "Payments"],
  ["payment_link", "Payment links"],
  ["receipt", "Receipts"],
  ["certificate", "Certificates"],
  ["reminder", "Reminders"],
  ["team_invitation", "Invitations"],
  ["security", "Security"],
  ["subscription", "Subscription"],
  ["invoice", "Invoices"],
  ["payment_transaction", "Billing payments"],
  ["usage", "Usage"],
  ["trainer_assignment", "Trainer assignment"],
  ["team_member", "Team"],
  ["workspace_settings", "Settings"],
  ["session", "Sessions"],
  ["attendance_record", "Attendance"],
  ["assignment", "Assignments"],
  ["assignment_submission", "Assignment submissions"],
  ["notification", "Notifications"],
  ["communication_log", "Communication logs"],
  ["demo_data", "Demo data"],
] as const;

export const activitySeverityOptions = [
  ["all", "All severity"],
  ["info", "Info"],
  ["warning", "Warning"],
  ["critical", "Critical"],
] as const;

const actionLabels = Object.fromEntries(activityActionOptions);
const entityLabels = Object.fromEntries(activityEntityOptions);

const entityIconLabels: Record<string, string> = {
  certificate: "CE",
  cohort: "CH",
  course: "CO",
  course_section: "CS",
  demo_data: "DM",
  enrollment: "EN",
  lesson: "LS",
  payment: "PY",
  payment_link: "PL",
  receipt: "RC",
  reminder: "RM",
  session: "SE",
  security: "SC",
  subscription: "SB",
  invoice: "IN",
  payment_transaction: "PT",
  usage: "US",
  team_invitation: "IN",
  trainer_assignment: "TR",
  student: "ST",
  team_member: "TM",
  workspace_settings: "WS",
  attendance_record: "AT",
  assignment: "AS",
  assignment_submission: "HW",
  communication_log: "CL",
  notification: "NT",
};

const entityIconClasses: Record<string, string> = {
  certificate: "border-amber-200 bg-amber-50 text-amber-700",
  cohort: "border-cyan-200 bg-cyan-50 text-cyan-700",
  course: "border-blue-200 bg-blue-50 text-blue-700",
  course_section: "border-blue-200 bg-blue-50 text-blue-700",
  demo_data: "border-cyan-200 bg-cyan-50 text-cyan-700",
  enrollment: "border-violet-200 bg-violet-50 text-violet-700",
  lesson: "border-indigo-200 bg-indigo-50 text-indigo-700",
  payment: "border-emerald-200 bg-emerald-50 text-emerald-700",
  payment_link: "border-teal-200 bg-teal-50 text-teal-700",
  receipt: "border-emerald-200 bg-emerald-50 text-emerald-700",
  reminder: "border-orange-200 bg-orange-50 text-orange-700",
  session: "border-cyan-200 bg-cyan-50 text-cyan-700",
  security: "border-red-200 bg-red-50 text-red-700",
  subscription: "border-amber-200 bg-amber-50 text-amber-700",
  invoice: "border-sky-200 bg-sky-50 text-sky-700",
  payment_transaction: "border-emerald-200 bg-emerald-50 text-emerald-700",
  usage: "border-amber-200 bg-amber-50 text-amber-700",
  team_invitation: "border-cyan-200 bg-cyan-50 text-cyan-700",
  trainer_assignment: "border-purple-200 bg-purple-50 text-purple-700",
  student: "border-sky-200 bg-sky-50 text-sky-700",
  team_member: "border-purple-200 bg-purple-50 text-purple-700",
  workspace_settings: "border-slate-300 bg-slate-50 text-slate-700",
  attendance_record: "border-emerald-200 bg-emerald-50 text-emerald-700",
  assignment: "border-indigo-200 bg-indigo-50 text-indigo-700",
  assignment_submission: "border-violet-200 bg-violet-50 text-violet-700",
  communication_log: "border-slate-300 bg-slate-50 text-slate-700",
  notification: "border-cyan-200 bg-cyan-50 text-cyan-700",
};

export function formatActivityAction(action: string) {
  return (
    actionLabels[action] ??
    action
      .split("_")
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ")
  );
}

export function formatActivityEntity(entityType: string) {
  return entityLabels[entityType] ?? formatActivityAction(entityType);
}

export function getActivityActor(log: AuditLog) {
  return log.user_name || log.user_email || "Workspace user";
}

export function getActivityInitial(log: AuditLog) {
  return getActivityActor(log).trim().charAt(0).toUpperCase() || "U";
}

export function getActivitySentence(log: AuditLog) {
  const entity = log.entity_name ? ` "${log.entity_name}"` : "";
  return `${getActivityActor(log)} ${formatActivityAction(
    log.action,
  ).toLowerCase()}${entity}`;
}

export function getEntityIconLabel(entityType: string) {
  return entityIconLabels[entityType] ?? "AC";
}

export function getEntityIconClass(entityType: string) {
  return (
    entityIconClasses[entityType] ??
    "border-[#D8E8F0] bg-white text-[#145DA0]"
  );
}

export function normalizeSeverity(
  severity: string | null | undefined,
): AuditLogSeverity {
  if (severity === "warning" || severity === "critical") {
    return severity;
  }

  return "info";
}

export function getSeverityBadgeClass(severity: string | null | undefined) {
  const normalized = normalizeSeverity(severity);

  if (normalized === "critical") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (normalized === "warning") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }

  return "border-cyan-200 bg-cyan-50 text-cyan-700";
}

export function formatRelativeActivityTime(value: string) {
  const timestamp = new Date(value).getTime();
  const seconds = Math.max(Math.floor((Date.now() - timestamp) / 1000), 0);

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(hours / 24);

  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function formatActivityTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function getActivityDateGroup(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return "Today";
  }

  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  return "Earlier";
}

function csvValue(value: unknown) {
  const stringValue =
    value === null || typeof value === "undefined" ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

export function exportActivityLogsCsv(logs: AuditLog[]) {
  const header = [
    "timestamp",
    "user",
    "email",
    "action",
    "entity_type",
    "entity_name",
    "description",
    "severity",
  ];
  const rows = logs.map((log) => [
    log.created_at,
    getActivityActor(log),
    log.user_email ?? "",
    formatActivityAction(log.action),
    formatActivityEntity(log.entity_type),
    log.entity_name ?? "",
    log.description ?? "",
    normalizeSeverity(log.severity),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(csvValue).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "activity-logs.csv";
  link.click();
  URL.revokeObjectURL(url);
}
