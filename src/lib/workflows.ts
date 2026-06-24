import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type WorkflowTemplateStatus = "draft" | "active" | "archived";
export type WorkflowRunStatus =
  | "cancelled"
  | "completed"
  | "in_progress"
  | "not_started";
export type WorkflowStepStatus =
  | "blocked"
  | "completed"
  | "in_progress"
  | "pending"
  | "skipped";
export type WorkflowStepType =
  | "approval_gate"
  | "checklist"
  | "manual_task"
  | "reference";
export type WorkflowAssigneeRole = "admin" | "owner" | "staff" | "trainer";

export type WorkflowTemplate = {
  category: string | null;
  created_at: string;
  created_by: string | null;
  description: string | null;
  id: string;
  name: string;
  status: WorkflowTemplateStatus;
  steps: WorkflowTemplateStep[];
  tenant_id: string;
  updated_at: string;
  updated_by: string | null;
};

export type WorkflowTemplateStep = {
  created_at: string;
  default_assignee_role: WorkflowAssigneeRole | null;
  description: string | null;
  id: string;
  is_required: boolean;
  metadata_json: Record<string, unknown>;
  step_order: number;
  step_type: WorkflowStepType;
  template_id: string;
  tenant_id: string;
  title: string;
  updated_at: string;
};

export type WorkflowRun = {
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  entity_id: string | null;
  entity_type: string | null;
  id: string;
  name: string;
  started_at: string | null;
  started_by: string | null;
  status: WorkflowRunStatus;
  steps: WorkflowRunStep[];
  template_id: string | null;
  tenant_id: string;
  updated_at: string;
};

export type WorkflowRunStep = {
  assigned_role: WorkflowAssigneeRole | null;
  assigned_to: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  description: string | null;
  id: string;
  metadata_json: Record<string, unknown>;
  notes: string | null;
  run_id: string;
  status: WorkflowStepStatus;
  step_order: number;
  step_type: WorkflowStepType;
  template_step_id: string | null;
  tenant_id: string;
  title: string;
  updated_at: string;
};

export type WorkflowActivityLog = {
  action: string;
  actor_id: string | null;
  created_at: string;
  id: string;
  metadata_json: Record<string, unknown>;
  run_id: string | null;
  step_id: string | null;
  tenant_id: string;
};

export type WorkflowStepPayload = {
  default_assignee_role?: WorkflowAssigneeRole | null;
  description?: string | null;
  is_required?: boolean;
  metadata_json?: Record<string, unknown>;
  step_order: number;
  step_type: WorkflowStepType;
  title: string;
};

export type WorkflowTemplatePayload = {
  category?: string | null;
  description?: string | null;
  name: string;
  status: Exclude<WorkflowTemplateStatus, "archived">;
  steps: WorkflowStepPayload[];
  tenantId: string;
};

export type WorkflowTemplateUpdatePayload = Omit<
  WorkflowTemplatePayload,
  "tenantId"
> & {
  status: WorkflowTemplateStatus;
  templateId: string;
};

export type WorkflowDashboardData = {
  activityLogs: WorkflowActivityLog[];
  runSteps: WorkflowRunStep[];
  runs: WorkflowRun[];
  templates: WorkflowTemplate[];
};

const templateSelect =
  "id,tenant_id,name,description,category,status,created_by,updated_by,created_at,updated_at";
const templateStepSelect =
  "id,tenant_id,template_id,step_order,title,description,step_type,default_assignee_role,is_required,metadata_json,created_at,updated_at";
const runSelect =
  "id,tenant_id,template_id,name,status,entity_type,entity_id,started_by,completed_by,started_at,completed_at,created_at,updated_at";
const runStepSelect =
  "id,tenant_id,run_id,template_step_id,step_order,title,description,step_type,assigned_to,assigned_role,status,completed_by,completed_at,notes,metadata_json,created_at,updated_at";
const activitySelect =
  "id,tenant_id,run_id,step_id,actor_id,action,metadata_json,created_at";

function byOrder(a: { step_order: number }, b: { step_order: number }) {
  return a.step_order - b.step_order;
}

function normalizeSteps(steps: WorkflowStepPayload[]) {
  return steps.map((step, index) => ({
    default_assignee_role: step.default_assignee_role ?? null,
    description: step.description ?? null,
    is_required: step.is_required ?? true,
    metadata_json: step.metadata_json ?? {},
    step_order: step.step_order || index + 1,
    step_type: step.step_type,
    title: step.title,
  }));
}

export async function getWorkflowDashboardData(
  tenantId: string,
): Promise<WorkflowDashboardData> {
  const supabase = getSupabaseClient();

  const [templatesResult, templateStepsResult, runsResult, runStepsResult, activityResult] =
    await Promise.all([
      supabase
        .from("workflow_templates")
        .select(templateSelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
      supabase
        .from("workflow_template_steps")
        .select(templateStepSelect)
        .eq("tenant_id", tenantId)
        .order("step_order", { ascending: true }),
      supabase
        .from("workflow_runs")
        .select(runSelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("workflow_run_steps")
        .select(runStepSelect)
        .eq("tenant_id", tenantId)
        .order("step_order", { ascending: true }),
      supabase
        .from("workflow_activity_logs")
        .select(activitySelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

  for (const result of [
    templatesResult,
    templateStepsResult,
    runsResult,
    runStepsResult,
    activityResult,
  ]) {
    if (result.error) {
      throw result.error;
    }
  }

  const templateSteps = (templateStepsResult.data ?? []) as WorkflowTemplateStep[];
  const templateStepsByTemplate = new Map<string, WorkflowTemplateStep[]>();

  for (const step of templateSteps) {
    const existing = templateStepsByTemplate.get(step.template_id) ?? [];
    existing.push(step);
    templateStepsByTemplate.set(step.template_id, existing);
  }

  const runSteps = (runStepsResult.data ?? []) as WorkflowRunStep[];
  const runStepsByRun = new Map<string, WorkflowRunStep[]>();

  for (const step of runSteps) {
    const existing = runStepsByRun.get(step.run_id) ?? [];
    existing.push(step);
    runStepsByRun.set(step.run_id, existing);
  }

  const templates = ((templatesResult.data ?? []) as Omit<
    WorkflowTemplate,
    "steps"
  >[]).map((template) => ({
    ...template,
    steps: (templateStepsByTemplate.get(template.id) ?? []).sort(byOrder),
  }));

  const runs = ((runsResult.data ?? []) as Omit<WorkflowRun, "steps">[]).map(
    (run) => ({
      ...run,
      steps: (runStepsByRun.get(run.id) ?? []).sort(byOrder),
    }),
  );

  return {
    activityLogs: (activityResult.data ?? []) as WorkflowActivityLog[],
    runSteps,
    runs,
    templates,
  };
}

export async function createWorkflowTemplate(
  payload: WorkflowTemplatePayload,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_workflow_template", {
    p_category: payload.category ?? null,
    p_description: payload.description ?? null,
    p_name: payload.name,
    p_status: payload.status,
    p_steps: normalizeSteps(payload.steps),
    p_tenant_id: payload.tenantId,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function updateWorkflowTemplate(
  payload: WorkflowTemplateUpdatePayload,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_workflow_template", {
    p_category: payload.category ?? null,
    p_description: payload.description ?? null,
    p_name: payload.name,
    p_status: payload.status,
    p_steps: normalizeSteps(payload.steps),
    p_template_id: payload.templateId,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function archiveWorkflowTemplate(templateId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("archive_workflow_template", {
    p_template_id: templateId,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function startWorkflowRun(params: {
  entityId?: string | null;
  entityType?: string | null;
  name?: string | null;
  templateId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("start_workflow_run", {
    p_entity_id: params.entityId ?? null,
    p_entity_type: params.entityType ?? null,
    p_name: params.name ?? null,
    p_template_id: params.templateId,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function updateWorkflowRunStep(params: {
  notes?: string | null;
  status: WorkflowStepStatus;
  stepId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_workflow_run_step", {
    p_notes: params.notes ?? null,
    p_status: params.status,
    p_step_id: params.stepId,
  });

  if (error) {
    throw error;
  }

  return data as string;
}
