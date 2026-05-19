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
  deleteAutomationRule,
  getAutomationRulesForTenant,
  testAutomationRule,
  toggleAutomationRule,
  updateAutomationRule,
  type AutomationActionType,
  type AutomationRule,
  type AutomationRuleConfig,
  type AutomationTriggerType,
} from "@/src/lib/automations";
import type { ReminderType } from "@/src/lib/reminders";
import { logActivity } from "@/src/lib/auditLogger";
import { canManageAutomations as canManageAutomationsForRole } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type StatusFilter = "all" | "active" | "inactive";
type TriggerFilter = "all" | AutomationTriggerType;

type AutomationFormState = {
  actionType: AutomationActionType;
  dueOffsetDays: string;
  isActive: boolean;
  name: string;
  reminderDescription: string;
  reminderTitle: string;
  reminderType: ReminderType;
  triggerType: AutomationTriggerType;
};

const emptyForm: AutomationFormState = {
  actionType: "create_reminder",
  dueOffsetDays: "1",
  isActive: true,
  name: "",
  reminderDescription: "",
  reminderTitle: "",
  reminderType: "general",
  triggerType: "payment_created",
};

const statusFilters: StatusFilter[] = ["all", "active", "inactive"];
const triggerFilters: TriggerFilter[] = [
  "all",
  "payment_created",
  "enrollment_created",
  "student_created",
  "course_completed",
];
const triggerTypes: AutomationTriggerType[] = [
  "payment_created",
  "enrollment_created",
  "student_created",
  "course_completed",
];
const reminderTypes: ReminderType[] = [
  "general",
  "payment",
  "course_followup",
  "student_followup",
];

function formatLabel(value: string) {
  return value.replace("_", " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function formFromRule(rule: AutomationRule): AutomationFormState {
  return {
    actionType: rule.action_type,
    dueOffsetDays: String(rule.config.due_offset_days),
    isActive: rule.is_active,
    name: rule.name,
    reminderDescription: rule.config.reminder_description,
    reminderTitle: rule.config.reminder_title,
    reminderType: rule.config.reminder_type,
    triggerType: rule.trigger_type,
  };
}

function configFromForm(form: AutomationFormState): AutomationRuleConfig {
  return {
    due_offset_days: Number(form.dueOffsetDays) || 0,
    reminder_description: form.reminderDescription,
    reminder_title: form.reminderTitle,
    reminder_type: form.reminderType,
  };
}

function getSearchText(rule: AutomationRule) {
  return [
    rule.name,
    rule.trigger_type,
    rule.action_type,
    rule.config.reminder_title,
    rule.config.reminder_description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function ActiveBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
        Active
      </Badge>
    );
  }

  return (
    <Badge className="border-white/10 bg-white/10 text-slate-300">
      Inactive
    </Badge>
  );
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>("all");
  const canManageAutomations = canManageAutomationsForRole(currentRole);

  async function loadRules(currentTenant: Tenant) {
    setRules(await getAutomationRulesForTenant(currentTenant.id));
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
          await loadRules(currentTenant);
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
        statusFilter === "all" ||
        (statusFilter === "active" ? rule.is_active : !rule.is_active);
      const matchesTrigger =
        triggerFilter === "all" || rule.trigger_type === triggerFilter;
      const matchesSearch =
        !normalizedSearch || getSearchText(rule).includes(normalizedSearch);

      return matchesStatus && matchesTrigger && matchesSearch;
    });
  }, [rules, search, statusFilter, triggerFilter]);

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

  async function refreshRules() {
    if (!tenant) {
      return;
    }

    await loadRules(tenant);
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
      if (!form.name.trim()) {
        throw new Error("Automation name is required.");
      }

      if (Number(form.dueOffsetDays) < 0) {
        throw new Error("Due offset days cannot be negative.");
      }

      const payload = {
        action_type: form.actionType,
        config: configFromForm(form),
        is_active: form.isActive,
        name: form.name,
        trigger_type: form.triggerType,
      };

      if (editingRule) {
        await updateAutomationRule(editingRule.id, tenant.id, payload);
      } else {
        await createAutomationRule({
          ...payload,
          tenant_id: tenant.id,
        });
      }

      setFormOpen(false);
      setEditingRule(null);
      setForm(emptyForm);
      await refreshRules();
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
      await toggleAutomationRule(rule.id, tenant.id, !rule.is_active);
      await refreshRules();
      setSuccess(
        rule.is_active ? "Automation deactivated." : "Automation activated.",
      );
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to update automation."));
    } finally {
      setMutatingId("");
    }
  }

  async function handleTest(rule: AutomationRule) {
    if (!tenant || !canManageAutomations) {
      return;
    }

    setMutatingId(`test-${rule.id}`);
    setActionError("");
    setSuccess("");

    try {
      await testAutomationRule(rule, tenant.id);
      setSuccess(`Test reminder created from "${rule.name}".`);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to test automation."));
    } finally {
      setMutatingId("");
    }
  }

  async function handleDelete(rule: AutomationRule) {
    if (!tenant || !canManageAutomations) {
      return;
    }

    const confirmed = window.confirm(`Delete ${rule.name}?`);

    if (!confirmed) {
      return;
    }

    setMutatingId(rule.id);
    setActionError("");
    setSuccess("");

    try {
      await deleteAutomationRule(rule.id, tenant.id);
      await refreshRules();
      setSuccess("Automation deleted.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to delete automation."));
    } finally {
      setMutatingId("");
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
            Automation rules
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Automations
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Define simple internal rules that can create reminders from business
            events. No external messaging or background workers are connected.
          </p>
        </div>
        {canManageAutomations ? (
          <Button onClick={openCreateForm} size="lg" type="button">
            Create Automation
          </Button>
        ) : null}
      </div>

      <Card className="mt-8 border-white/10 bg-[#101214] p-5 text-white shadow-2xl shadow-black/10 sm:p-6">
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
                  {status}
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
              {triggerFilters.map((trigger) => (
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
          description="Create a rule to define reminder behavior for future workflow automation."
          icon="AU"
          title="No automation rules found"
        />
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredRules.map((rule) => (
            <Card
              className={[
                "flex min-h-80 flex-col justify-between p-6 text-white shadow-2xl shadow-black/10",
                rule.is_active
                  ? "border-white/10 bg-[#101214]"
                  : "border-white/10 bg-[#15181b] opacity-75",
              ].join(" ")}
              key={rule.id}
            >
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <ActiveBadge active={rule.is_active} />
                  <Badge className="border-white/15 bg-white/10 text-white">
                    {formatLabel(rule.trigger_type)}
                  </Badge>
                </div>
                <h3 className="mt-5 text-2xl font-semibold leading-tight">
                  {rule.name}
                </h3>
                <div className="mt-5 space-y-2 text-sm text-slate-400">
                  <p>
                    Action:{" "}
                    <span className="text-white">
                      {formatLabel(rule.action_type)}
                    </span>
                  </p>
                  <p>
                    Reminder:{" "}
                    <span className="text-white">
                      {rule.config.reminder_title || "Untitled reminder"}
                    </span>
                  </p>
                  <p>
                    Type:{" "}
                    <span className="text-white">
                      {formatLabel(rule.config.reminder_type)}
                    </span>
                  </p>
                  <p>
                    Due offset:{" "}
                    <span className="text-white">
                      {rule.config.due_offset_days} days
                    </span>
                  </p>
                  <p>Created {formatDate(rule.created_at)}</p>
                </div>
              </div>
              <div className="mt-7 flex flex-wrap gap-2 border-t border-white/10 pt-5">
                {canManageAutomations ? (
                  <>
                    <Button
                      disabled={mutatingId === rule.id}
                      onClick={() => handleToggle(rule)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {rule.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      disabled={mutatingId === `test-${rule.id}`}
                      onClick={() => handleTest(rule)}
                      size="sm"
                      type="button"
                    >
                      {mutatingId === `test-${rule.id}`
                        ? "Testing..."
                        : "Test rule"}
                    </Button>
                    <Button
                      onClick={() => openEditForm(rule)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Edit
                    </Button>
                    <Button
                      className="text-red-300! hover:bg-red-500/10! hover:text-red-200!"
                      disabled={mutatingId === rule.id}
                      onClick={() => handleDelete(rule)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Delete
                    </Button>
                  </>
                ) : (
                  <Badge className="border-white/10 bg-white/10 text-slate-300">
                    View only
                  </Badge>
                )}
              </div>
            </Card>
          ))}
        </section>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-2xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-500">
                  {editingRule ? "Edit automation" : "New automation"}
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
                  placeholder="Payment follow-up reminder"
                  required
                  type="text"
                  value={form.name}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
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
                    Action
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        actionType: event.target.value as AutomationActionType,
                      }))
                    }
                    value={form.actionType}
                  >
                    <option className="text-slate-950" value="create_reminder">
                      create reminder
                    </option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Reminder title template
                </span>
                <input
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      reminderTitle: event.target.value,
                    }))
                  }
                  placeholder="Follow up on new payment"
                  type="text"
                  value={form.reminderTitle}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Reminder description template
                </span>
                <textarea
                  className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      reminderDescription: event.target.value,
                    }))
                  }
                  placeholder="Internal follow-up generated by automation."
                  value={form.reminderDescription}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Reminder type
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        reminderType: event.target.value as ReminderType,
                      }))
                    }
                    value={form.reminderType}
                  >
                    {reminderTypes.map((type) => (
                      <option className="text-slate-950" key={type} value={type}>
                        {formatLabel(type)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Due offset days
                  </span>
                  <input
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    min="0"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        dueOffsetDays: event.target.value,
                      }))
                    }
                    type="number"
                    value={form.dueOffsetDays}
                  />
                </label>
                <label className="flex items-end gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                  <input
                    checked={form.isActive}
                    className="h-4 w-4 accent-teal-400"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        isActive: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span className="text-sm font-semibold text-white">
                    Active
                  </span>
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
