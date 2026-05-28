import {
  getAutomationRulesForTenant,
  type AutomationTriggerType,
} from "@/src/lib/automations";
import {
  runAutomationRule,
  type AutomationExecutionResult,
  type AutomationTriggerContext,
} from "@/src/lib/automationRunner";

export async function runAutomationTrigger(
  triggerType: AutomationTriggerType,
  context: Omit<AutomationTriggerContext, "triggerSource">,
) {
  try {
    const rules = await getAutomationRulesForTenant(context.tenantId);
    const matchingRules = rules.filter(
      (rule) => rule.status === "active" && rule.trigger_type === triggerType,
    );
    const results: AutomationExecutionResult[] = [];

    for (const rule of matchingRules) {
      results.push(
        await runAutomationRule(rule, {
          ...context,
          triggerSource: triggerType,
        }),
      );
    }

    return {
      executed: results.filter((result) => result.status === "success").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
      skipped: results.filter((result) => result.status === "skipped").length,
    };
  } catch {
    return {
      executed: 0,
      failed: 0,
      results: [],
      skipped: 0,
    };
  }
}
