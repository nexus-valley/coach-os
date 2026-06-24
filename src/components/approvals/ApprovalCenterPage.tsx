"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  approvalAssignedRoles,
  approvalPriorities,
  approvalTypes,
  cancelApprovalRequest,
  createApprovalRequest,
  decideApprovalRequest,
  getApprovalDashboardData,
  type ApprovalAssignedRole,
  type ApprovalDashboardData,
  type ApprovalPriority,
  type ApprovalRequest,
  type ApprovalType,
} from "@/src/lib/approvals";
import { canAccessApprovals } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant } from "@/src/lib/tenant";

type ApprovalFormState = {
  approvalType: ApprovalType;
  assignedRole: ApprovalAssignedRole;
  description: string;
  dueAt: string;
  entityType: string;
  priority: ApprovalPriority;
  title: string;
};

const emptyForm: ApprovalFormState = {
  approvalType: "general",
  assignedRole: "owner",
  description: "",
  dueAt: "",
  entityType: "",
  priority: "normal",
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

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return fallback;
}

function statusTone(status: ApprovalRequest["status"]) {
  if (status === "approved") {
    return "success" as const;
  }

  if (status === "rejected" || status === "cancelled") {
    return "danger" as const;
  }

  return "warning" as const;
}

function priorityTone(priority: ApprovalPriority) {
  if (priority === "urgent" || priority === "high") {
    return "warning" as const;
  }

  return "light" as const;
}

export function ApprovalCenterPage() {
  const [actionError, setActionError] = useState<string | null>(null);
  const [data, setData] = useState<ApprovalDashboardData | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [form, setForm] = useState<ApprovalFormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const initialLoadStarted = useRef(false);

  const canAccess = canAccessApprovals(role);
  const isOwnerAdmin = role === "owner" || role === "admin";

  const loadApprovals = useCallback(async () => {
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
        throw new Error("You must be logged in to view approvals.");
      }

      const tenant = await getCurrentTenant();

      if (!tenant) {
        throw new Error("No workspace found for this user.");
      }

      const memberRole = await getCurrentMemberRole(tenant.id, user.id);
      setRole(memberRole);
      setTenantId(tenant.id);
      setUserId(user.id);

      if (!canAccessApprovals(memberRole)) {
        setData(null);
        return;
      }

      const dashboardData = await getApprovalDashboardData(tenant.id);
      setData(dashboardData);

      const notes: Record<string, string> = {};
      for (const approval of dashboardData.approvals) {
        notes[approval.id] = "";
      }
      setDecisionNotes(notes);
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to load approvals."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialLoadStarted.current) {
      return;
    }

    initialLoadStarted.current = true;
    void Promise.resolve().then(loadApprovals);
  }, [loadApprovals]);

  const grouped = useMemo(() => {
    const approvals = data?.approvals ?? [];

    return {
      assigned: approvals.filter(
        (approval) =>
          approval.status === "pending" &&
          (approval.assigned_to === userId ||
            (!approval.assigned_to && approval.assigned_role === role)),
      ),
      history: approvals.filter((approval) => approval.status !== "pending"),
      pending: approvals.filter((approval) => approval.status === "pending"),
      requested: approvals.filter((approval) => approval.requested_by === userId),
    };
  }, [data, role, userId]);

  const stats = useMemo(() => {
    const approvals = data?.approvals ?? [];

    return {
      approved: approvals.filter((approval) => approval.status === "approved")
        .length,
      assigned: grouped.assigned.length,
      pending: approvals.filter((approval) => approval.status === "pending")
        .length,
      rejected: approvals.filter((approval) => approval.status === "rejected")
        .length,
      total: approvals.length,
    };
  }, [data, grouped.assigned.length]);

  function canDecide(approval: ApprovalRequest) {
    if (approval.status !== "pending") {
      return false;
    }

    return (
      isOwnerAdmin ||
      approval.assigned_to === userId ||
      (!approval.assigned_to && approval.assigned_role === role)
    );
  }

  function canCancel(approval: ApprovalRequest) {
    return (
      approval.status === "pending" &&
      (isOwnerAdmin || approval.requested_by === userId)
    );
  }

  async function handleCreateApproval() {
    if (!tenantId) {
      return;
    }

    setSaving(true);
    setActionError(null);
    setSuccess(null);

    try {
      await createApprovalRequest({
        approvalType: form.approvalType,
        assignedRole: form.assignedRole,
        description: form.description,
        dueAt: form.dueAt,
        entityType: form.entityType,
        priority: form.priority,
        tenantId,
        title: form.title,
      });
      setForm(emptyForm);
      setFormOpen(false);
      setSuccess("Approval request created.");
      await loadApprovals();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to create approval request."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDecision(
    approvalId: string,
    decision: "approved" | "rejected",
  ) {
    setSaving(true);
    setActionError(null);
    setSuccess(null);

    try {
      await decideApprovalRequest({
        approvalId,
        decision,
        decisionNote: decisionNotes[approvalId] ?? "",
      });
      setSuccess(
        decision === "approved"
          ? "Approval request approved."
          : "Approval request rejected.",
      );
      await loadApprovals();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to decide approval request."));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(approvalId: string) {
    setSaving(true);
    setActionError(null);
    setSuccess(null);

    try {
      await cancelApprovalRequest(approvalId);
      setSuccess("Approval request cancelled.");
      await loadApprovals();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to cancel approval request."));
    } finally {
      setSaving(false);
    }
  }

  function renderApprovalCard(approval: ApprovalRequest) {
    return (
      <div
        className="rounded-2xl border border-[#D8E8F0] bg-white p-4"
        key={approval.id}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(approval.status)}>{approval.status}</Badge>
              <Badge tone={priorityTone(approval.priority)}>
                {approval.priority}
              </Badge>
              <Badge tone="light">{formatLabel(approval.approval_type)}</Badge>
            </div>
            <h3 className="mt-3 text-base font-semibold text-[#0B1F33]">
              {approval.title}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[#5D7185]">
              {approval.description || "No description provided."}
            </p>
            <div className="mt-3 grid gap-2 text-xs text-[#5D7185] sm:grid-cols-2">
              <span>Assigned role: {approval.assigned_role ?? "none"}</span>
              <span>Due: {formatDate(approval.due_at)}</span>
              <span>Entity: {approval.entity_type ?? "none"}</span>
              <span>
                Workflow gate: {approval.workflow_step_id ? "linked" : "not linked"}
              </span>
            </div>
          </div>
          <div className="text-xs text-[#5D7185]">
            Created {formatDate(approval.created_at)}
          </div>
        </div>

        {approval.status === "pending" ? (
          <div className="mt-4 border-t border-[#D8E8F0] pt-4">
            <textarea
              className="min-h-20 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
              maxLength={1500}
              onChange={(event) =>
                setDecisionNotes((current) => ({
                  ...current,
                  [approval.id]: event.target.value,
                }))
              }
              placeholder="Optional decision note"
              value={decisionNotes[approval.id] ?? ""}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {canDecide(approval) ? (
                <>
                  <Button
                    disabled={saving}
                    onClick={() => handleDecision(approval.id, "approved")}
                    size="sm"
                    type="button"
                  >
                    Approve
                  </Button>
                  <Button
                    disabled={saving}
                    onClick={() => handleDecision(approval.id, "rejected")}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Reject
                  </Button>
                </>
              ) : null}
              {canCancel(approval) ? (
                <Button
                  disabled={saving}
                  onClick={() => handleCancel(approval.id)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl bg-[#F8FCFE] p-4 text-sm text-[#5D7185]">
            Decision: {approval.status} on {formatDate(approval.decision_at)}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <Card className="p-8">
        <p className="text-sm text-[#5D7185]">Loading approvals...</p>
      </Card>
    );
  }

  if (!canAccess) {
    return (
      <AccessDeniedCard description="Approval Engine is available to internal team users only. Students and public visitors cannot access approval workflows." />
    );
  }

  const approvals = data?.approvals ?? [];

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-3xl border border-[#D8E8F0] bg-white p-6 shadow-xl shadow-[#0B2A3D]/10 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-[#0B1F33]">
              Approval Engine
            </h1>
            <Badge tone={isOwnerAdmin ? "owner" : "staff"}>
              {isOwnerAdmin ? "tenant visibility" : "assigned visibility"}
            </Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5D7185]">
            Request, review, and decide controlled approvals for workflow gates
            and sensitive operations. Approval decisions do not mutate product
            records in this foundation module.
          </p>
        </div>
        <Button onClick={() => setFormOpen((current) => !current)} type="button">
          {formOpen ? "Close request" : "Create request"}
        </Button>
      </section>

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total", stats.total],
          ["Pending", stats.pending],
          ["Assigned", stats.assigned],
          ["Approved", stats.approved],
          ["Rejected", stats.rejected],
        ].map(([label, value]) => (
          <Card className="rounded-2xl p-5" key={label}>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5D7185]">
              {label}
            </p>
            <p className="mt-3 text-3xl font-bold text-[#0B1F33]">{value}</p>
          </Card>
        ))}
      </section>

      {formOpen ? (
        <Card className="rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-[#0B1F33]">
            Create approval request
          </h2>
          <p className="mt-1 text-sm text-[#5D7185]">
            Requests are approval records only. They do not publish courses,
            change payments, or mutate student data.
          </p>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <label className="block text-sm font-semibold text-[#0B2A3D]">
              Title
              <input
                className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                maxLength={180}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
                value={form.title}
              />
            </label>
            <label className="block text-sm font-semibold text-[#0B2A3D]">
              Approval type
              <select
                className="mt-2 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    approvalType: event.target.value as ApprovalType,
                  }))
                }
                value={form.approvalType}
              >
                {approvalTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold text-[#0B2A3D]">
              Assigned role
              <select
                className="mt-2 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    assignedRole: event.target.value as ApprovalAssignedRole,
                  }))
                }
                value={form.assignedRole}
              >
                {approvalAssignedRoles.map((assignedRole) => (
                  <option key={assignedRole} value={assignedRole}>
                    {assignedRole}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold text-[#0B2A3D]">
              Priority
              <select
                className="mt-2 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    priority: event.target.value as ApprovalPriority,
                  }))
                }
                value={form.priority}
              >
                {approvalPriorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold text-[#0B2A3D]">
              Due date
              <input
                className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                onChange={(event) =>
                  setForm((current) => ({ ...current, dueAt: event.target.value }))
                }
                type="datetime-local"
                value={form.dueAt}
              />
            </label>
            <label className="block text-sm font-semibold text-[#0B2A3D]">
              Entity type
              <input
                className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                maxLength={80}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    entityType: event.target.value,
                  }))
                }
                placeholder="Optional, e.g. course"
                value={form.entityType}
              />
            </label>
            <label className="block text-sm font-semibold text-[#0B2A3D] lg:col-span-2">
              Description
              <textarea
                className="mt-2 min-h-28 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                maxLength={1500}
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
          <div className="mt-6 flex justify-end">
            <Button disabled={saving} onClick={handleCreateApproval} type="button">
              {saving ? "Creating..." : "Create approval"}
            </Button>
          </div>
        </Card>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <Card className="rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-[#0B1F33]">
            Pending approvals
          </h2>
          {grouped.pending.length ? (
            <div className="mt-5 space-y-4">
              {grouped.pending.map(renderApprovalCard)}
            </div>
          ) : (
            <EmptyState
              description="No pending approval requests are visible to you."
              icon="AP"
              title="No pending approvals"
            />
          )}
        </Card>

        <div className="space-y-6">
          <Card className="rounded-2xl p-6">
            <h2 className="text-xl font-semibold text-[#0B1F33]">
              Assigned to me
            </h2>
            {grouped.assigned.length ? (
              <div className="mt-5 space-y-4">
                {grouped.assigned.map(renderApprovalCard)}
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-dashed border-[#BFDDE8] bg-[#F8FCFE] p-6 text-sm text-[#5D7185]">
                No approval requests are currently assigned to you or your role.
              </div>
            )}
          </Card>

          <Card className="rounded-2xl p-6">
            <h2 className="text-xl font-semibold text-[#0B1F33]">
              Requested by me
            </h2>
            {grouped.requested.length ? (
              <div className="mt-5 space-y-3">
                {grouped.requested.slice(0, 8).map((approval) => (
                  <div
                    className="rounded-2xl border border-[#D8E8F0] bg-white p-4"
                    key={approval.id}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(approval.status)}>
                        {approval.status}
                      </Badge>
                      <Badge tone="light">
                        {formatLabel(approval.approval_type)}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-[#0B1F33]">
                      {approval.title}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-dashed border-[#BFDDE8] bg-[#F8FCFE] p-6 text-sm text-[#5D7185]">
                You have not requested any approvals yet.
              </div>
            )}
          </Card>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-[#0B1F33]">
            Approval history
          </h2>
          {grouped.history.length ? (
            <div className="mt-5 space-y-4">
              {grouped.history.slice(0, 12).map(renderApprovalCard)}
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-[#BFDDE8] bg-[#F8FCFE] p-6 text-sm text-[#5D7185]">
              Approved, rejected, and cancelled requests will appear here.
            </div>
          )}
        </Card>

        <Card className="rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-[#0B1F33]">
            Approval activity
          </h2>
          {data?.activityLogs.length ? (
            <div className="mt-5 space-y-3">
              {data.activityLogs.slice(0, 12).map((activity) => (
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
              Approval activity will appear after requests are created or
              decided.
            </div>
          )}
        </Card>
      </section>

      {!approvals.length ? null : (
        <p className="text-xs text-[#5D7185]">
          Approval Engine records decisions and workflow-gate state only. It
          does not automatically mutate students, payments, courses, sessions,
          settings, or automations.
        </p>
      )}
    </div>
  );
}
