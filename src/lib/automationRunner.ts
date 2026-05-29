import { logActivity } from "@/src/lib/auditLogger";
import { queueCommunicationLog } from "@/src/lib/communication";
import {
  type AutomationActionType,
  type AutomationRule,
  type AutomationRuleAction,
  type AutomationRuleCondition,
  type AutomationRun,
} from "@/src/lib/automations";
import {
  createNotificationForTenantRoles,
  createNotificationsForUsers,
  getTenantMemberUserIds,
} from "@/src/lib/notifications";
import { createReminder } from "@/src/lib/reminders";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type AutomationTriggerContext = {
  entityId?: string | null;
  entityType?: string | null;
  metadata?: Record<string, unknown>;
  tenantId: string;
  triggerSource?: string;
};

export type AutomationExecutionResult = {
  logs: string[];
  run: AutomationRun | null;
  status: "failed" | "skipped" | "success";
};

const duplicateWindowMs = 5 * 60 * 1000;

function getValueAtPath(source: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, source);
}

function compareValues(
  condition: AutomationRuleCondition,
  context: AutomationTriggerContext,
) {
  const field =
    typeof condition.value_json.field === "string"
      ? condition.value_json.field
      : "entityType";
  const expected = condition.value_json.value;
  const actual = getValueAtPath(
    {
      entityId: context.entityId ?? null,
      entityType: context.entityType ?? null,
      metadata: context.metadata ?? {},
      triggerSource: context.triggerSource ?? null,
    },
    field,
  );

  if (condition.condition_type === "not_equals") {
    return actual !== expected;
  }

  if (condition.condition_type === "greater_than") {
    return Number(actual) > Number(expected);
  }

  if (condition.condition_type === "less_than") {
    return Number(actual) < Number(expected);
  }

  if (condition.condition_type === "contains") {
    return String(actual ?? "")
      .toLowerCase()
      .includes(String(expected ?? "").toLowerCase());
  }

  if (condition.condition_type === "date_before") {
    return new Date(String(actual)).getTime() < new Date(String(expected)).getTime();
  }

  if (condition.condition_type === "date_after") {
    return new Date(String(actual)).getTime() > new Date(String(expected)).getTime();
  }

  return actual === expected;
}

export function evaluateAutomationConditions(
  conditions: AutomationRuleCondition[],
  context: AutomationTriggerContext,
) {
  const failed = conditions.filter(
    (condition) => !compareValues(condition, context),
  );

  return {
    passed: failed.length === 0,
    skippedReason:
      failed.length > 0
        ? `${failed.length} automation condition${failed.length === 1 ? "" : "s"} did not match.`
        : null,
  };
}

async function createRun(
  rule: AutomationRule,
  context: AutomationTriggerContext,
  status: AutomationRun["status"] = "queued",
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({
      created_by: await getCurrentUserId(),
      entity_id: context.entityId ?? null,
      entity_type: context.entityType ?? null,
      metadata_json: context.metadata ?? {},
      rule_id: rule.id,
      status,
      tenant_id: context.tenantId,
      trigger_source: context.triggerSource ?? rule.trigger_type,
    })
    .select(
      "id,tenant_id,rule_id,trigger_source,entity_type,entity_id,status,started_at,completed_at,error_message,metadata_json",
    )
    .single();

  if (error) {
    throw error;
  }

  return data as AutomationRun;
}

async function getCurrentUserId() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

async function hasRecentDuplicateRun(
  rule: AutomationRule,
  context: AutomationTriggerContext,
) {
  if (!context.entityId || !context.entityType) {
    return false;
  }

  const supabase = getSupabaseClient();
  const since = new Date(Date.now() - duplicateWindowMs).toISOString();
  const { data, error } = await supabase
    .from("automation_runs")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("rule_id", rule.id)
    .eq("trigger_source", context.triggerSource ?? rule.trigger_type)
    .eq("entity_type", context.entityType)
    .eq("entity_id", context.entityId)
    .gte("started_at", since)
    .in("status", ["queued", "success", "failed"])
    .limit(1);

  if (error) {
    return false;
  }

  return (data ?? []).length > 0;
}

async function updateRun(
  run: AutomationRun,
  status: AutomationRun["status"],
  errorMessage?: string,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("automation_runs")
    .update({
      completed_at: new Date().toISOString(),
      error_message: errorMessage ?? null,
      status,
    })
    .eq("tenant_id", run.tenant_id)
    .eq("id", run.id)
    .select(
      "id,tenant_id,rule_id,trigger_source,entity_type,entity_id,status,started_at,completed_at,error_message,metadata_json",
    )
    .single();

  if (error) {
    throw error;
  }

  return data as AutomationRun;
}

async function insertRunLog(
  run: AutomationRun,
  logLevel: "error" | "info" | "warning",
  message: string,
  metadata: Record<string, unknown> = {},
) {
  const supabase = getSupabaseClient();
  await supabase.from("automation_run_logs").insert({
    log_level: logLevel,
    message,
    metadata_json: metadata,
    run_id: run.id,
    tenant_id: run.tenant_id,
  });
}

async function insertAutomationCommunicationLog(params: {
  action: AutomationRuleAction;
  context: AutomationTriggerContext;
  message: string;
  status?: "queued" | "skipped";
  subject: string;
  channel: "email" | "whatsapp";
}) {
  const userId = await getCurrentUserId();

  return queueCommunicationLog({
    channel: params.channel,
    message: params.message,
    metadata: {
      automationActionId: params.action.id,
      automationRuleId: params.action.rule_id,
      entityId: params.context.entityId ?? null,
      entityType: params.context.entityType ?? null,
      triggerSource: params.context.triggerSource ?? null,
    },
    status: params.status ?? "queued",
    subject: params.subject,
    target:
      typeof params.action.config_json.target === "string"
        ? params.action.config_json.target
        : null,
    tenantId: params.context.tenantId,
    type: "automation_placeholder",
    userId,
  });
}

async function getConfiguredNotificationUserIds(
  action: AutomationRuleAction,
  tenantId: string,
) {
  const configuredUserId =
    typeof action.config_json.user_id === "string"
      ? action.config_json.user_id
      : null;

  if (!configuredUserId) {
    return null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", configuredUserId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return [configuredUserId];
}

async function executeAction(
  action: AutomationRuleAction,
  rule: AutomationRule,
  context: AutomationTriggerContext,
) {
  const title =
    typeof action.config_json.title === "string"
      ? action.config_json.title
      : `${rule.name} automation`;
  const message =
    typeof action.config_json.message === "string"
      ? action.config_json.message
      : "Automation placeholder executed inside CoachFort.";

  if (action.action_type === "create_notification") {
    const configuredUserIds = await getConfiguredNotificationUserIds(
      action,
      context.tenantId,
    );
    const userIds =
      configuredUserIds ?? (await getTenantMemberUserIds(context.tenantId, [
        "owner",
        "admin",
      ]));

    const notifications = configuredUserIds
      ? await createNotificationsForUsers({
          actionUrl: "/app/automations",
          entityId: context.entityId ?? undefined,
          entityType: context.entityType ?? "automation",
          message,
          metadata: {
            automationActionId: action.id,
            automationRuleId: rule.id,
            triggerType: rule.trigger_type,
          },
          severity: "info",
          tenantId: context.tenantId,
          title,
          type: "system_notice",
          userIds,
        })
      : await createNotificationForTenantRoles({
          actionUrl: "/app/automations",
          entityId: context.entityId ?? undefined,
          entityType: context.entityType ?? "automation",
          message,
          metadata: {
            automationActionId: action.id,
            automationRuleId: rule.id,
            triggerType: rule.trigger_type,
          },
          roles: ["owner", "admin"],
          severity: "info",
          tenantId: context.tenantId,
          title,
          type: "system_notice",
        });

    return notifications.length > 0
      ? "Notification created."
      : "Notification output skipped by RLS or missing notification support.";
  }

  if (action.action_type === "create_reminder") {
    const dueAt = new Date();
    const offsetDays = Number(action.config_json.due_offset_days ?? 1);
    dueAt.setDate(dueAt.getDate() + Math.max(0, offsetDays));

    try {
      await createReminder({
        description: message,
        due_at: dueAt.toISOString(),
        reminder_type: "general",
        tenant_id: context.tenantId,
        title,
      });
    } catch {
      return "Reminder output skipped by RLS or missing reminder support.";
    }

    return "Reminder created.";
  }

  if (action.action_type === "send_email_placeholder") {
    const log = await insertAutomationCommunicationLog({
      action,
      channel: "email",
      context,
      message,
      subject: title,
    });

    return log
      ? "Email placeholder queued."
      : "Email placeholder skipped because communication logs are unavailable.";
  }

  if (action.action_type === "send_whatsapp_placeholder") {
    const log = await insertAutomationCommunicationLog({
      action,
      channel: "whatsapp",
      context,
      message,
      subject: title,
    });

    return log
      ? "WhatsApp placeholder queued."
      : "WhatsApp placeholder skipped because communication logs are unavailable.";
  }

  const placeholderLabels: Record<AutomationActionType, string> = {
    add_internal_note: "Internal note placeholder recorded.",
    create_notification: "Notification created.",
    create_reminder: "Reminder created.",
    generate_task_placeholder: "Task generation placeholder recorded.",
    send_email_placeholder: "Email provider placeholder recorded.",
    send_whatsapp_placeholder: "WhatsApp provider placeholder recorded.",
  };

  return placeholderLabels[action.action_type];
}

export async function executeAutomationActions(
  rule: AutomationRule,
  context: AutomationTriggerContext,
  run?: AutomationRun,
) {
  const logs: string[] = [];

  for (const action of rule.actions) {
    try {
      const actionLog = await executeAction(action, rule, context);
      logs.push(actionLog);

      if (run) {
        await insertRunLog(run, "info", actionLog, {
          actionId: action.id,
          actionType: action.action_type,
        });
      }

      const actionWasSkipped = actionLog.toLowerCase().includes("skipped");
      const auditAction = actionWasSkipped
        ? "automation_action_skipped"
        : action.action_type === "create_notification"
          ? "automation_notification_created"
          : action.action_type === "send_email_placeholder" ||
              action.action_type === "send_whatsapp_placeholder"
            ? "automation_placeholder_queued"
            : "automation_action_executed";

      await logActivity({
        action: auditAction,
        description: actionLog,
        entityId: rule.id,
        entityName: rule.name,
        entityType: "automation",
        metadata: {
          actionId: action.id,
          actionType: action.action_type,
          entityId: context.entityId ?? null,
          entityType: context.entityType ?? null,
          runId: run?.id ?? null,
        },
        tenantId: context.tenantId,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Action failed.";
      logs.push(message);

      if (run) {
        await insertRunLog(run, "error", message, {
          actionId: action.id,
          actionType: action.action_type,
        });
      }

      throw caught;
    }
  }

  return logs;
}

export async function runAutomationRule(
  rule: AutomationRule,
  context: AutomationTriggerContext,
): Promise<AutomationExecutionResult> {
  let run: AutomationRun | null = null;

  try {
    if (await hasRecentDuplicateRun(rule, context)) {
      run = await createRun(rule, context, "skipped");
      await insertRunLog(
        run,
        "warning",
        "Duplicate automation trigger skipped within the debounce window.",
        {
          debounceWindowMinutes: duplicateWindowMs / 60000,
          entityId: context.entityId ?? null,
          entityType: context.entityType ?? null,
          triggerSource: context.triggerSource ?? rule.trigger_type,
        },
      );
      run = await updateRun(run, "skipped");
      await logActivity({
        action: "automation_duplicate_skipped",
        description: `Skipped duplicate automation ${rule.name}.`,
        entityId: rule.id,
        entityName: rule.name,
        entityType: "automation",
        metadata: {
          entityId: context.entityId ?? null,
          entityType: context.entityType ?? null,
          runId: run.id,
          triggerType: rule.trigger_type,
        },
        severity: "warning",
        tenantId: context.tenantId,
      });

      return {
        logs: ["Duplicate automation trigger skipped."],
        run,
        status: "skipped",
      };
    }

    run = await createRun(rule, context);
    const conditionResult = evaluateAutomationConditions(
      rule.conditions,
      context,
    );

    if (!conditionResult.passed) {
      await insertRunLog(
        run,
        "warning",
        conditionResult.skippedReason ?? "Automation conditions did not pass.",
      );
      const skippedRun = await updateRun(run, "skipped");
      await logActivity({
        action: "automation_action_skipped",
        description: conditionResult.skippedReason ?? "Automation skipped.",
        entityId: rule.id,
        entityName: rule.name,
        entityType: "automation",
        metadata: {
          runId: run.id,
          triggerType: rule.trigger_type,
        },
        severity: "warning",
        tenantId: context.tenantId,
      });

      return {
        logs: [conditionResult.skippedReason ?? "Skipped."],
        run: skippedRun,
        status: "skipped",
      };
    }

    const logs = await executeAutomationActions(rule, context, run);
    const successRun = await updateRun(run, "success");
    await insertRunLog(run, "info", "Automation executed successfully.", {
      actionCount: rule.actions.length,
    });
    await logActivity({
      action: "automation_executed",
      description: `Executed automation ${rule.name}.`,
      entityId: rule.id,
      entityName: rule.name,
      entityType: "automation",
      metadata: { runId: run.id, triggerType: rule.trigger_type },
      tenantId: context.tenantId,
    });

    return { logs, run: successRun, status: "success" };
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Automation execution failed.";

    if (run) {
      await insertRunLog(run, "error", message);
      run = await updateRun(run, "failed", message);
    }

    await logActivity({
      action: "automation_failed",
      description: `Automation failed: ${message}`,
      entityId: rule.id,
      entityName: rule.name,
      entityType: "automation",
      metadata: { triggerType: rule.trigger_type },
      severity: "warning",
      tenantId: context.tenantId,
    });

    return {
      logs: [message],
      run,
      status: "failed",
    };
  }
}
