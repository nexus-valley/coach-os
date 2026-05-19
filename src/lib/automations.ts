import { createReminder, type ReminderType } from "@/src/lib/reminders";
import { requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  enforceWorkspaceLimit,
  refreshWorkspaceUsageSnapshot,
} from "@/src/lib/usage";

export type AutomationTriggerType =
  | "payment_created"
  | "enrollment_created"
  | "student_created"
  | "course_completed";

export type AutomationActionType = "create_reminder";

export type AutomationRuleConfig = {
  due_offset_days: number;
  reminder_description: string;
  reminder_title: string;
  reminder_type: ReminderType;
};

export type AutomationRule = {
  id: string;
  tenant_id: string;
  name: string;
  trigger_type: AutomationTriggerType;
  action_type: AutomationActionType;
  is_active: boolean;
  config: AutomationRuleConfig;
  created_at: string;
  updated_at: string;
};

export type AutomationRulePayload = {
  action_type: AutomationActionType;
  config: AutomationRuleConfig;
  is_active: boolean;
  name: string;
  tenant_id: string;
  trigger_type: AutomationTriggerType;
};

export type UpdateAutomationRulePayload = Omit<
  AutomationRulePayload,
  "tenant_id"
>;

const automationRuleSelect =
  "id,tenant_id,name,trigger_type,action_type,is_active,config,created_at,updated_at";

function normalizeConfig(config: unknown): AutomationRuleConfig {
  const value =
    typeof config === "object" && config !== null
      ? (config as Partial<AutomationRuleConfig>)
      : {};

  return {
    due_offset_days:
      typeof value.due_offset_days === "number" ? value.due_offset_days : 1,
    reminder_description:
      typeof value.reminder_description === "string"
        ? value.reminder_description
        : "",
    reminder_title:
      typeof value.reminder_title === "string" ? value.reminder_title : "",
    reminder_type:
      value.reminder_type === "payment" ||
      value.reminder_type === "course_followup" ||
      value.reminder_type === "student_followup"
        ? value.reminder_type
        : "general",
  };
}

function normalizeRule(rule: AutomationRule) {
  return {
    ...rule,
    config: normalizeConfig(rule.config),
  } satisfies AutomationRule;
}

function buildPayload(payload: AutomationRulePayload | UpdateAutomationRulePayload) {
  const name = payload.name.trim();

  if (!name) {
    throw new Error("Automation name is required.");
  }

  return {
    action_type: payload.action_type,
    config: {
      due_offset_days: Math.max(
        0,
        Math.trunc(Number(payload.config.due_offset_days) || 0),
      ),
      reminder_description: payload.config.reminder_description.trim(),
      reminder_title: payload.config.reminder_title.trim(),
      reminder_type: payload.config.reminder_type,
    },
    is_active: payload.is_active,
    name,
    trigger_type: payload.trigger_type,
  };
}

export async function getAutomationRulesForTenant(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("automation_rules")
    .select(automationRuleSelect)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as AutomationRule[]).map(normalizeRule);
}

export async function createAutomationRule(payload: AutomationRulePayload) {
  await requireTenantPermission({
    description: "Blocked automation creation without automation management permission.",
    permission: "manage_automations",
    tenantId: payload.tenant_id,
  });
  await enforceWorkspaceLimit(payload.tenant_id, "automations");

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("automation_rules")
    .insert({
      ...buildPayload(payload),
      tenant_id: payload.tenant_id,
    })
    .select(automationRuleSelect)
    .single();

  if (error) {
    throw error;
  }

  const rule = normalizeRule(data as AutomationRule);
  await refreshWorkspaceUsageSnapshot(rule.tenant_id);

  return rule;
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
    .from("automation_rules")
    .update(buildPayload(payload))
    .eq("tenant_id", tenantId)
    .eq("id", ruleId)
    .select(automationRuleSelect)
    .single();

  if (error) {
    throw error;
  }

  return normalizeRule(data as AutomationRule);
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
  const { data, error } = await supabase
    .from("automation_rules")
    .update({ is_active: isActive })
    .eq("tenant_id", tenantId)
    .eq("id", ruleId)
    .select(automationRuleSelect)
    .single();

  if (error) {
    throw error;
  }

  return normalizeRule(data as AutomationRule);
}

export async function deleteAutomationRule(ruleId: string, tenantId: string) {
  await requireTenantPermission({
    description: "Blocked automation deletion without delete permission.",
    permission: "delete_records",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("automation_rules")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", ruleId);

  if (error) {
    throw error;
  }

  await refreshWorkspaceUsageSnapshot(tenantId);
}

export async function testAutomationRule(rule: AutomationRule, tenantId: string) {
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + rule.config.due_offset_days);

  return createReminder({
    description: `This was generated from automation test: ${rule.name}.\n\n${
      rule.config.reminder_description || "No reminder description template."
    }`,
    due_at: dueAt.toISOString(),
    reminder_type: rule.config.reminder_type,
    tenant_id: tenantId,
    title: `[Test] ${
      rule.config.reminder_title || rule.name || "Automation reminder"
    }`,
  });
}

export async function getAutomationRuleCounts(tenantId: string) {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from("automation_rules")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  if (error) {
    throw error;
  }

  return {
    activeAutomations: count ?? 0,
  };
}
