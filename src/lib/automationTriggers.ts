import { logActivity } from "@/src/lib/auditLogger";
import { type AutomationTriggerType } from "@/src/lib/automations";
import { type AutomationTriggerContext } from "@/src/lib/automationRunner";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

const assignmentSelect =
  "id,tenant_id,course_id,cohort_id,title,due_at,status";
const tenantTrialSelect =
  "id,name,trial_ends_at,is_trial_active";

type AutomationTriggerResult = {
  executed: number;
  failed: number;
  quotaDenied: number;
  quotaMessage: string | null;
  results: [];
  skipped: number;
};

const emptyTriggerResult: AutomationTriggerResult = {
  executed: 0,
  failed: 0,
  quotaDenied: 0,
  quotaMessage: null,
  results: [],
  skipped: 0,
};

export function createAutomationExecutionId() {
  return crypto.randomUUID();
}

export async function runAutomationTrigger(
  triggerType: AutomationTriggerType,
  context: Omit<AutomationTriggerContext, "triggerSource"> & {
    executionId?: string;
  },
): Promise<AutomationTriggerResult> {
  try {
    const executionId = context.executionId ?? createAutomationExecutionId();

    await logActivity({
      action: "automation_trigger_received",
      description: `Received automation trigger ${triggerType}.`,
      entityId: context.entityId ?? null,
      entityName: triggerType,
      entityType: context.entityType ?? "automation",
      metadata: {
        entityId: context.entityId ?? null,
        metadata: context.metadata ?? {},
        triggerType,
      },
      tenantId: context.tenantId,
    });

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("run_automation_trigger", {
      entity_id: context.entityId ?? null,
      entity_type: context.entityType ?? "automation",
      metadata_json: context.metadata ?? {},
      p_execution_id: executionId,
      tenant_id: context.tenantId,
      trigger_type: triggerType,
    });

    if (error) {
      return emptyTriggerResult;
    }

    const summary = Array.isArray(data) ? data[0] : data;
    const quotaDenied = Number(summary?.quota_denied_count ?? 0);

    return {
      executed: Number(summary?.executed_count ?? 0),
      failed: Number(summary?.failed_count ?? 0),
      quotaDenied,
      quotaMessage:
        quotaDenied > 0
          ? "You've reached your monthly automation run limit."
          : null,
      results: [],
      skipped: Number(summary?.skipped_count ?? 0),
    };
  } catch {
    return emptyTriggerResult;
  }
}

export async function runAssignmentOverdueAutomationForTenant(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("assignments")
    .select(assignmentSelect)
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .lt("due_at", new Date().toISOString())
    .limit(100);

  if (error) {
    return { ...emptyTriggerResult, results: [] };
  }

  const assignments = (data ?? []) as {
    cohort_id: string | null;
    course_id: string | null;
    due_at: string | null;
    id: string;
    status: string;
    tenant_id: string;
    title: string;
  }[];
  const totals = { ...emptyTriggerResult, results: [] } as Awaited<
    ReturnType<typeof runAutomationTrigger>
  >;

  for (const assignment of assignments) {
    const result = await runAutomationTrigger("assignment_overdue", {
      entityId: assignment.id,
      entityType: "assignment",
      metadata: {
        assignment_title: assignment.title,
        cohort_id: assignment.cohort_id,
        course_id: assignment.course_id,
        due_at: assignment.due_at,
        status: assignment.status,
      },
      tenantId,
    });
    totals.executed += result.executed;
    totals.failed += result.failed;
    totals.quotaDenied += result.quotaDenied;
    totals.quotaMessage ??= result.quotaMessage;
    totals.skipped += result.skipped;
    totals.results.push(...result.results);
  }

  return totals;
}

export async function runLowAttendanceAutomationForTenant(
  tenantId: string,
  thresholdPercent = 75,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .select("student_id,status")
    .eq("tenant_id", tenantId)
    .limit(5000);

  if (error) {
    return { ...emptyTriggerResult, results: [] };
  }

  const byStudent = new Map<string, { attended: number; total: number }>();

  for (const record of (data ?? []) as {
    status: string;
    student_id: string;
  }[]) {
    const current = byStudent.get(record.student_id) ?? { attended: 0, total: 0 };
    current.total += 1;

    if (record.status === "present" || record.status === "late") {
      current.attended += 1;
    }

    byStudent.set(record.student_id, current);
  }

  const totals = { ...emptyTriggerResult, results: [] } as Awaited<
    ReturnType<typeof runAutomationTrigger>
  >;

  for (const [studentId, summary] of byStudent.entries()) {
    if (summary.total === 0) {
      continue;
    }

    const percent = Math.round((summary.attended / summary.total) * 100);

    if (percent >= thresholdPercent) {
      continue;
    }

    const result = await runAutomationTrigger("attendance_low", {
      entityId: studentId,
      entityType: "student",
      metadata: {
        attendance_percent: percent,
        attended_sessions: summary.attended,
        threshold_percent: thresholdPercent,
        total_sessions: summary.total,
      },
      tenantId,
    });
    totals.executed += result.executed;
    totals.failed += result.failed;
    totals.quotaDenied += result.quotaDenied;
    totals.quotaMessage ??= result.quotaMessage;
    totals.skipped += result.skipped;
    totals.results.push(...result.results);
  }

  return totals;
}

export async function runTrialExpiringAutomationForTenant(
  tenantId: string,
  warningWindowDays = 3,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenants")
    .select(tenantTrialSelect)
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !data) {
    return { ...emptyTriggerResult, results: [] };
  }

  const tenant = data as {
    id: string;
    is_trial_active: boolean | null;
    name: string | null;
    trial_ends_at: string | null;
  };
  const trialEndsAt = tenant.trial_ends_at
    ? new Date(tenant.trial_ends_at)
    : null;

  if (!tenant.is_trial_active || !trialEndsAt) {
    return { ...emptyTriggerResult, results: [] };
  }

  const now = Date.now();
  const daysRemaining = Math.ceil(
    (trialEndsAt.getTime() - now) / (24 * 60 * 60 * 1000),
  );

  if (daysRemaining < 0 || daysRemaining > warningWindowDays) {
    return { ...emptyTriggerResult, results: [] };
  }

  return runAutomationTrigger("trial_expiring", {
    entityId: tenant.id,
    entityType: "tenant",
    metadata: {
      days_remaining: daysRemaining,
      tenant_name: tenant.name,
      trial_ends_at: tenant.trial_ends_at,
    },
    tenantId,
  });
}
