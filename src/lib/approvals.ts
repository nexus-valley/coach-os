import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type ApprovalType =
  | "automation_action"
  | "certificate_issue"
  | "course_publish"
  | "general"
  | "payment_adjustment"
  | "settings_change"
  | "student_change"
  | "workflow_gate";

export type ApprovalPriority = "high" | "low" | "normal" | "urgent";
export type ApprovalStatus = "approved" | "cancelled" | "pending" | "rejected";
export type ApprovalAssignedRole = "admin" | "owner" | "staff" | "trainer";
export type ApprovalDecision = "approved" | "rejected";

export type ApprovalRequest = {
  approval_type: ApprovalType;
  assigned_role: ApprovalAssignedRole | null;
  assigned_to: string | null;
  created_at: string;
  decision_at: string | null;
  decision_by: string | null;
  decision_note: string | null;
  description: string | null;
  due_at: string | null;
  entity_id: string | null;
  entity_type: string | null;
  id: string;
  metadata_json: Record<string, unknown>;
  priority: ApprovalPriority;
  requested_by: string | null;
  status: ApprovalStatus;
  tenant_id: string;
  title: string;
  updated_at: string;
  workflow_run_id: string | null;
  workflow_step_id: string | null;
};

export type ApprovalActivityLog = {
  action: string;
  actor_id: string | null;
  approval_id: string | null;
  created_at: string;
  id: string;
  metadata_json: Record<string, unknown>;
  tenant_id: string;
};

export type ApprovalDashboardData = {
  activityLogs: ApprovalActivityLog[];
  approvals: ApprovalRequest[];
};

export type ApprovalCreatePayload = {
  approvalType: ApprovalType;
  assignedRole?: ApprovalAssignedRole | null;
  assignedTo?: string | null;
  description?: string | null;
  dueAt?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  metadataJson?: Record<string, unknown>;
  priority: ApprovalPriority;
  tenantId: string;
  title: string;
  workflowRunId?: string | null;
  workflowStepId?: string | null;
};

const approvalSelect =
  "id,tenant_id,requested_by,assigned_to,assigned_role,approval_type,title,description,status,priority,entity_type,entity_id,workflow_run_id,workflow_step_id,decision_by,decision_at,decision_note,due_at,metadata_json,created_at,updated_at";
const activitySelect =
  "id,tenant_id,approval_id,actor_id,action,metadata_json,created_at";

export const approvalTypes: ApprovalType[] = [
  "general",
  "workflow_gate",
  "course_publish",
  "certificate_issue",
  "payment_adjustment",
  "student_change",
  "settings_change",
  "automation_action",
];

export const approvalPriorities: ApprovalPriority[] = [
  "low",
  "normal",
  "high",
  "urgent",
];

export const approvalAssignedRoles: ApprovalAssignedRole[] = [
  "owner",
  "admin",
  "staff",
  "trainer",
];

export async function getApprovalDashboardData(
  tenantId: string,
): Promise<ApprovalDashboardData> {
  const supabase = getSupabaseClient();
  const [approvalsResult, activityResult] = await Promise.all([
    supabase
      .from("approval_requests")
      .select(approvalSelect)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("approval_activity_logs")
      .select(activitySelect)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (approvalsResult.error) {
    throw approvalsResult.error;
  }

  if (activityResult.error) {
    throw activityResult.error;
  }

  return {
    activityLogs: (activityResult.data ?? []) as ApprovalActivityLog[],
    approvals: (approvalsResult.data ?? []) as ApprovalRequest[],
  };
}

export async function createApprovalRequest(payload: ApprovalCreatePayload) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_approval_request", {
    p_approval_type: payload.approvalType,
    p_assigned_role: payload.assignedRole ?? null,
    p_assigned_to: payload.assignedTo ?? null,
    p_description: payload.description ?? null,
    p_due_at: payload.dueAt || null,
    p_entity_id: payload.entityId ?? null,
    p_entity_type: payload.entityType ?? null,
    p_metadata_json: payload.metadataJson ?? {},
    p_priority: payload.priority,
    p_tenant_id: payload.tenantId,
    p_title: payload.title,
    p_workflow_run_id: payload.workflowRunId ?? null,
    p_workflow_step_id: payload.workflowStepId ?? null,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function decideApprovalRequest(params: {
  approvalId: string;
  decision: ApprovalDecision;
  decisionNote?: string | null;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("decide_approval_request", {
    p_approval_id: params.approvalId,
    p_decision: params.decision,
    p_decision_note: params.decisionNote ?? null,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function cancelApprovalRequest(approvalId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("cancel_approval_request", {
    p_approval_id: approvalId,
  });

  if (error) {
    throw error;
  }

  return data as string;
}
