import type { AuditLog, AuditLogSeverity } from "@/src/lib/auditLogger";

export const activityActionOptions = [
  ["all", "All actions"],
  ["student_created", "Student Created"],
  ["student_updated", "Student Updated"],
  ["student_deleted", "Student Deleted"],
  ["student_portal_previewed", "Student Portal Previewed"],
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
  ["automation_created", "Automation Created"],
  ["automation_updated", "Automation Updated"],
  ["automation_enabled", "Automation Enabled"],
  ["automation_disabled", "Automation Disabled"],
  ["automation_executed", "Automation Executed"],
  ["automation_failed", "Automation Failed"],
  ["automation_trigger_received", "Automation Trigger Received"],
  ["automation_action_executed", "Automation Action Executed"],
  ["automation_action_skipped", "Automation Action Skipped"],
  ["automation_duplicate_skipped", "Automation Duplicate Skipped"],
  ["automation_notification_created", "Automation Notification Created"],
  ["automation_placeholder_queued", "Automation Placeholder Queued"],
  ["invitation_created", "Invitation Created"],
  ["invitation_resent", "Invitation Resent"],
  ["invitation_revoked", "Invitation Revoked"],
  ["invitation_accepted", "Invitation Accepted"],
  ["role_changed", "Role Changed"],
  ["access_denied", "Access Denied"],
  ["ai_assistant_used", "AI Assistant Used"],
  ["workflow_template_created", "Workflow Template Created"],
  ["workflow_template_updated", "Workflow Template Updated"],
  ["workflow_template_archived", "Workflow Template Archived"],
  ["workflow_run_started", "Workflow Run Started"],
  ["workflow_run_completed", "Workflow Run Completed"],
  ["workflow_step_updated", "Workflow Step Updated"],
  ["approval_request_created", "Approval Request Created"],
  ["approval_request_approved", "Approval Request Approved"],
  ["approval_request_rejected", "Approval Request Rejected"],
  ["approval_request_cancelled", "Approval Request Cancelled"],
  ["workflow_gate_approved", "Workflow Gate Approved"],
  ["workflow_gate_rejected", "Workflow Gate Rejected"],
  ["delegated_permission_created", "Delegated Permission Created"],
  ["delegated_permission_activated", "Delegated Permission Activated"],
  ["delegated_permission_revoked", "Delegated Permission Revoked"],
  ["delegated_permission_expired", "Delegated Permission Expired"],
  ["delegated_permission_used", "Delegated Permission Used"],
  ["team_member_removed", "Team Member Removed"],
  ["settings_updated", "Settings Updated"],
  ["branding_updated", "Branding Updated"],
  ["public_site_updated", "Public Site Updated"],
  ["workspace_branding_updated", "Workspace Branding Updated"],
  ["session_created", "Session Created"],
  ["session_updated", "Session Updated"],
  ["session_completed", "Session Completed"],
  ["session_canceled", "Session Canceled"],
  ["live_session_scheduled", "Live Session Scheduled"],
  ["live_session_updated", "Live Session Updated"],
  ["meeting_details_updated", "Meeting Details Updated"],
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
  ["conversation_created", "Conversation Created"],
  ["message_sent", "Message Sent"],
  ["message_edited", "Message Edited"],
  ["message_deleted", "Message Deleted"],
  ["conversation_archived", "Conversation Archived"],
  ["conversation_locked", "Conversation Locked"],
  ["report_viewed", "Report Viewed"],
  ["report_exported", "Report Exported"],
  ["backup_center_viewed", "Backup Center Viewed"],
  ["export_started", "Export Started"],
  ["export_completed", "Export Completed"],
  ["export_failed", "Export Failed"],
  ["operations_console_viewed", "Operations Console Viewed"],
  ["workspace_health_checked", "Workspace Health Checked"],
  ["subscription_plan_changed", "Subscription Plan Changed"],
  ["subscription_created", "Subscription Created"],
  ["subscription_canceled", "Subscription Canceled"],
  ["subscription_status_changed", "Subscription Status Changed"],
  ["workspace_plan_changed", "Workspace Plan Changed"],
  ["billing_profile_updated", "Billing Profile Updated"],
  ["invoice_created", "Invoice Created"],
  ["invoice_paid", "Invoice Paid"],
  ["payment_recorded", "Payment Recorded"],
  ["plan_updated", "Plan Updated"],
  ["trial_started", "Trial Started"],
  ["trial_expired", "Trial Expired"],
  ["trial_state_checked", "Trial State Checked"],
  ["feature_limit_warning", "Feature Limit Warning"],
  ["workspace_limit_reached", "Workspace Limit Reached"],
  ["trainer_assigned_course", "Trainer Assigned Course"],
  ["trainer_removed_course", "Trainer Removed Course"],
  ["trainer_assigned_cohort", "Trainer Assigned Cohort"],
  ["trainer_removed_cohort", "Trainer Removed Cohort"],
  ["demo_data_loaded", "Demo Data Loaded"],
  ["demo_workspace_seeded", "Demo Workspace Seeded"],
  ["demo_workspace_reset", "Demo Workspace Reset"],
] as const;

export const activityEntityOptions = [
  ["all", "All entities"],
  ["assistant", "Assistant"],
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
  ["automation", "Automations"],
  ["automation_run", "Automation runs"],
  ["automation_run_log", "Automation run logs"],
  ["team_invitation", "Invitations"],
  ["security", "Security"],
  ["delegated_permission", "Delegated permissions"],
  ["subscription", "Subscription"],
  ["invoice", "Invoices"],
  ["payment_transaction", "Billing payments"],
  ["usage", "Usage"],
  ["trainer_assignment", "Trainer assignment"],
  ["team_member", "Team"],
  ["tenant", "Tenant"],
  ["workspace_settings", "Settings"],
  ["session", "Sessions"],
  ["attendance_record", "Attendance"],
  ["assignment", "Assignments"],
  ["assignment_submission", "Assignment submissions"],
  ["notification", "Notifications"],
  ["communication_log", "Communication logs"],
  ["conversation", "Conversations"],
  ["conversation_message", "Conversation messages"],
  ["operations", "Operations"],
  ["report", "Reports"],
  ["backup_export", "Backup exports"],
  ["workflow_template", "Workflow templates"],
  ["workflow_run", "Workflow runs"],
  ["workflow_run_step", "Workflow run steps"],
  ["workflow", "Workflows"],
  ["approval_request", "Approval requests"],
  ["approval_activity_log", "Approval activity"],
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
  assistant: "AI",
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
  automation: "AU",
  automation_run: "AR",
  automation_run_log: "AL",
  session: "SE",
  security: "SC",
  delegated_permission: "DP",
  subscription: "SB",
  invoice: "IN",
  payment_transaction: "PT",
  usage: "US",
  team_invitation: "IN",
  trainer_assignment: "TR",
  student: "ST",
  team_member: "TM",
  tenant: "TN",
  workspace_settings: "WS",
  attendance_record: "AT",
  assignment: "AS",
  assignment_submission: "HW",
  communication_log: "CL",
  conversation: "CV",
  conversation_message: "MS",
  notification: "NT",
  operations: "OP",
  report: "RP",
  backup_export: "BK",
  workflow: "WF",
  workflow_run: "WR",
  workflow_run_step: "WS",
  workflow_template: "WT",
  approval_activity_log: "AA",
  approval_request: "AP",
};

const entityIconClasses: Record<string, string> = {
  assistant: "border-sky-200 bg-sky-50 text-sky-700",
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
  automation: "border-teal-200 bg-teal-50 text-teal-700",
  automation_run: "border-cyan-200 bg-cyan-50 text-cyan-700",
  automation_run_log: "border-slate-300 bg-slate-50 text-slate-700",
  session: "border-cyan-200 bg-cyan-50 text-cyan-700",
  security: "border-red-200 bg-red-50 text-red-700",
  delegated_permission: "border-orange-200 bg-orange-50 text-orange-700",
  subscription: "border-amber-200 bg-amber-50 text-amber-700",
  invoice: "border-sky-200 bg-sky-50 text-sky-700",
  payment_transaction: "border-emerald-200 bg-emerald-50 text-emerald-700",
  usage: "border-amber-200 bg-amber-50 text-amber-700",
  team_invitation: "border-cyan-200 bg-cyan-50 text-cyan-700",
  trainer_assignment: "border-purple-200 bg-purple-50 text-purple-700",
  student: "border-sky-200 bg-sky-50 text-sky-700",
  team_member: "border-purple-200 bg-purple-50 text-purple-700",
  tenant: "border-cyan-200 bg-cyan-50 text-cyan-700",
  workspace_settings: "border-slate-300 bg-slate-50 text-slate-700",
  attendance_record: "border-emerald-200 bg-emerald-50 text-emerald-700",
  assignment: "border-indigo-200 bg-indigo-50 text-indigo-700",
  assignment_submission: "border-violet-200 bg-violet-50 text-violet-700",
  communication_log: "border-slate-300 bg-slate-50 text-slate-700",
  conversation: "border-cyan-200 bg-cyan-50 text-cyan-700",
  conversation_message: "border-blue-200 bg-blue-50 text-blue-700",
  notification: "border-cyan-200 bg-cyan-50 text-cyan-700",
  operations: "border-cyan-200 bg-cyan-50 text-cyan-700",
  report: "border-indigo-200 bg-indigo-50 text-indigo-700",
  backup_export: "border-cyan-200 bg-cyan-50 text-cyan-700",
  workflow: "border-cyan-200 bg-cyan-50 text-cyan-700",
  workflow_run: "border-blue-200 bg-blue-50 text-blue-700",
  workflow_run_step: "border-indigo-200 bg-indigo-50 text-indigo-700",
  workflow_template: "border-teal-200 bg-teal-50 text-teal-700",
  approval_activity_log: "border-slate-300 bg-slate-50 text-slate-700",
  approval_request: "border-emerald-200 bg-emerald-50 text-emerald-700",
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
