"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  createAutomationRule,
  getAutomationRulesForTenant,
  getAutomationRuns,
  toggleAutomationRule,
  updateAutomationRule,
  type AutomationActionType,
  type AutomationConditionType,
  type AutomationExecutionMode,
  type AutomationRule,
  type AutomationRulePayload,
  type AutomationRuleStatus,
  type AutomationRun,
  type AutomationTriggerType,
} from "@/src/lib/automations";
import { logActivity } from "@/src/lib/auditLogger";
import { canManageAutomations as canManageAutomationsForRole } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type StatusFilter = "all" | AutomationRuleStatus;
type TriggerFilter = "all" | AutomationTriggerType;

type AutomationFormState = {
  actionConfigMessage: string;
  actionConfigTitle: string;
  actionType: AutomationActionType;
  conditionField: string;
  conditionType: AutomationConditionType;
  conditionValue: string;
  description: string;
  executionMode: AutomationExecutionMode;
  name: string;
  status: AutomationRuleStatus;
  triggerType: AutomationTriggerType;
};

const emptyForm: AutomationFormState = {
  actionConfigMessage: "",
  actionConfigTitle: "",
  actionType: "create_notification",
  conditionField: "",
  conditionType: "equals",
  conditionValue: "",
  description: "",
  executionMode: "instant",
  name: "",
  status: "draft",
  triggerType: "student_created",
};

const statusFilters: StatusFilter[] = ["all", "active", "inactive", "draft"];
const triggerTypes: AutomationTriggerType[] = [
  "student_created",
  "payment_received",
  "assignment_overdue",
  "attendance_low",
  "session_scheduled",
  "trial_expiring",
  "certificate_issued",
];
const actionTypes: AutomationActionType[] = [
  "create_notification",
  "create_reminder",
  "send_email_placeholder",
  "send_whatsapp_placeholder",
  "add_internal_note",
  "generate_task_placeholder",
];
const conditionTypes: AutomationConditionType[] = [
  "equals",
  "not_equals",
  "greater_than",
  "less_than",
  "contains",
  "date_before",
  "date_after",
];

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function statusTone(status: AutomationRuleStatus) {
  if (status === "active") {
    return "border-teal-400/30 bg-teal-400/10 text-teal-300";
  }

  if (status === "draft") {
    return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  }

  return "border-white/10 bg-white/10 text-slate-300";
}

function runStatusTone(status: AutomationRun["status"]) {
  if (status === "success") {
    return "success" as const;
  }

  if (status === "failed") {
    return "danger" as const;
  }

  if (status === "skipped") {
    return "warning" as const;
  }

  return "light" as const;
}

function formFromRule(rule: AutomationRule): AutomationFormState {
  const firstAction = rule.actions[0];
  const firstCondition = rule.conditions[0];

  return {
    actionConfigMessage:
      typeof firstAction?.config_json.message === "string"
        ? firstAction.config_json.message
        : "",
    actionConfigTitle:
      typeof firstAction?.config_json.title === "string"
        ? firstAction.config_json.title
        : "",
    actionType: firstAction?.action_type ?? rule.action_type,
    conditionField:
      typeof firstCondition?.value_json.field === "string"
        ? firstCondition.value_json.field
        : "",
    conditionType: firstCondition?.condition_type ?? "equals",
    conditionValue:
      typeof firstCondition?.value_json.value === "string"
        ? firstCondition.value_json.value
        : "",
    description: rule.description ?? "",
    executionMode: rule.execution_mode,
    name: rule.name,
    status: rule.status,
    triggerType: rule.trigger_type,
  };
}

function payloadFromForm(
  form: AutomationFormState,
  tenantId: string,
): AutomationRulePayload {
  const conditions =
    form.conditionField.trim() || form.conditionValue.trim()
      ? [
          {
            condition_type: form.conditionType,
            operator: form.conditionType,
            value_json: {
              field: form.conditionField.trim() || "entityType",
              value: form.conditionValue.trim(),
            },
          },
        ]
      : [];

  return {
    actions: [
      {
        action_type: form.actionType,
        config_json: {
          message:
            form.actionConfigMessage.trim() ||
            "Automation placeholder executed inside CoachFort.",
          title: form.actionConfigTitle.trim() || form.name.trim(),
        },
      },
    ],
    conditions,
    description: form.description,
    execution_mode: form.executionMode,
    name: form.name,
    status: form.status,
    tenant_id: tenantId,
    trigger_type: form.triggerType,
  };
}

function getSearchText(rule: AutomationRule) {
  return [
    rule.name,
    rule.description,
    rule.status,
    rule.trigger_type,
    rule.actions.map((action) => action.action_type).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function AutomationsPageClient() {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<AutomationFormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState("");
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>("all");
  const canManageAutomations = canManageAutomationsForRole(currentRole);

  async function loadAutomationData(currentTenant: Tenant) {
    const [ruleRows, runRows] = await Promise.all([
      getAutomationRulesForTenant(currentTenant.id),
      getAutomationRuns(currentTenant.id, 12),
    ]);

    setRules(ruleRows);
    setRuns(runRows);
  }

  useEffect(() => {
    let active = true;

    async function loadAutomations() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const supabase = getSupabaseClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        const role = user
          ? await getCurrentMemberRole(currentTenant.id, user.id)
          : null;

        setTenant(currentTenant);
        setCurrentRole(role);

        if (canManageAutomationsForRole(role)) {
          await loadAutomationData(currentTenant);
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load automations."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadAutomations();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!loading && tenant && currentRole && !canManageAutomations) {
      void logActivity({
        action: "access_denied",
        description: "Blocked automations page access attempt.",
        entityName: "Automations",
        entityType: "security",
        metadata: { route: "/app/automations", role: currentRole },
        severity: "warning",
        tenantId: tenant.id,
      });
    }
  }, [canManageAutomations, currentRole, loading, tenant]);

  const filteredRules = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return rules.filter((rule) => {
      const matchesStatus =
        statusFilter === "all" || rule.status === statusFilter;
      const matchesTrigger =
        triggerFilter === "all" || rule.trigger_type === triggerFilter;
      const matchesSearch =
        !normalizedSearch || getSearchText(rule).includes(normalizedSearch);

      return matchesStatus && matchesTrigger && matchesSearch;
    });
  }, [rules, search, statusFilter, triggerFilter]);
  const failedRuns = runs.filter((run) => run.status === "failed").length;
  const successfulRuns = runs.filter((run) => run.status === "success").length;

  if (!loading && currentRole && !canManageAutomations) {
    return (
      <AccessDeniedCard description="Only workspace owners and admins can access automation rules." />
    );
  }

  function openCreateForm() {
    if (!canManageAutomations) {
      return;
    }

    setActionError("");
    setSuccess("");
    setEditingRule(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEditForm(rule: AutomationRule) {
    if (!canManageAutomations) {
      return;
    }

    setActionError("");
    setSuccess("");
    setEditingRule(rule);
    setForm(formFromRule(rule));
    setFormOpen(true);
  }

  async function refreshAutomationData() {
    if (tenant) {
      await loadAutomationData(tenant);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !canManageAutomations) {
      setActionError("Workspace context is not available.");
      return;
    }

    setMutatingId("form");
    setActionError("");
    setSuccess("");

    try {
      const payload = payloadFromForm(form, tenant.id);

      if (editingRule) {
        await updateAutomationRule(editingRule.id, tenant.id, payload);
      } else {
        await createAutomationRule(payload);
      }

      setFormOpen(false);
      setEditingRule(null);
      setForm(emptyForm);
      await refreshAutomationData();
      setSuccess(editingRule ? "Automation updated." : "Automation created.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to save automation."));
    } finally {
      setMutatingId("");
    }
  }

  async function handleToggle(rule: AutomationRule) {
    if (!tenant || !canManageAutomations) {
      return;
    }

    setMutatingId(rule.id);
    setActionError("");
    setSuccess("");

    try {
      await toggleAutomationRule(rule.id, tenant.id, rule.status !== "active");
      await refreshAutomationData();
      setSuccess(
        rule.status === "active"
          ? "Automation deactivated."
          : "Automation activated.",
      );
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to update automation."));
    } finally {
      setMutatingId("");
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
            Workflow engine
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Automations
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Build internal workflows with triggers, conditions, placeholder
            actions, and run logging. External providers and cron workers are
            intentionally not connected yet.
          </p>
        </div>
        {canManageAutomations ? (
          <Button onClick={openCreateForm} size="lg" type="button">
            Create Automation
          </Button>
        ) : null}
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-4">
        <Card className="border-white/10 bg-[#101214] p-5 text-white">
          <p className="text-sm text-slate-400">Rules</p>
          <p className="mt-2 text-3xl font-semibold">{rules.length}</p>
        </Card>
        <Card className="border-white/10 bg-[#101214] p-5 text-white">
          <p className="text-sm text-slate-400">Active</p>
          <p className="mt-2 text-3xl font-semibold">
            {rules.filter((rule) => rule.status === "active").length}
          </p>
        </Card>
        <Card className="border-white/10 bg-[#101214] p-5 text-white">
          <p className="text-sm text-slate-400">Successful runs</p>
          <p className="mt-2 text-3xl font-semibold">{successfulRuns}</p>
        </Card>
        <Card className="border-white/10 bg-[#101214] p-5 text-white">
          <p className="text-sm text-slate-400">Failed runs</p>
          <p className="mt-2 text-3xl font-semibold">{failedRuns}</p>
        </Card>
      </section>

      <Card className="mt-6 border-white/10 bg-[#101214] p-5 text-white shadow-2xl shadow-black/10 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
          <div>
            <p className="text-sm font-medium text-slate-400">
              Current workspace
            </p>
            <p className="mt-1 text-xl font-semibold">
              {tenant?.name ?? "Loading workspace..."}
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-400">Search</span>
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:ring-4 focus:ring-teal-400/10"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rule name"
              type="search"
              value={search}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-400">Status</span>
            <select
              className="mt-2 h-11 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:ring-4 focus:ring-teal-400/10"
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              value={statusFilter}
            >
              {statusFilters.map((status) => (
                <option className="text-slate-950" key={status} value={status}>
                  {formatLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-400">Trigger</span>
            <select
              className="mt-2 h-11 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:ring-4 focus:ring-teal-400/10"
              onChange={(event) =>
                setTriggerFilter(event.target.value as TriggerFilter)
              }
              value={triggerFilter}
            >
              {(["all", ...triggerTypes] as TriggerFilter[]).map((trigger) => (
                <option
                  className="text-slate-950"
                  key={trigger}
                  value={trigger}
                >
                  {formatLabel(trigger)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {error ? (
        <div className="mt-6">
          <FeedbackAlert onRetry={() => window.location.reload()}>
            {error}
          </FeedbackAlert>
        </div>
      ) : null}

      {actionError ? (
        <div className="mt-6">
          <FeedbackAlert>{actionError}</FeedbackAlert>
        </div>
      ) : null}

      {success ? (
        <div className="mt-6">
          <FeedbackAlert tone="success">{success}</FeedbackAlert>
        </div>
      ) : null}

      {loading ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Card
              className="h-64 animate-pulse border-white/10 bg-[#101214]"
              key={item}
            >
              <span className="sr-only">Loading automation</span>
            </Card>
          ))}
        </section>
      ) : filteredRules.length === 0 ? (
        <EmptyState
          action={
            canManageAutomations
              ? { label: "Create Automation", onClick: openCreateForm }
              : undefined
          }
          description="Create a draft workflow with a trigger, optional condition, and placeholder action."
          icon="AU"
          title="No automation rules found"
        />
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredRules.map((rule) => (
            <Card
              className="flex min-h-80 flex-col justify-between border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10"
              key={rule.id}
            >
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Badge className={statusTone(rule.status)}>
                    {formatLabel(rule.status)}
                  </Badge>
                  <Badge className="border-white/15 bg-white/10 text-white">
                    {formatLabel(rule.trigger_type)}
                  </Badge>
                </div>
                <h3 className="mt-5 text-2xl font-semibold leading-tight">
                  {rule.name}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  {rule.description || "No description added."}
                </p>
                <div className="mt-5 space-y-2 text-sm text-slate-400">
                  <p>
                    Mode:{" "}
                    <span className="text-white">
                      {formatLabel(rule.execution_mode)}
                    </span>
                  </p>
                  <p>
                    Actions:{" "}
                    <span className="text-white">{rule.actions.length}</span>
                  </p>
                  <p>
                    Conditions:{" "}
                    <span className="text-white">{rule.conditions.length}</span>
                  </p>
                  <p>Created {formatDate(rule.created_at)}</p>
                </div>
              </div>
              <div className="mt-7 flex flex-wrap gap-2 border-t border-white/10 pt-5">
                <Button
                  disabled={mutatingId === rule.id}
                  onClick={() => handleToggle(rule)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {rule.status === "active" ? "Disable" : "Enable"}
                </Button>
                <Button
                  onClick={() => openEditForm(rule)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Edit
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      <section className="mt-8">
        <Card className="border-white/10 bg-[#101214] p-6 text-white">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Run history
              </Badge>
              <h3 className="mt-4 text-xl font-semibold">Recent executions</h3>
            </div>
            <Button
              onClick={refreshAutomationData}
              type="button"
              variant="secondary"
            >
              Refresh
            </Button>
          </div>
          <div className="mt-5 space-y-3">
            {runs.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                No automation runs have been recorded yet.
              </p>
            ) : (
              runs.map((run) => (
                <div
                  className="flex flex-col justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center"
                  key={run.id}
                >
                  <div>
                    <p className="font-semibold">
                      {formatLabel(run.trigger_source ?? "manual")}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      Started {formatDate(run.started_at)}
                    </p>
                    {run.error_message ? (
                      <p className="mt-1 text-sm text-red-200">
                        {run.error_message}
                      </p>
                    ) : null}
                  </div>
                  <Badge tone={runStatusTone(run.status)}>
                    {formatLabel(run.status)}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-3xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-500">
                  {editingRule ? "Edit workflow" : "New workflow"}
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  {editingRule ? "Edit Automation" : "Create Automation"}
                </h3>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-sm font-semibold text-slate-500 transition hover:bg-white/10 hover:text-white"
                onClick={() => setFormOpen(false)}
                type="button"
              >
                X
              </button>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Rule name
                </span>
                <input
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Low attendance warning"
                  required
                  type="text"
                  value={form.name}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Description
                </span>
                <textarea
                  className="mt-2 min-h-20 w-full resize-none rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Describe what this automation is meant to do."
                  value={form.description}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Trigger
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        triggerType: event.target.value as AutomationTriggerType,
                      }))
                    }
                    value={form.triggerType}
                  >
                    {triggerTypes.map((trigger) => (
                      <option
                        className="text-slate-950"
                        key={trigger}
                        value={trigger}
                      >
                        {formatLabel(trigger)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Status
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        status: event.target.value as AutomationRuleStatus,
                      }))
                    }
                    value={form.status}
                  >
                    {(["draft", "active", "inactive"] as AutomationRuleStatus[]).map(
                      (status) => (
                        <option
                          className="text-slate-950"
                          key={status}
                          value={status}
                        >
                          {formatLabel(status)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Mode
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        executionMode: event.target.value as AutomationExecutionMode,
                      }))
                    }
                    value={form.executionMode}
                  >
                    <option className="text-slate-950" value="instant">
                      Instant
                    </option>
                    <option className="text-slate-950" value="scheduled">
                      Scheduled placeholder
                    </option>
                  </select>
                </label>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p className="font-semibold">Optional condition</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <input
                    className="h-12 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none placeholder:text-slate-400"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        conditionField: event.target.value,
                      }))
                    }
                    placeholder="metadata.score"
                    value={form.conditionField}
                  />
                  <select
                    className="h-12 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        conditionType: event.target.value as AutomationConditionType,
                      }))
                    }
                    value={form.conditionType}
                  >
                    {conditionTypes.map((condition) => (
                      <option
                        className="text-slate-950"
                        key={condition}
                        value={condition}
                      >
                        {formatLabel(condition)}
                      </option>
                    ))}
                  </select>
                  <input
                    className="h-12 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none placeholder:text-slate-400"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        conditionValue: event.target.value,
                      }))
                    }
                    placeholder="value"
                    value={form.conditionValue}
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p className="font-semibold">Action</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-300">
                      Action type
                    </span>
                    <select
                      className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          actionType: event.target.value as AutomationActionType,
                        }))
                      }
                      value={form.actionType}
                    >
                      {actionTypes.map((action) => (
                        <option
                          className="text-slate-950"
                          key={action}
                          value={action}
                        >
                          {formatLabel(action)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-slate-300">
                      Title
                    </span>
                    <input
                      className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none placeholder:text-slate-400"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          actionConfigTitle: event.target.value,
                        }))
                      }
                      placeholder="Automation notice"
                      value={form.actionConfigTitle}
                    />
                  </label>
                </div>
                <label className="mt-4 block">
                  <span className="text-sm font-medium text-slate-300">
                    Message
                  </span>
                  <textarea
                    className="mt-2 min-h-20 w-full resize-none rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-400"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        actionConfigMessage: event.target.value,
                      }))
                    }
                    placeholder="Placeholder message or internal note."
                    value={form.actionConfigMessage}
                  />
                </label>
              </div>

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  className="border-white/10"
                  onClick={() => setFormOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={mutatingId === "form"} type="submit">
                  {mutatingId === "form"
                    ? "Saving..."
                    : editingRule
                      ? "Save Changes"
                      : "Create Automation"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
