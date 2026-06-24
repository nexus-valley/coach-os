"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  addCrmLeadNote,
  createCrmFollowUpTask,
  createCrmLead,
  crmAssignedRoles,
  crmLeadSources,
  crmLeadStatuses,
  crmNoteTypes,
  crmPriorities,
  getCrmDashboardData,
  importPublicSiteLeadToCrm,
  updateCrmFollowUpTask,
  updateCrmLead,
  type CrmAssignedRole,
  type CrmDashboardData,
  type CrmFollowUpTask,
  type CrmLead,
  type CrmLeadSource,
  type CrmLeadStatus,
  type CrmNoteType,
  type CrmPriority,
} from "@/src/lib/crm";
import { canAccessCrm } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant } from "@/src/lib/tenant";

type LeadFormState = {
  assignedRole: CrmAssignedRole;
  email: string;
  name: string;
  phone: string;
  priority: CrmPriority;
  source: CrmLeadSource;
  tags: string;
};

type LeadUpdateState = {
  assignedRole: CrmAssignedRole;
  lostReason: string;
  nextFollowUpAt: string;
  priority: CrmPriority;
  status: CrmLeadStatus;
};

type NoteFormState = {
  isPrivate: boolean;
  note: string;
  noteType: CrmNoteType;
};

type TaskFormState = {
  assignedRole: CrmAssignedRole;
  description: string;
  dueAt: string;
  title: string;
};

const emptyLeadForm: LeadFormState = {
  assignedRole: "owner",
  email: "",
  name: "",
  phone: "",
  priority: "normal",
  source: "manual",
  tags: "",
};

const emptyNoteForm: NoteFormState = {
  isPrivate: false,
  note: "",
  noteType: "note",
};

const emptyTaskForm: TaskFormState = {
  assignedRole: "owner",
  description: "",
  dueAt: "",
  title: "",
};

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

function toDateTimeLocal(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 16);
}

function splitTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
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

function statusTone(status: CrmLeadStatus) {
  if (status === "converted") {
    return "success" as const;
  }

  if (status === "lost" || status === "archived") {
    return "danger" as const;
  }

  if (status === "follow_up" || status === "demo_scheduled") {
    return "warning" as const;
  }

  return "light" as const;
}

function priorityTone(priority: CrmPriority) {
  if (priority === "urgent" || priority === "high") {
    return "warning" as const;
  }

  return "light" as const;
}

function taskTone(task: CrmFollowUpTask) {
  if (task.status === "completed") {
    return "success" as const;
  }

  if (task.status === "cancelled") {
    return "danger" as const;
  }

  if (task.due_at && new Date(task.due_at).getTime() < Date.now()) {
    return "warning" as const;
  }

  return "light" as const;
}

function leadSubtitle(lead: CrmLead) {
  const parts = [lead.email, lead.phone, formatLabel(lead.source)].filter(Boolean);
  return parts.join(" | ") || "No contact details";
}

function buildLeadUpdateState(lead: CrmLead): LeadUpdateState {
  return {
    assignedRole: lead.assigned_role ?? "owner",
    lostReason: lead.lost_reason ?? "",
    nextFollowUpAt: toDateTimeLocal(lead.next_follow_up_at),
    priority: lead.priority,
    status: lead.status,
  };
}

export function CrmPage() {
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [currentTime] = useState(() => Date.now());
  const [data, setData] = useState<CrmDashboardData | null>(null);
  const [filter, setFilter] = useState<CrmLeadStatus | "all">("all");
  const [leadForm, setLeadForm] = useState<LeadFormState>(emptyLeadForm);
  const [leadUpdate, setLeadUpdate] = useState<LeadUpdateState | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteForm, setNoteForm] = useState<NoteFormState>(emptyNoteForm);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormState>(emptyTaskForm);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const initialLoadStarted = useRef(false);

  const canAccess = canAccessCrm(role);
  const isOwnerAdmin = role === "owner" || role === "admin";

  const loadCrm = useCallback(async () => {
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
        throw new Error("You must be logged in to view CRM.");
      }

      const tenant = await getCurrentTenant();

      if (!tenant) {
        throw new Error("No workspace found for this user.");
      }

      const memberRole = await getCurrentMemberRole(tenant.id, user.id);
      setRole(memberRole);
      setTenantId(tenant.id);

      if (!canAccessCrm(memberRole)) {
        setData(null);
        return;
      }

      const crmData = await getCrmDashboardData(tenant.id);
      const nextSelectedId =
        selectedLeadId && crmData.leads.some((lead) => lead.id === selectedLeadId)
          ? selectedLeadId
          : crmData.leads[0]?.id ?? null;
      const nextSelectedLead =
        crmData.leads.find((lead) => lead.id === nextSelectedId) ?? null;

      setData(crmData);
      setSelectedLeadId(nextSelectedId);
      setLeadUpdate(nextSelectedLead ? buildLeadUpdateState(nextSelectedLead) : null);
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to load CRM."));
    } finally {
      setLoading(false);
    }
  }, [selectedLeadId]);

  useEffect(() => {
    if (initialLoadStarted.current) {
      return;
    }

    initialLoadStarted.current = true;
    void Promise.resolve().then(loadCrm);
  }, [loadCrm]);

  const leads = useMemo(() => data?.leads ?? [], [data?.leads]);
  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) ?? null,
    [leads, selectedLeadId],
  );

  function handleSelectLead(lead: CrmLead) {
    setSelectedLeadId(lead.id);
    setLeadUpdate(buildLeadUpdateState(lead));
    setNoteForm(emptyNoteForm);
    setTaskForm({
      ...emptyTaskForm,
      assignedRole: lead.assigned_role ?? "owner",
    });
  }

  const filteredLeads = useMemo(() => {
    if (filter === "all") {
      return leads;
    }

    return leads.filter((lead) => lead.status === filter);
  }, [filter, leads]);

  const selectedNotes = useMemo(
    () =>
      (data?.notes ?? [])
        .filter((note) => note.lead_id === selectedLeadId)
        .sort(
          (left, right) =>
            new Date(right.created_at).getTime() -
            new Date(left.created_at).getTime(),
        ),
    [data?.notes, selectedLeadId],
  );

  const selectedTasks = useMemo(
    () =>
      (data?.followUpTasks ?? [])
        .filter((task) => task.lead_id === selectedLeadId)
        .sort(
          (left, right) =>
            new Date(right.created_at).getTime() -
            new Date(left.created_at).getTime(),
        ),
    [data?.followUpTasks, selectedLeadId],
  );

  const selectedActivity = useMemo(
    () =>
      (data?.activityLogs ?? [])
        .filter((activity) => activity.lead_id === selectedLeadId)
        .slice(0, 12),
    [data?.activityLogs, selectedLeadId],
  );

  const importedPublicLeadIds = useMemo(
    () =>
      new Set(
        leads
          .map((lead) => lead.public_site_lead_id)
          .filter((id): id is string => Boolean(id)),
      ),
    [leads],
  );

  const importablePublicLeads = useMemo(
    () =>
      (data?.publicSiteLeads ?? []).filter(
        (lead) => !importedPublicLeadIds.has(lead.id),
      ),
    [data?.publicSiteLeads, importedPublicLeadIds],
  );

  const stats = useMemo(() => {
    const tasks = data?.followUpTasks ?? [];

    return {
      converted: leads.filter((lead) => lead.status === "converted").length,
      dueFollowUps: tasks.filter(
        (task) =>
          task.status !== "completed" &&
          task.status !== "cancelled" &&
          task.due_at &&
          new Date(task.due_at).getTime() <= currentTime,
      ).length,
      lost: leads.filter((lead) => lead.status === "lost").length,
      newLeads: leads.filter((lead) => lead.status === "new").length,
      total: leads.length,
    };
  }, [currentTime, data?.followUpTasks, leads]);

  async function handleCreateLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenantId) {
      return;
    }

    setActionError(null);
    setSuccess(null);
    setCreating(true);

    try {
      const leadId = await createCrmLead({
        assignedRole: leadForm.assignedRole,
        email: leadForm.email || null,
        name: leadForm.name,
        phone: leadForm.phone || null,
        priority: leadForm.priority,
        source: leadForm.source,
        tags: splitTags(leadForm.tags),
        tenantId,
      });

      setLeadForm(emptyLeadForm);
      setSelectedLeadId(leadId);
      setSuccess("Lead created.");
      await loadCrm();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to create lead."));
    } finally {
      setCreating(false);
    }
  }

  async function handleImportPublicLead(publicSiteLeadId: string) {
    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const leadId = await importPublicSiteLeadToCrm({
        assignedRole: "owner",
        priority: "normal",
        publicSiteLeadId,
      });

      setSelectedLeadId(leadId);
      setSuccess("Public inquiry imported into CRM.");
      await loadCrm();
    } catch (error) {
      setActionError(
        getErrorMessage(error, "Unable to import public site lead."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedLead || !leadUpdate) {
      return;
    }

    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await updateCrmLead({
        assignedRole: isOwnerAdmin ? leadUpdate.assignedRole : null,
        leadId: selectedLead.id,
        lostReason: leadUpdate.lostReason || null,
        nextFollowUpAt: leadUpdate.nextFollowUpAt || null,
        priority: leadUpdate.priority,
        status: leadUpdate.status,
      });

      setSuccess("Lead updated.");
      await loadCrm();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to update lead."));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedLead) {
      return;
    }

    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await addCrmLeadNote({
        isPrivate: noteForm.isPrivate,
        leadId: selectedLead.id,
        note: noteForm.note,
        noteType: noteForm.noteType,
      });

      setNoteForm(emptyNoteForm);
      setSuccess("Note added.");
      await loadCrm();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to add CRM note."));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedLead) {
      return;
    }

    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await createCrmFollowUpTask({
        assignedRole: taskForm.assignedRole,
        description: taskForm.description || null,
        dueAt: taskForm.dueAt || null,
        leadId: selectedLead.id,
        title: taskForm.title,
      });

      setTaskForm({
        ...emptyTaskForm,
        assignedRole: selectedLead.assigned_role ?? "owner",
      });
      setSuccess("Follow-up task created.");
      await loadCrm();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to create follow-up."));
    } finally {
      setSaving(false);
    }
  }

  async function handleTaskStatus(task: CrmFollowUpTask, status: CrmFollowUpTask["status"]) {
    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await updateCrmFollowUpTask({
        status,
        taskId: task.id,
      });

      setSuccess("Follow-up updated.");
      await loadCrm();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to update follow-up."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <span className="sr-only">Loading CRM</span>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#9ADDEA] border-t-[#145DA0]" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <AccessDeniedCard description="CRM access is available to workspace team members only." />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Badge tone="light">CRM foundation</Badge>
          <h1 className="mt-3 text-3xl font-semibold text-[#0B2A3D]">
            CRM & Leads
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-[#425B76]">
            Manage enquiries, ownership, follow-ups, notes, and pipeline status
            without converting leads into students automatically.
          </p>
        </div>
        <Button onClick={loadCrm} type="button" variant="secondary">
          Refresh
        </Button>
      </div>

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total leads", stats.total],
          ["New", stats.newLeads],
          ["Follow-ups due", stats.dueFollowUps],
          ["Converted", stats.converted],
          ["Lost", stats.lost],
        ].map(([label, value]) => (
          <Card className="p-5" key={label}>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5D7185]">
              {label}
            </p>
            <p className="mt-3 text-3xl font-semibold text-[#0B2A3D]">
              {value}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.45fr)]">
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#0B2A3D]">
                  Lead pipeline
                </h2>
                <p className="text-sm text-[#5D7185]">
                  {filteredLeads.length} visible lead
                  {filteredLeads.length === 1 ? "" : "s"}
                </p>
              </div>
              <select
                className="rounded-2xl border border-[#D8E8F0] bg-white px-3 py-2 text-sm"
                onChange={(event) =>
                  setFilter(event.target.value as CrmLeadStatus | "all")
                }
                value={filter}
              >
                <option value="all">All</option>
                {crmLeadStatuses.map((status) => (
                  <option key={status} value={status}>
                    {formatLabel(status)}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-5 space-y-3">
              {filteredLeads.length ? (
                filteredLeads.map((lead) => (
                  <button
                    className={[
                      "w-full rounded-2xl border p-4 text-left transition",
                      lead.id === selectedLeadId
                        ? "border-[#145DA0] bg-[#EAF8FC]"
                        : "border-[#D8E8F0] bg-white hover:border-[#9ADDEA]",
                    ].join(" ")}
                    key={lead.id}
                    onClick={() => handleSelectLead(lead)}
                    type="button"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="mr-auto font-semibold text-[#0B2A3D]">
                        {lead.name}
                      </p>
                      <Badge tone={statusTone(lead.status)}>
                        {formatLabel(lead.status)}
                      </Badge>
                      <Badge tone={priorityTone(lead.priority)}>
                        {formatLabel(lead.priority)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-[#5D7185]">
                      {leadSubtitle(lead)}
                    </p>
                    <p className="mt-2 text-xs text-[#7B8EA3]">
                      Assigned{" "}
                      {lead.assigned_to
                        ? "to user"
                        : lead.assigned_role
                          ? `to ${lead.assigned_role}`
                          : "by workspace default"}
                    </p>
                  </button>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-[#D8E8F0] p-5 text-sm text-[#5D7185]">
                  <p className="font-semibold text-[#0B2A3D]">
                    No leads in this view
                  </p>
                  <p className="mt-1">
                    Create a manual lead or import a public inquiry to start the
                    CRM pipeline.
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-[#0B2A3D]">
              Create manual lead
            </h2>
            <form className="mt-5 space-y-4" onSubmit={handleCreateLead}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-[#0B2A3D]">
                  Name
                  <input
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    maxLength={180}
                    onChange={(event) =>
                      setLeadForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    required
                    value={leadForm.name}
                  />
                </label>
                <label className="text-sm font-semibold text-[#0B2A3D]">
                  Source
                  <select
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    onChange={(event) =>
                      setLeadForm((current) => ({
                        ...current,
                        source: event.target.value as CrmLeadSource,
                      }))
                    }
                    value={leadForm.source}
                  >
                    {crmLeadSources
                      .filter((source) => source !== "public_site")
                      .map((source) => (
                        <option key={source} value={source}>
                          {formatLabel(source)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-[#0B2A3D]">
                  Email
                  <input
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    maxLength={254}
                    onChange={(event) =>
                      setLeadForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    type="email"
                    value={leadForm.email}
                  />
                </label>
                <label className="text-sm font-semibold text-[#0B2A3D]">
                  Phone
                  <input
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    maxLength={30}
                    onChange={(event) =>
                      setLeadForm((current) => ({
                        ...current,
                        phone: event.target.value,
                      }))
                    }
                    value={leadForm.phone}
                  />
                </label>
                <label className="text-sm font-semibold text-[#0B2A3D]">
                  Priority
                  <select
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    onChange={(event) =>
                      setLeadForm((current) => ({
                        ...current,
                        priority: event.target.value as CrmPriority,
                      }))
                    }
                    value={leadForm.priority}
                  >
                    {crmPriorities.map((priority) => (
                      <option key={priority} value={priority}>
                        {formatLabel(priority)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-[#0B2A3D]">
                  Assign role
                  <select
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    onChange={(event) =>
                      setLeadForm((current) => ({
                        ...current,
                        assignedRole: event.target.value as CrmAssignedRole,
                      }))
                    }
                    value={leadForm.assignedRole}
                  >
                    {crmAssignedRoles.map((assignedRole) => (
                      <option key={assignedRole} value={assignedRole}>
                        {formatLabel(assignedRole)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm font-semibold text-[#0B2A3D]">
                Tags
                <input
                  className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                  onChange={(event) =>
                    setLeadForm((current) => ({
                      ...current,
                      tags: event.target.value,
                    }))
                  }
                  placeholder="demo, urgent"
                  value={leadForm.tags}
                />
              </label>
              <Button disabled={creating} type="submit">
                {creating ? "Creating..." : "Create Lead"}
              </Button>
            </form>
          </Card>

          {isOwnerAdmin ? (
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-[#0B2A3D]">
                Public inquiries
              </h2>
              <p className="mt-1 text-sm text-[#5D7185]">
                Import raw public site enquiries into the internal CRM pipeline.
              </p>
              <div className="mt-5 space-y-3">
                {importablePublicLeads.length ? (
                  importablePublicLeads.map((lead) => (
                    <div
                      className="rounded-2xl border border-[#D8E8F0] p-4"
                      key={lead.id}
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="mr-auto">
                          <p className="font-semibold text-[#0B2A3D]">
                            {lead.name}
                          </p>
                          <p className="text-sm text-[#5D7185]">
                            {[lead.email, lead.phone].filter(Boolean).join(" | ")}
                          </p>
                        </div>
                        <Button
                          disabled={saving}
                          onClick={() => void handleImportPublicLead(lead.id)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Import
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
                    No new public inquiries are waiting for CRM import.
                  </p>
                )}
              </div>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {selectedLead && leadUpdate ? (
            <>
              <Card className="p-6">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="mr-auto">
                    <p className="text-sm font-semibold text-[#5D7185]">
                      Lead detail
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold text-[#0B2A3D]">
                      {selectedLead.name}
                    </h2>
                    <p className="mt-2 text-sm text-[#5D7185]">
                      {leadSubtitle(selectedLead)}
                    </p>
                  </div>
                  <Badge tone={statusTone(selectedLead.status)}>
                    {formatLabel(selectedLead.status)}
                  </Badge>
                  <Badge tone={priorityTone(selectedLead.priority)}>
                    {formatLabel(selectedLead.priority)}
                  </Badge>
                </div>

                <form className="mt-6 space-y-4" onSubmit={handleUpdateLead}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm font-semibold text-[#0B2A3D]">
                      Status
                      <select
                        className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                        onChange={(event) =>
                          setLeadUpdate((current) =>
                            current
                              ? {
                                  ...current,
                                  status: event.target.value as CrmLeadStatus,
                                }
                              : current,
                          )
                        }
                        value={leadUpdate.status}
                      >
                        {crmLeadStatuses
                          .filter(
                            (status) =>
                              isOwnerAdmin ||
                              !["converted", "lost", "archived"].includes(status),
                          )
                          .map((status) => (
                            <option key={status} value={status}>
                              {formatLabel(status)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-[#0B2A3D]">
                      Priority
                      <select
                        className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                        onChange={(event) =>
                          setLeadUpdate((current) =>
                            current
                              ? {
                                  ...current,
                                  priority: event.target.value as CrmPriority,
                                }
                              : current,
                          )
                        }
                        value={leadUpdate.priority}
                      >
                        {crmPriorities.map((priority) => (
                          <option key={priority} value={priority}>
                            {formatLabel(priority)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {isOwnerAdmin ? (
                      <label className="text-sm font-semibold text-[#0B2A3D]">
                        Assigned role
                        <select
                          className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                          onChange={(event) =>
                            setLeadUpdate((current) =>
                              current
                                ? {
                                    ...current,
                                    assignedRole: event.target
                                      .value as CrmAssignedRole,
                                  }
                                : current,
                            )
                          }
                          value={leadUpdate.assignedRole}
                        >
                          {crmAssignedRoles.map((assignedRole) => (
                            <option key={assignedRole} value={assignedRole}>
                              {formatLabel(assignedRole)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label className="text-sm font-semibold text-[#0B2A3D]">
                      Next follow-up
                      <input
                        className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                        onChange={(event) =>
                          setLeadUpdate((current) =>
                            current
                              ? {
                                  ...current,
                                  nextFollowUpAt: event.target.value,
                                }
                              : current,
                          )
                        }
                        type="datetime-local"
                        value={leadUpdate.nextFollowUpAt}
                      />
                    </label>
                  </div>
                  {leadUpdate.status === "lost" && isOwnerAdmin ? (
                    <label className="block text-sm font-semibold text-[#0B2A3D]">
                      Lost reason
                      <textarea
                        className="mt-2 min-h-24 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                        maxLength={500}
                        onChange={(event) =>
                          setLeadUpdate((current) =>
                            current
                              ? { ...current, lostReason: event.target.value }
                              : current,
                          )
                        }
                        value={leadUpdate.lostReason}
                      />
                    </label>
                  ) : null}
                  <Button disabled={saving} type="submit">
                    {saving ? "Saving..." : "Update Lead"}
                  </Button>
                </form>
              </Card>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="p-6">
                  <h3 className="text-lg font-semibold text-[#0B2A3D]">Notes</h3>
                  <form className="mt-4 space-y-3" onSubmit={handleAddNote}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <select
                        className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                        onChange={(event) =>
                          setNoteForm((current) => ({
                            ...current,
                            noteType: event.target.value as CrmNoteType,
                          }))
                        }
                        value={noteForm.noteType}
                      >
                        {crmNoteTypes.map((noteType) => (
                          <option key={noteType} value={noteType}>
                            {formatLabel(noteType)}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2 rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm font-semibold text-[#0B2A3D]">
                        <input
                          checked={noteForm.isPrivate}
                          onChange={(event) =>
                            setNoteForm((current) => ({
                              ...current,
                              isPrivate: event.target.checked,
                            }))
                          }
                          type="checkbox"
                        />
                        Private
                      </label>
                    </div>
                    <textarea
                      className="min-h-28 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                      maxLength={2000}
                      onChange={(event) =>
                        setNoteForm((current) => ({
                          ...current,
                          note: event.target.value,
                        }))
                      }
                      placeholder="Add follow-up context"
                      required
                      value={noteForm.note}
                    />
                    <Button disabled={saving} size="sm" type="submit">
                      Add Note
                    </Button>
                  </form>

                  <div className="mt-5 space-y-3">
                    {selectedNotes.length ? (
                      selectedNotes.map((note) => (
                        <div
                          className="rounded-2xl border border-[#D8E8F0] p-4"
                          key={note.id}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="light">{formatLabel(note.note_type)}</Badge>
                            {note.is_private ? (
                              <Badge tone="warning">Private</Badge>
                            ) : null}
                            <span className="ml-auto text-xs text-[#7B8EA3]">
                              {formatDate(note.created_at)}
                            </span>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap text-sm text-[#425B76]">
                            {note.note}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
                        No notes yet.
                      </p>
                    )}
                  </div>
                </Card>

                <Card className="p-6">
                  <h3 className="text-lg font-semibold text-[#0B2A3D]">
                    Follow-up tasks
                  </h3>
                  <form className="mt-4 space-y-3" onSubmit={handleCreateTask}>
                    <input
                      className="w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                      maxLength={180}
                      onChange={(event) =>
                        setTaskForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      placeholder="Task title"
                      required
                      value={taskForm.title}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <select
                        className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                        onChange={(event) =>
                          setTaskForm((current) => ({
                            ...current,
                            assignedRole: event.target.value as CrmAssignedRole,
                          }))
                        }
                        value={taskForm.assignedRole}
                      >
                        {crmAssignedRoles.map((assignedRole) => (
                          <option key={assignedRole} value={assignedRole}>
                            {formatLabel(assignedRole)}
                          </option>
                        ))}
                      </select>
                      <input
                        className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                        onChange={(event) =>
                          setTaskForm((current) => ({
                            ...current,
                            dueAt: event.target.value,
                          }))
                        }
                        type="datetime-local"
                        value={taskForm.dueAt}
                      />
                    </div>
                    <textarea
                      className="min-h-24 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                      maxLength={1200}
                      onChange={(event) =>
                        setTaskForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      placeholder="Description"
                      value={taskForm.description}
                    />
                    <Button disabled={saving} size="sm" type="submit">
                      Create Follow-up
                    </Button>
                  </form>

                  <div className="mt-5 space-y-3">
                    {selectedTasks.length ? (
                      selectedTasks.map((task) => (
                        <div
                          className="rounded-2xl border border-[#D8E8F0] p-4"
                          key={task.id}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="mr-auto font-semibold text-[#0B2A3D]">
                              {task.title}
                            </p>
                            <Badge tone={taskTone(task)}>
                              {formatLabel(task.status)}
                            </Badge>
                          </div>
                          {task.description ? (
                            <p className="mt-2 text-sm text-[#5D7185]">
                              {task.description}
                            </p>
                          ) : null}
                          <p className="mt-2 text-xs text-[#7B8EA3]">
                            Due {formatDate(task.due_at)} | Assigned{" "}
                            {task.assigned_to
                              ? "to user"
                              : task.assigned_role
                                ? `to ${task.assigned_role}`
                                : "by lead assignment"}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {task.status !== "completed" ? (
                              <Button
                                disabled={saving}
                                onClick={() =>
                                  void handleTaskStatus(task, "completed")
                                }
                                size="sm"
                                type="button"
                                variant="secondary"
                              >
                                Complete
                              </Button>
                            ) : null}
                            {task.status !== "cancelled" ? (
                              <Button
                                disabled={saving}
                                onClick={() =>
                                  void handleTaskStatus(task, "cancelled")
                                }
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                Cancel
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
                        No follow-up tasks yet.
                      </p>
                    )}
                  </div>
                </Card>
              </div>

              <Card className="p-6">
                <h3 className="text-lg font-semibold text-[#0B2A3D]">
                  Lead activity
                </h3>
                <div className="mt-4 space-y-3">
                  {selectedActivity.length ? (
                    selectedActivity.map((activity) => (
                      <div
                        className="flex flex-col gap-1 rounded-2xl border border-[#D8E8F0] p-4 sm:flex-row sm:items-center sm:justify-between"
                        key={activity.id}
                      >
                        <p className="font-semibold text-[#0B2A3D]">
                          {formatLabel(activity.action)}
                        </p>
                        <p className="text-sm text-[#5D7185]">
                          {formatDate(activity.created_at)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
                      Activity will appear after CRM actions are performed.
                    </p>
                  )}
                </div>
              </Card>
            </>
          ) : (
            <Card className="p-6">
              <div className="rounded-2xl border border-dashed border-[#D8E8F0] p-8 text-center">
                <p className="text-lg font-semibold text-[#0B2A3D]">
                  No lead selected
                </p>
                <p className="mt-2 text-sm text-[#5D7185]">
                  Select a lead from the pipeline or create one to manage notes,
                  follow-ups, and status.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
