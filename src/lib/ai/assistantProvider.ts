import type {
  AssistantProviderInput,
  AssistantProviderResult,
} from "@/src/lib/ai/assistantTypes";

function formatCount(value: unknown) {
  if (typeof value === "number") {
    return value.toLocaleString();
  }

  return "0";
}

function getSummaryValue(summary: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (summary[key] !== undefined && summary[key] !== null) {
      return summary[key];
    }
  }

  return 0;
}

function buildMockResponse({ context, message }: AssistantProviderInput) {
  const lowerMessage = message.toLowerCase();
  const summary = (context.contextSummary.summary ?? {}) as Record<string, unknown>;
  const tenantName =
    ((context.context.tenant as Record<string, unknown> | null)?.brand_name as
      | string
      | undefined) ||
    ((context.context.tenant as Record<string, unknown> | null)?.name as
      | string
      | undefined) ||
    "your workspace";

  if (context.mode === "student") {
    const assignments = formatCount(
      getSummaryValue(summary, ["pending_assignment_count"]),
    );
    const sessions = formatCount(
      getSummaryValue(summary, ["upcoming_session_count"]),
    );
    const payments = formatCount(getSummaryValue(summary, ["pending_payment_count"]));

    if (lowerMessage.includes("assignment")) {
      return `You have ${assignments} pending assignment item(s) in ${tenantName}. Review the Assignments section and check due dates before starting new work.`;
    }

    if (lowerMessage.includes("session") || lowerMessage.includes("class")) {
      return `You have ${sessions} upcoming session(s). Open Sessions for schedule and joining details.`;
    }

    if (lowerMessage.includes("payment")) {
      return `Your portal shows ${payments} pending payment item(s). Check Payments for the exact coach-provided status.`;
    }

    return `For today, start with your upcoming sessions (${sessions}), pending assignments (${assignments}), and payment reminders (${payments}). I can guide you, but confirm critical details with your coach.`;
  }

  const role = context.role ?? "team";
  const students = formatCount(
    getSummaryValue(summary, ["active_students", "active_student_count"]),
  );
  const sessions = formatCount(
    getSummaryValue(summary, ["sessions_next_7_days", "upcoming_session_count"]),
  );
  const payments = formatCount(
    getSummaryValue(summary, ["pending_payments", "pending_payment_count"]),
  );
  const submissions = formatCount(
    getSummaryValue(summary, ["pending_submission_count"]),
  );

  if (role === "trainer") {
    if (lowerMessage.includes("assignment") || lowerMessage.includes("review")) {
      return `Your coaching context shows ${submissions} submission(s) needing review. Check Assignments for the scoped review list before taking action.`;
    }

    return `Your coaching workload snapshot shows ${sessions} upcoming session(s) and ${submissions} pending submission review(s). I can suggest priorities, but I cannot update records for you.`;
  }

  if (lowerMessage.includes("payment")) {
    return `The current operational snapshot shows ${payments} pending payment item(s). Use Payments or Reports to inspect details before contacting students.`;
  }

  if (lowerMessage.includes("student")) {
    return `${tenantName} currently has ${students} active student(s) visible in your role context. Review Students or Reports for detailed follow-up.`;
  }

  return `Workspace snapshot for ${tenantName}: ${students} active student(s), ${sessions} session(s) in the next 7 days, and ${payments} pending payment item(s). I can summarize and suggest next steps, but I will not perform changes automatically.`;
}

export async function generateAssistantResponse(
  input: AssistantProviderInput,
): Promise<AssistantProviderResult> {
  const provider = "mock";
  const response = buildMockResponse(input);

  return {
    provider,
    response,
    responseCharCount: response.length,
  };
}
