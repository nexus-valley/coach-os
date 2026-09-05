import { logActivity } from "@/src/lib/auditLogger";
import { requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type AutomationTriggerType =
  | "assignment_overdue"
  | "attendance_low"
  | "certificate_issued"
  | "course_completed"
  | "enrollment_created"
  | "payment_created"
  | "payment_received"
  | "session_scheduled"
  | "student_created"
  | "trial_expiring";

export type AutomationConditionType =
  | "contains"
  | "date_after"
  | "date_before"
  | "equals"
  | "greater_than"
  | "less_than"
  | "not_equals";

export type AutomationActionType =
  | "add_internal_note"
  | "create_notification"
  | "create_reminder"
  | "generate_task_placeholder"
  | "send_email_placeholder"
  | "send_whatsapp_placeholder";

export type AutomationRuleStatus = "active" | "draft" | "inactive";
export type AutomationExecutionMode = "instant" | "scheduled";
export type AutomationRunStatus = "failed" | "queued" | "skipped" | "success";

export type AutomationRuleCondition = {
  condition_type: AutomationConditionType;
  id: string;
  operator: string;
  rule_id: string;
  sort_order: number;
  tenant_id: string;
  value_json: Record<string, unknown>;
};

export type AutomationRuleAction = {
  action_type: AutomationActionType;
  config_json: Record<string, unknown>;
  id: string;
  rule_id: string;
  sort_order: number;
  tenant_id: string;
};

export type AutomationRule = {
  action_type: AutomationActionType;
  actions: AutomationRuleAction[];
  conditions: AutomationRuleCondition[];
  config: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
  description: string | null;
  execution_mode: AutomationExecutionMode;
  id: string;
  is_active: boolean;
  metadata_json: Record<string, unknown>;
  name: string;
  status: AutomationRuleStatus;
  tenant_id: string;
  trigger_type: AutomationTriggerType;
  updated_at: string;
};

export type AutomationRun = {
  completed_at: string | null;
  entity_id: string | null;
  entity_type: string | null;
  error_message: string | null;
  id: string;
  metadata_json: Record<string, unknown>;
  rule_id: string | null;
  started_at: string;
  status: AutomationRunStatus;
  tenant_id: string;
  trigger_source: string | null;
};

export type AutomationRulePayload = {
  actions: {
    action_type: AutomationActionType;
    config_json?: Record<string, unknown>;
  }[];
  conditions?: {
    condition_type: AutomationConditionType;
    operator?: string;
    value_json?: Record<string, unknown>;
  }[];
  description?: string;
  execution_mode: AutomationExecutionMode;
  name: string;
  status: AutomationRuleStatus;
  tenant_id: string;
  trigger_type: AutomationTriggerType;
};

export type UpdateAutomationRulePayload = Omit<
  AutomationRulePayload,
  "tenant_id"
>;

const automationRuleSelect =
  "id,tenant_id,name,description,trigger_type,action_type,is_active,status,execution_mode,config,created_by,metadata_json,created_at,updated_at";
const automationConditionSelect =
  "id,tenant_id,rule_id,condition_type,operator,value_json,sort_order";
const automationActionSelect =
  "id,tenant_id,rule_id,action_type,config_json,sort_order";
const automationRunSelect =
  "id,tenant_id,rule_id,trigger_source,entity_type,entity_id,status,started_at,completed_at,error_message,metadata_json";

function isOptionalAutomationSchemaError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST200" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("column")
  );
}

function normalizeJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeRule(row: Record<string, unknown>): AutomationRule {
  const status =
    row.status === "draft" || row.status === "inactive" || row.status === "active"
      ? row.status
      : row.is_active === false
        ? "inactive"
        : "active";
  const actionType =
    typeof row.action_type === "string"
      ? (row.action_type as AutomationActionType)
      : "create_reminder";

  return {
    action_type: actionType,
    actions: [],
    conditions: [],
    config: normalizeJson(row.config),
    created_at: String(row.created_at ?? new Date().toISOString()),
    created_by: typeof row.created_by === "string" ? row.created_by : null,
    description: typeof row.description === "string" ? row.description : null,
    execution_mode: row.execution_mode === "scheduled" ? "scheduled" : "instant",
    id: String(row.id),
    is_active: Boolean(row.is_active ?? status === "active"),
    metadata_json: normalizeJson(row.metadata_json),
    name: String(row.name ?? "Untitled automation"),
    status,
    tenant_id: String(row.tenant_id),
    trigger_type: String(row.trigger_type) as AutomationTriggerType,
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function normalizeCondition(row: Record<string, unknown>): AutomationRuleCondition {
  return {
    condition_type: String(row.condition_type ?? "equals") as AutomationConditionType,
    id: String(row.id),
    operator: String(row.operator ?? row.condition_type ?? "equals"),
    rule_id: String(row.rule_id),
    sort_order: Number(row.sort_order ?? 0),
    tenant_id: String(row.tenant_id),
    value_json: normalizeJson(row.value_json),
  };
}

function normalizeAction(row: Record<string, unknown>): AutomationRuleAction {
  return {
    action_type: String(row.action_type ?? "create_notification") as AutomationActionType,
    config_json: normalizeJson(row.config_json),
    id: String(row.id),
    rule_id: String(row.rule_id),
    sort_order: Number(row.sort_order ?? 0),
    tenant_id: String(row.tenant_id),
  };
}

function normalizeRun(row: Record<string, unknown>): AutomationRun {
  return {
    completed_at: typeof row.completed_at === "string" ? row.completed_at : null,
    entity_id: typeof row.entity_id === "string" ? row.entity_id : null,
    entity_type: typeof row.entity_type === "string" ? row.entity_type : null,
    error_message:
      typeof row.error_message === "string" ? row.error_message : null,
    id: String(row.id),
    metadata_json: normalizeJson(row.metadata_json),
    rule_id: typeof row.rule_id === "string" ? row.rule_id : null,
    started_at: String(row.started_at ?? new Date().toISOString()),
    status: String(row.status ?? "queued") as AutomationRunStatus,
    tenant_id: String(row.tenant_id),
    trigger_source:
      typeof row.trigger_source === "string" ? row.trigger_source : null,
  };
}

async function getRelatedRows(tenantId: string, ruleIds: string[]) {
  if (ruleIds.length === 0) {
    return { actions: [], conditions: [] };
  }

  const supabase = getSupabaseClient();
  const [conditionsResult, actionsResult] = await Promise.all([
    supabase
      .from("automation_rule_conditions")
      .select(automationConditionSelect)
      .eq("tenant_id", tenantId)
      .in("rule_id", ruleIds)
      .order("sort_order", { ascending: true }),
    supabase
      .from("automation_rule_actions")
      .select(automationActionSelect)
      .eq("tenant_id", tenantId)
      .in("rule_id", ruleIds)
      .order("sort_order", { ascending: true }),
  ]);

  if (conditionsResult.error) {
    if (!isOptionalAutomationSchemaError(conditionsResult.error)) {
      throw conditionsResult.error;
    }
  }

  if (actionsResult.error) {
    if (!isOptionalAutomationSchemaError(actionsResult.error)) {
      throw actionsResult.error;
    }
  }

  return {
    actions: ((actionsResult.data ?? []) as Record<string, unknown>[]).map(
      normalizeAction,
    ),
    conditions: ((conditionsResult.data ?? []) as Record<string, unknown>[]).map(
      normalizeCondition,
    ),
  };
}

function attachRelatedRows(
  rules: AutomationRule[],
  conditions: AutomationRuleCondition[],
  actions: AutomationRuleAction[],
) {
  const conditionsByRule = new Map<string, AutomationRuleCondition[]>();
  const actionsByRule = new Map<string, AutomationRuleAction[]>();

  for (const condition of conditions) {
    conditionsByRule.set(condition.rule_id, [
      ...(conditionsByRule.get(condition.rule_id) ?? []),
      condition,
    ]);
  }

  for (const action of actions) {
    actionsByRule.set(action.rule_id, [
      ...(actionsByRule.get(action.rule_id) ?? []),
      action,
    ]);
  }

  return rules.map((rule) => {
    const ruleActions = actionsByRule.get(rule.id);

    return {
      ...rule,
      actions:
        ruleActions && ruleActions.length > 0
          ? ruleActions
          : [
              {
                action_type: rule.action_type,
                config_json: rule.config,
                id: `${rule.id}-legacy-action`,
                rule_id: rule.id,
                sort_order: 0,
                tenant_id: rule.tenant_id,
              },
            ],
      conditions: conditionsByRule.get(rule.id) ?? [],
    };
  });
}

async function attachRelatedRowsForRule(rule: AutomationRule) {
  const related = await getRelatedRows(rule.tenant_id, [rule.id]);

  return attachRelatedRows(
    [rule],
    related.conditions,
    related.actions,
  )[0];
}

export async function getAutomationRules(tenantId: string) {
  return getAutomationRulesForTenant(tenantId);
}

export async function getAutomationRulesForTenant(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("automation_rules")
    .select(automationRuleSelect)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isOptionalAutomationSchemaError(error)) {
      return [];
    }

    throw error;
  }

  const rules = ((data ?? []) as Record<string, unknown>[]).map(normalizeRule);
  const related = await getRelatedRows(
    tenantId,
    rules.map((rule) => rule.id),
  );

  return attachRelatedRows(rules, related.conditions, related.actions);
}

export async function createAutomationRule(payload: AutomationRulePayload) {
  await requireTenantPermission({
    description: "Blocked automation creation without automation management permission.",
    permission: "manage_automations",
    tenantId: payload.tenant_id,
  });
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("create_automation_rule_secure", {
      p_actions: payload.actions,
      p_conditions: payload.conditions ?? [],
      p_description: payload.description?.trim() || null,
      p_execution_mode: payload.execution_mode,
      p_name: payload.name.trim(),
      p_status: payload.status,
      p_tenant_id: payload.tenant_id,
      p_trigger_type: payload.trigger_type,
    })
    .single();

  if (error) {
    throw error;
  }

  const rule = normalizeRule(data as Record<string, unknown>);
  const createdRule = await attachRelatedRowsForRule(rule);

  await logActivity({
    action: "automation_created",
    description: `Created automation ${rule.name}.`,
    entityId: rule.id,
    entityName: rule.name,
    entityType: "automation",
    metadata: {
      status: rule.status,
      triggerType: rule.trigger_type,
    },
    tenantId: rule.tenant_id,
  });

  return createdRule;
}

export async function updateAutomationRule(
  ruleId: string,
  tenantId: string,
  payload: UpdateAutomationRulePayload,
) {
  await requireTenantPermission({
    description: "Blocked automation update without automation management permission.",
    permission: "manage_automations",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_automation_rule_secure", {
      p_actions: payload.actions,
      p_conditions: payload.conditions ?? [],
      p_description: payload.description?.trim() || null,
      p_execution_mode: payload.execution_mode,
      p_name: payload.name.trim(),
      p_rule_id: ruleId,
      p_status: payload.status,
      p_tenant_id: tenantId,
      p_trigger_type: payload.trigger_type,
    })
    .single();

  if (error) {
    throw error;
  }

  const rule = normalizeRule(data as Record<string, unknown>);
  const updatedRule = await attachRelatedRowsForRule(rule);

  await logActivity({
    action: "automation_updated",
    description: `Updated automation ${rule.name}.`,
    entityId: rule.id,
    entityName: rule.name,
    entityType: "automation",
    metadata: {
      status: rule.status,
      triggerType: rule.trigger_type,
    },
    tenantId,
  });

  return updatedRule;
}

export async function toggleAutomationRule(
  ruleId: string,
  tenantId: string,
  isActive: boolean,
) {
  await requireTenantPermission({
    description: "Blocked automation toggle without automation management permission.",
    permission: "manage_automations",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const status: AutomationRuleStatus = isActive ? "active" : "inactive";
  const { data, error } = await supabase
    .rpc("set_automation_rule_enabled_secure", {
      p_enabled: isActive,
      p_rule_id: ruleId,
      p_tenant_id: tenantId,
    })
    .single();

  if (error) {
    throw error;
  }

  const rule = normalizeRule(data as Record<string, unknown>);

  await logActivity({
    action: isActive ? "automation_enabled" : "automation_disabled",
    description: `${isActive ? "Enabled" : "Disabled"} automation ${rule.name}.`,
    entityId: rule.id,
    entityName: rule.name,
    entityType: "automation",
    metadata: { status },
    severity: isActive ? "info" : "warning",
    tenantId,
  });

  return rule;
}

export async function deleteAutomationRule(ruleId: string, tenantId: string) {
  await requireTenantPermission({
    description: "Blocked automation deletion without delete permission.",
    permission: "delete_records",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("delete_automation_rule_secure", {
    p_rule_id: ruleId,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

}

export async function getAutomationRuns(tenantId: string, limit = 20) {
  await requireTenantPermission({
    description: "Blocked automation run access without automation management permission.",
    permission: "manage_automations",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("automation_runs")
    .select(automationRunSelect)
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isOptionalAutomationSchemaError(error)) {
      return [];
    }

    throw error;
  }

  return ((data ?? []) as Record<string, unknown>[]).map(normalizeRun);
}

export async function getAutomationRuleCounts(tenantId: string) {
  const supabase = getSupabaseClient();
  const [activeResult, failedRunsResult] = await Promise.all([
    supabase
      .from("automation_rules")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "active"),
    supabase
      .from("automation_runs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "failed"),
  ]);

  if (activeResult.error && !isOptionalAutomationSchemaError(activeResult.error)) {
    throw activeResult.error;
  }

  return {
    activeAutomations: activeResult.count ?? 0,
    failedRuns: failedRunsResult.error ? 0 : failedRunsResult.count ?? 0,
  };
}

export async function getAutomationHealthSummary(tenantId: string) {
  const supabase = getSupabaseClient();
  const [activeRules, draftRules, failedRuns, successfulRuns] =
    await Promise.all([
      supabase
        .from("automation_rules")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "active"),
      supabase
        .from("automation_rules")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "draft"),
      supabase
        .from("automation_runs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "failed"),
      supabase
        .from("automation_runs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "success"),
    ]);

  return {
    activeRules: activeRules.error ? 0 : activeRules.count ?? 0,
    draftRules: draftRules.error ? 0 : draftRules.count ?? 0,
    failedRuns: failedRuns.error ? 0 : failedRuns.count ?? 0,
    successfulRuns: successfulRuns.error ? 0 : successfulRuns.count ?? 0,
  };
}
