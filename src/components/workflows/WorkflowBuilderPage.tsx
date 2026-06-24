"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { canAccessWorkflows, canManageWorkflows } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant } from "@/src/lib/tenant";
import {
  archiveWorkflowTemplate,
  createWorkflowTemplate,
  getWorkflowDashboardData,
  startWorkflowRun,
  updateWorkflowRunStep,
  updateWorkflowTemplate,
  type WorkflowAssigneeRole,
  type WorkflowDashboardData,
  type WorkflowRun,
  type WorkflowStepPayload,
  type WorkflowStepStatus,
  type WorkflowStepType,
  type WorkflowTemplate,
  type WorkflowTemplateStatus,
} from "@/src/lib/workflows";

type WorkflowFormState = {
  category: string;
  description: string;
  name: string;
  status: Exclude<WorkflowTemplateStatus, "archived">;
  steps: StepDraft[];
};

type StepDraft = {
  default_assignee_role: WorkflowAssigneeRole | "";
  description: string;
  is_required: boolean;
  localId: string;
  step_type: WorkflowStepType;
  title: string;
};

const emptyStep = (): StepDraft => ({
  default_assignee_role: "staff",
  description: "",
  is_required: true,
  localId: crypto.randomUUID(),
  step_type: "manual_task",
  title: "",
});

const emptyForm = (): WorkflowFormState => ({
  category: "",
  description: "",
  name: "",
  status: "draft",
  steps: [emptyStep()],
});

const sampleTemplates: WorkflowFormState[] = [
  {
    category: "Student Operations",
    description:
      "A guided intake process for new students before their first session.",
    name: "Student Onboarding",
    status: "draft",
    steps: [
      {
        ...emptyStep(),
        default_assignee_role: "staff",
        description: "Confirm student profile, contact details, and enrollment.",
        title: "Verify student intake details",
      },
      {
        ...emptyStep(),
        default_assignee_role: "trainer",
        description: "Review learning goals and initial class plan.",
        title: "Review learning goals",
      },
      {
        ...emptyStep(),
        default_assignee_role: "admin",
        description: "Confirm fee plan, receipt expectations, and support contact.",
        title: "Confirm payment and welcome information",
      },
    ],
  },
  {
    category: "Academic Delivery",
    description:
      "Checklist for preparing and publishing a new course or cohort launch.",
    name: "Course Launch Checklist",
    status: "draft",
    steps: [
      {
        ...emptyStep(),
        default_assignee_role: "admin",
        title: "Confirm course details",
      },
      {
        ...emptyStep(),
        default_assignee_role: "trainer",
        title: "Prepare session plan",
      },
      {
        ...emptyStep(),
        default_assignee_role: "staff",
        title: "Notify enrolled students",
      },
    ],
  },
  {
    category: "Finance",
    description: "Human-controlled follow-up process for pending fees.",
    name: "Payment Follow-up",
    status: "draft",
    steps: [
      {
        ...emptyStep(),
        default_assignee_role: "staff",
        title: "Review pending balance",
      },
      {
        ...emptyStep(),
        default_assignee_role: "admin",
        step_type: "approval_gate",
        title: "Approve follow-up message",
      },
    ],
  },
];

const stepTypes: WorkflowStepType[] = [
  "manual_task",
  "checklist",
  "approval_gate",
  "reference",
];
const assigneeRoles: WorkflowAssigneeRole[] = [
  "owner",
  "admin",
  "staff",
  "trainer",
];
const stepStatuses: WorkflowStepStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "skipped",
  "blocked",
];

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return fallback;
}

function statusTone(
  status: WorkflowRun["status"] | WorkflowStepStatus | WorkflowTemplateStatus,
) {
  if (status === "active" || status === "completed") {
    return "success" as const;
  }

  if (status === "archived" || status === "cancelled" || status === "blocked") {
    return "danger" as const;
  }

  if (status === "draft" || status === "skipped") {
    return "warning" as const;
  }

  return "light" as const;
}

function formFromTemplate(template: WorkflowTemplate): WorkflowFormState {
  return {
    category: template.category ?? "",
    description: template.description ?? "",
    name: template.name,
    status: template.status === "archived" ? "draft" : template.status,
    steps: template.steps.map((step) => ({
      default_assignee_role: step.default_assignee_role ?? "",
      description: step.description ?? "",
      is_required: step.is_required,
      localId: step.id,
      step_type: step.step_type,
      title: step.title,
    })),
  };
}

function payloadSteps(steps: StepDraft[]): WorkflowStepPayload[] {
  return steps.map((step, index) => ({
    default_assignee_role: step.default_assignee_role || null,
    description: step.description,
    is_required: step.is_required,
    metadata_json: {},
    step_order: index + 1,
    step_type: step.step_type,
    title: step.title,
  }));
}

export function WorkflowBuilderPage() {
  const [actionError, setActionError] = useState<string | null>(null);
  const [data, setData] = useState<WorkflowDashboardData | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [form, setForm] = useState<WorkflowFormState>(() => emptyForm());
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [runNames, setRunNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [stepNotes, setStepNotes] = useState<Record<string, string>>({});
  const [stepStatus, setStepStatus] = useState<Record<string, WorkflowStepStatus>>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const initialLoadStarted = useRef(false);

  const canAccess = canAccessWorkflows(role);
  const canManage = canManageWorkflows(role);

  const loadWorkflows = useCallback(async () => {
    setActionError(null);
    setLoading(true);

    try {
      const supabase = getSupabaseClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error("You must be logged in to view workflows.");
      }

      const tenant = await getCurrentTenant();

      if (!tenant) {
        throw new Error("No workspace found for this user.");
      }

      const memberRole = await getCurrentMemberRole(tenant.id, user.id);
      setRole(memberRole);
      setTenantId(tenant.id);

      if (!canAccessWorkflows(memberRole)) {
        setData(null);
        return;
      }

      const dashboardData = await getWorkflowDashboardData(tenant.id);
      setData(dashboardData);

      const initialNotes: Record<string, string> = {};
      const initialStatus: Record<string, WorkflowStepStatus> = {};
      for (const step of dashboardData.runSteps) {
        initialNotes[step.id] = step.notes ?? "";
        initialStatus[step.id] = step.status;
      }
      setStepNotes(initialNotes);
      setStepStatus(initialStatus);
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to load workflows."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialLoadStarted.current) {
      return;
    }

    initialLoadStarted.current = true;
    void Promise.resolve().then(loadWorkflows);
  }, [loadWorkflows]);

  const stats = useMemo(() => {
    const templates = data?.templates ?? [];
    const runs = data?.runs ?? [];
    const tasks = data?.runSteps ?? [];

    return {
      activeTemplates: templates.filter((template) => template.status === "active")
        .length,
      assignedOpenTasks: tasks.filter(
        (step) => step.status !== "completed" && step.status !== "skipped",
      ).length,
      completedRuns: runs.filter((run) => run.status === "completed").length,
      totalRuns: runs.length,
      totalTemplates: templates.length,
    };
  }, [data]);

  function resetForm() {
    setEditingTemplateId(null);
    setForm(emptyForm());
    setFormOpen(false);
  }

  function openCreateForm(template?: WorkflowFormState) {
    setEditingTemplateId(null);
    setForm(template ? { ...template, steps: template.steps.map((step) => ({ ...step, localId: crypto.randomUUID() })) } : emptyForm());
    setFormOpen(true);
    setActionError(null);
    setSuccess(null);
  }

  function openEditForm(template: WorkflowTemplate) {
    setEditingTemplateId(template.id);
    setForm(formFromTemplate(template));
    setFormOpen(true);
    setActionError(null);
    setSuccess(null);
  }

  function updateStep(localId: string, patch: Partial<StepDraft>) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.localId === localId ? { ...step, ...patch } : step,
      ),
    }));
  }

  function removeStep(localId: string) {
    setForm((current) => ({
      ...current,
      steps:
        current.steps.length > 1
          ? current.steps.filter((step) => step.localId !== localId)
          : current.steps,
    }));
  }

  async function handleSaveTemplate() {
    if (!tenantId || !canManage) {
      return;
    }

    setSaving(true);
    setActionError(null);
    setSuccess(null);

    try {
      const steps = payloadSteps(form.steps);

      if (editingTemplateId) {
        await updateWorkflowTemplate({
          category: form.category,
          description: form.description,
          name: form.name,
          status: form.status,
          steps,
          templateId: editingTemplateId,
        });
        setSuccess("Workflow template updated.");
      } else {
        await createWorkflowTemplate({
          category: form.category,
          description: form.description,
          name: form.name,
          status: form.status,
          steps,
          tenantId,
        });
        setSuccess("Workflow template created.");
      }

      resetForm();
      await loadWorkflows();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to save workflow template."));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveTemplate(templateId: string) {
    setSaving(true);
    setActionError(null);
    setSuccess(null);

    try {
      await archiveWorkflowTemplate(templateId);
      setSuccess("Workflow template archived.");
      await loadWorkflows();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to archive workflow template."));
    } finally {
      setSaving(false);
    }
  }

  async function handleStartRun(template: WorkflowTemplate) {
    setSaving(true);
    setActionError(null);
    setSuccess(null);

    try {
      await startWorkflowRun({
        name: runNames[template.id] || template.name,
        templateId: template.id,
      });
      setRunNames((current) => ({ ...current, [template.id]: "" }));
      setSuccess("Workflow run started.");
      await loadWorkflows();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to start workflow run."));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateStep(stepId: string) {
    setSaving(true);
    setActionError(null);
    setSuccess(null);

    try {
      await updateWorkflowRunStep({
        notes: stepNotes[stepId] ?? "",
        status: stepStatus[stepId] ?? "pending",
        stepId,
      });
      setSuccess("Workflow task updated.");
      await loadWorkflows();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to update workflow task."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card className="p-8">
        <p className="text-sm text-[#5D7185]">Loading workflows...</p>
      </Card>
    );
  }

  if (!canAccess) {
    return (
      <AccessDeniedCard description="Workflow Builder is available to team users only. Students and external users cannot access internal workflow processes." />
    );
  }

  const templates = data?.templates ?? [];
  const runs = data?.runs ?? [];
  const tasks = data?.runSteps ?? [];
  const visibleTasks = canManage
    ? tasks
    : tasks.filter((step) => step.status !== "completed" && step.status !== "skipped");

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-3xl border border-[#D8E8F0] bg-white p-6 shadow-xl shadow-[#0B2A3D]/10 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-[#0B1F33]">
              Workflow Builder
            </h1>
            <Badge tone={canManage ? "owner" : "staff"}>
              {canManage ? "template management" : "assigned tasks"}
            </Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5D7185]">
            Build structured, human-controlled processes for onboarding,
            course launches, payment follow-up, assignment review, and
            certificate issuance. Workflows track checklist progress only; they
            do not mutate business records automatically.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => openCreateForm()} type="button">
            Create workflow
          </Button>
        ) : null}
      </section>

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["Templates", stats.totalTemplates],
          ["Active", stats.activeTemplates],
          ["Runs", stats.totalRuns],
          ["Completed", stats.completedRuns],
          ["Open tasks", stats.assignedOpenTasks],
        ].map(([label, value]) => (
          <Card className="rounded-2xl p-5" key={label}>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5D7185]">
              {label}
            </p>
            <p className="mt-3 text-3xl font-bold text-[#0B1F33]">{value}</p>
          </Card>
        ))}
      </section>

      {canManage ? (
        <section className="grid gap-4 lg:grid-cols-3">
          {sampleTemplates.map((template) => (
            <Card className="rounded-2xl p-5" key={template.name}>
              <Badge tone="light">{template.category}</Badge>
              <h2 className="mt-4 text-lg font-semibold text-[#0B1F33]">
                {template.name}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#5D7185]">
                {template.description}
              </p>
              <Button
                className="mt-5"
                onClick={() => openCreateForm(template)}
                size="sm"
                type="button"
                variant="secondary"
              >
                Use sample
              </Button>
            </Card>
          ))}
        </section>
      ) : null}

      {formOpen && canManage ? (
        <Card className="rounded-2xl p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-[#0B1F33]">
                {editingTemplateId ? "Edit workflow template" : "New workflow template"}
              </h2>
              <p className="mt-1 text-sm text-[#5D7185]">
                Define manual steps. No step will execute product actions.
              </p>
            </div>
            <Button onClick={resetForm} type="button" variant="ghost">
              Close
            </Button>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <label className="block text-sm font-semibold text-[#0B2A3D]">
              Name
              <input
                className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                maxLength={160}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                value={form.name}
              />
            </label>
            <label className="block text-sm font-semibold text-[#0B2A3D]">
              Category
              <input
                className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                maxLength={80}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                value={form.category}
              />
            </label>
            <label className="block text-sm font-semibold text-[#0B2A3D]">
              Status
              <select
                className="mt-2 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as Exclude<
                      WorkflowTemplateStatus,
                      "archived"
                    >,
                  }))
                }
                value={form.status}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
              </select>
            </label>
            <label className="block text-sm font-semibold text-[#0B2A3D] lg:col-span-2">
              Description
              <textarea
                className="mt-2 min-h-24 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                maxLength={1200}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                value={form.description}
              />
            </label>
          </div>

          <div className="mt-6 space-y-4">
            {form.steps.map((step, index) => (
              <div
                className="rounded-2xl border border-[#D8E8F0] bg-[#F8FCFE] p-4"
                key={step.localId}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Badge tone="light">Step {index + 1}</Badge>
                  <Button
                    disabled={form.steps.length === 1}
                    onClick={() => removeStep(step.localId)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <label className="block text-sm font-semibold text-[#0B2A3D]">
                    Step title
                    <input
                      className="mt-2 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                      maxLength={160}
                      onChange={(event) =>
                        updateStep(step.localId, { title: event.target.value })
                      }
                      value={step.title}
                    />
                  </label>
                  <label className="block text-sm font-semibold text-[#0B2A3D]">
                    Step type
                    <select
                      className="mt-2 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                      onChange={(event) =>
                        updateStep(step.localId, {
                          step_type: event.target.value as WorkflowStepType,
                        })
                      }
                      value={step.step_type}
                    >
                      {stepTypes.map((type) => (
                        <option key={type} value={type}>
                          {formatLabel(type)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-[#0B2A3D]">
                    Default assignee role
                    <select
                      className="mt-2 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                      onChange={(event) =>
                        updateStep(step.localId, {
                          default_assignee_role: event.target
                            .value as WorkflowAssigneeRole,
                        })
                      }
                      value={step.default_assignee_role}
                    >
                      {assigneeRoles.map((assigneeRole) => (
                        <option key={assigneeRole} value={assigneeRole}>
                          {assigneeRole}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-3 pt-8 text-sm font-semibold text-[#0B2A3D]">
                    <input
                      checked={step.is_required}
                      onChange={(event) =>
                        updateStep(step.localId, {
                          is_required: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    Required step
                  </label>
                  <label className="block text-sm font-semibold text-[#0B2A3D] lg:col-span-2">
                    Step description
                    <textarea
                      className="mt-2 min-h-20 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                      maxLength={1200}
                      onChange={(event) =>
                        updateStep(step.localId, {
                          description: event.target.value,
                        })
                      }
                      value={step.description}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
            <Button
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  steps: [...current.steps, emptyStep()],
                }))
              }
              type="button"
              variant="secondary"
            >
              Add step
            </Button>
            <Button disabled={saving} onClick={handleSaveTemplate} type="button">
              {saving ? "Saving..." : "Save workflow"}
            </Button>
          </div>
        </Card>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-2xl p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-[#0B1F33]">
                Workflow templates
              </h2>
              <p className="mt-1 text-sm text-[#5D7185]">
                Owner/admin managed templates. Staff and trainers see templates
                only when related to visible runs.
              </p>
            </div>
          </div>

          {templates.length ? (
            <div className="mt-5 space-y-4">
              {templates.map((template) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-white p-4"
                  key={template.id}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-[#0B1F33]">
                          {template.name}
                        </h3>
                        <Badge tone={statusTone(template.status)}>
                          {template.status}
                        </Badge>
                        {template.category ? (
                          <Badge tone="light">{template.category}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[#5D7185]">
                        {template.description || "No description provided."}
                      </p>
                      <p className="mt-2 text-xs font-semibold text-[#5D7185]">
                        {template.steps.length} step
                        {template.steps.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    {canManage ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => openEditForm(template)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Edit
                        </Button>
                        <Button
                          disabled={saving || template.status === "archived"}
                          onClick={() => handleArchiveTemplate(template.id)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Archive
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {canManage && template.status === "active" ? (
                    <div className="mt-4 flex flex-col gap-3 border-t border-[#D8E8F0] pt-4 sm:flex-row">
                      <input
                        className="min-w-0 flex-1 rounded-2xl border border-[#D8E8F0] px-4 py-2 text-sm outline-none focus:border-[#2ECBEA]"
                        onChange={(event) =>
                          setRunNames((current) => ({
                            ...current,
                            [template.id]: event.target.value,
                          }))
                        }
                        placeholder="Optional run name"
                        value={runNames[template.id] ?? ""}
                      />
                      <Button
                        disabled={saving}
                        onClick={() => handleStartRun(template)}
                        size="sm"
                        type="button"
                      >
                        Start run
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              action={
                canManage
                  ? {
                      label: "Create workflow",
                      onClick: () => openCreateForm(),
                    }
                  : undefined
              }
              description="No workflow templates are visible yet."
              icon="WF"
              title="No workflows yet"
            />
          )}
        </Card>

        <Card className="rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-[#0B1F33]">
            Assigned tasks
          </h2>
          <p className="mt-1 text-sm text-[#5D7185]">
            Staff and trainers can update only visible assigned workflow steps.
          </p>

          {visibleTasks.length ? (
            <div className="mt-5 space-y-4">
              {visibleTasks.slice(0, 12).map((step) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-[#F8FCFE] p-4"
                  key={step.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={statusTone(step.status)}>{step.status}</Badge>
                    {step.assigned_role ? (
                      <Badge tone="light">{step.assigned_role}</Badge>
                    ) : null}
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-[#0B1F33]">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-[#5D7185]">
                    {step.description || "No instructions provided."}
                  </p>
                  <div className="mt-4 grid gap-3">
                    <select
                      className="rounded-2xl border border-[#D8E8F0] bg-white px-3 py-2 text-sm outline-none focus:border-[#2ECBEA]"
                      onChange={(event) =>
                        setStepStatus((current) => ({
                          ...current,
                          [step.id]: event.target.value as WorkflowStepStatus,
                        }))
                      }
                      value={stepStatus[step.id] ?? step.status}
                    >
                      {stepStatuses.map((status) => (
                        <option key={status} value={status}>
                          {formatLabel(status)}
                        </option>
                      ))}
                    </select>
                    <textarea
                      className="min-h-20 rounded-2xl border border-[#D8E8F0] bg-white px-3 py-2 text-sm outline-none focus:border-[#2ECBEA]"
                      maxLength={2000}
                      onChange={(event) =>
                        setStepNotes((current) => ({
                          ...current,
                          [step.id]: event.target.value,
                        }))
                      }
                      placeholder="Notes"
                      value={stepNotes[step.id] ?? ""}
                    />
                    <Button
                      disabled={saving}
                      onClick={() => handleUpdateStep(step.id)}
                      size="sm"
                      type="button"
                    >
                      Update task
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-[#BFDDE8] bg-[#F8FCFE] p-6 text-sm text-[#5D7185]">
              No assigned workflow tasks are open.
            </div>
          )}
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-[#0B1F33]">Recent runs</h2>
          {runs.length ? (
            <div className="mt-5 space-y-3">
              {runs.slice(0, 10).map((run) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-white p-4"
                  key={run.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#0B1F33]">
                        {run.name}
                      </h3>
                      <p className="mt-1 text-xs text-[#5D7185]">
                        Started {formatDate(run.started_at)}
                      </p>
                    </div>
                    <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#E5EEF4]">
                    <div
                      className="h-full rounded-full bg-[#145DA0]"
                      style={{
                        width: `${
                          run.steps.length
                            ? (run.steps.filter((step) =>
                                ["completed", "skipped"].includes(step.status),
                              ).length /
                                run.steps.length) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-[#BFDDE8] bg-[#F8FCFE] p-6 text-sm text-[#5D7185]">
              No workflow runs have been started.
            </div>
          )}
        </Card>

        <Card className="rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-[#0B1F33]">
            Workflow activity
          </h2>
          {data?.activityLogs.length ? (
            <div className="mt-5 space-y-3">
              {data.activityLogs.slice(0, 10).map((activity) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-white p-4"
                  key={activity.id}
                >
                  <p className="text-sm font-semibold text-[#0B1F33]">
                    {formatLabel(activity.action)}
                  </p>
                  <p className="mt-1 text-xs text-[#5D7185]">
                    {formatDate(activity.created_at)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-[#BFDDE8] bg-[#F8FCFE] p-6 text-sm text-[#5D7185]">
              Workflow activity will appear after templates, runs, or tasks are
              updated.
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
