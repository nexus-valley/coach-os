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
  ["crm_lead_created", "CRM Lead Created"],
  ["crm_lead_imported_from_public_site", "CRM Lead Imported"],
  ["crm_lead_updated", "CRM Lead Updated"],
  ["crm_lead_status_changed", "CRM Lead Status Changed"],
  ["crm_lead_assigned", "CRM Lead Assigned"],
  ["crm_lead_note_added", "CRM Lead Note Added"],
  ["crm_follow_up_created", "CRM Follow-up Created"],
  ["crm_follow_up_updated", "CRM Follow-up Updated"],
  ["crm_lead_marked_converted", "CRM Lead Marked Converted"],
  ["crm_lead_marked_lost", "CRM Lead Marked Lost"],
  ["marketing_campaign_created", "Marketing Campaign Created"],
  ["marketing_campaign_updated", "Marketing Campaign Updated"],
  ["marketing_campaign_status_changed", "Marketing Campaign Status Changed"],
  ["marketing_campaign_archived", "Marketing Campaign Archived"],
  ["marketing_template_created", "Marketing Template Created"],
  ["marketing_template_updated", "Marketing Template Updated"],
  ["marketing_template_archived", "Marketing Template Archived"],
  ["marketing_campaign_leads_added", "Marketing Campaign Leads Added"],
  ["marketing_campaign_lead_updated", "Marketing Campaign Lead Updated"],
  ["marketing_touch_logged", "Marketing Touch Logged"],
  ["finance_settings_updated", "Finance Settings Updated"],
  ["finance_fee_plan_created", "Finance Fee Plan Created"],
  ["finance_fee_plan_updated", "Finance Fee Plan Updated"],
  ["finance_fee_plan_archived", "Finance Fee Plan Archived"],
  ["finance_invoice_created", "Finance Invoice Created"],
  ["finance_invoice_updated", "Finance Invoice Updated"],
  ["finance_invoice_voided", "Finance Invoice Voided"],
  ["finance_payment_recorded", "Finance Payment Recorded"],
  ["finance_payment_cancelled", "Finance Payment Cancelled"],
  ["finance_receipt_issued", "Finance Receipt Issued"],
  ["finance_receipt_cancelled", "Finance Receipt Cancelled"],
  ["finance_adjustment_applied", "Finance Adjustment Applied"],
  ["finance_adjustment_reversed", "Finance Adjustment Reversed"],
  ["platform_plan_created", "Platform Plan Created"],
  ["platform_plan_updated", "Platform Plan Updated"],
  ["platform_plan_archived", "Platform Plan Archived"],
  ["tenant_subscription_created", "Tenant Subscription Created"],
  ["tenant_subscription_updated", "Tenant Subscription Updated"],
  ["tenant_subscription_status_changed", "Tenant Subscription Status Changed"],
  [
    "tenant_subscription_payment_status_changed",
    "Tenant Subscription Payment Status Changed",
  ],
  ["platform_support_note_created", "Platform Support Note Created"],
  ["platform_support_note_updated", "Platform Support Note Updated"],
  ["platform_usage_snapshot_captured", "Platform Usage Snapshot Captured"],
  ["platform_admin_added", "Platform Admin Added"],
  ["platform_admin_suspended", "Platform Admin Suspended"],
  ["delegated_permission_created", "Delegated Permission Created"],
  ["delegated_permission_activated", "Delegated Permission Activated"],
  ["delegated_permission_revoked", "Delegated Permission Revoked"],
  ["delegated_permission_expired", "Delegated Permission Expired"],
  ["delegated_permission_used", "Delegated Permission Used"],
  ["team_member_removed", "Team Member Removed"],
  ["document_created", "Document Created"],
  ["document_updated", "Document Updated"],
  ["document_archived", "Document Archived"],
  ["document_viewed", "Document Viewed"],
  ["document_reference_opened", "Document Reference Opened"],
  ["document_visibility_changed", "Document Visibility Changed"],
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
  ["crm_lead", "CRM leads"],
  ["crm_lead_note", "CRM lead notes"],
  ["crm_follow_up_task", "CRM follow-up tasks"],
  ["crm_activity_log", "CRM activity"],
  ["public_site_lead", "Public site leads"],
  ["marketing_campaign", "Marketing campaigns"],
  ["marketing_template", "Marketing templates"],
  ["marketing_campaign_lead", "Marketing campaign leads"],
  ["marketing_campaign_activity", "Marketing activity"],
  ["finance_settings", "Finance settings"],
  ["finance_fee_plan", "Finance fee plans"],
  ["finance_invoice", "Finance invoices"],
  ["finance_payment", "Finance payments"],
  ["finance_receipt", "Finance receipts"],
  ["finance_adjustment", "Finance adjustments"],
  ["finance_activity_log", "Finance activity"],
  ["document_record", "Documents"],
  ["document_activity_log", "Document activity"],
  ["platform_subscription_plan", "Platform subscription plans"],
  ["platform_tenant_subscription", "Platform tenant subscriptions"],
  ["platform_support_note", "Platform support notes"],
  ["platform_tenant_usage_snapshot", "Platform usage snapshots"],
  ["platform_admin_user", "Platform admins"],
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
  document_activity_log: "DA",
  document_record: "DO",
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
  crm_activity_log: "CA",
  crm_follow_up_task: "CF",
  crm_lead: "CL",
  crm_lead_note: "CN",
  marketing_campaign: "MC",
  marketing_campaign_activity: "MA",
  marketing_campaign_lead: "ML",
  marketing_template: "MT",
  finance_activity_log: "FL",
  finance_adjustment: "FA",
  finance_fee_plan: "FF",
  finance_invoice: "FI",
  finance_payment: "FP",
  finance_receipt: "FR",
  finance_settings: "FS",
  public_site_lead: "PS",
};

const entityIconClasses: Record<string, string> = {
  assistant: "border-sky-200 bg-sky-50 text-sky-700",
  certificate: "border-amber-200 bg-amber-50 text-amber-700",
  cohort: "border-cyan-200 bg-cyan-50 text-cyan-700",
  course: "border-blue-200 bg-blue-50 text-blue-700",
  course_section: "border-blue-200 bg-blue-50 text-blue-700",
  demo_data: "border-cyan-200 bg-cyan-50 text-cyan-700",
  document_activity_log: "border-slate-300 bg-slate-50 text-slate-700",
  document_record: "border-blue-200 bg-blue-50 text-blue-700",
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
  crm_activity_log: "border-slate-300 bg-slate-50 text-slate-700",
  crm_follow_up_task: "border-orange-200 bg-orange-50 text-orange-700",
  crm_lead: "border-emerald-200 bg-emerald-50 text-emerald-700",
  crm_lead_note: "border-cyan-200 bg-cyan-50 text-cyan-700",
  marketing_campaign: "border-purple-200 bg-purple-50 text-purple-700",
  marketing_campaign_activity: "border-slate-300 bg-slate-50 text-slate-700",
  marketing_campaign_lead: "border-pink-200 bg-pink-50 text-pink-700",
  marketing_template: "border-indigo-200 bg-indigo-50 text-indigo-700",
  finance_activity_log: "border-slate-300 bg-slate-50 text-slate-700",
  finance_adjustment: "border-amber-200 bg-amber-50 text-amber-700",
  finance_fee_plan: "border-cyan-200 bg-cyan-50 text-cyan-700",
  finance_invoice: "border-sky-200 bg-sky-50 text-sky-700",
  finance_payment: "border-emerald-200 bg-emerald-50 text-emerald-700",
  finance_receipt: "border-teal-200 bg-teal-50 text-teal-700",
  finance_settings: "border-slate-300 bg-slate-50 text-slate-700",
  public_site_lead: "border-blue-200 bg-blue-50 text-blue-700",
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
