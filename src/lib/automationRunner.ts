import {
  type AutomationRule,
  type AutomationRuleCondition,
  type AutomationRun,
} from "@/src/lib/automations";

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

export async function executeAutomationActions() {
  return [
    "Browser-side automation action execution is retired. Automations run through the secure trigger RPC.",
  ];
}

export async function runAutomationRule(
  rule: AutomationRule,
  context: AutomationTriggerContext,
): Promise<AutomationExecutionResult> {
  void rule;
  void context;

  return {
    logs: [
      "Manual browser automation execution is retired. Automations run through product triggers and the secure run_automation_trigger RPC.",
    ],
    run: null,
    status: "skipped",
  };
}
