"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  capturePlatformUsageSnapshot,
  getPlatformAdminContext,
  getPlatformDashboard,
  getPlatformPlans,
  getPlatformTenantDetail,
  getPlatformTenants,
  normalizePlatformError,
  recordPlatformSupportNote,
  toCurrency,
  toDisplayDate,
  updateTenantSubscription,
  upsertPlatformSubscriptionPlan,
  type PlatformAdminContext,
  type PlatformDashboard,
  type PlatformSubscriptionPlan,
  type PlatformTenantDetail,
  type PlatformTenantSummary,
} from "@/src/lib/platform";

type PlanFormState = {
  aiMonthlyLimit: string;
  code: string;
  description: string;
  marketingMonthlyLimit: string;
  maxCourses: string;
  maxStorageMb: string;
  maxStudents: string;
  maxTeamMembers: string;
  monthlyPrice: string;
  name: string;
  status: "active" | "archived" | "inactive";
  yearlyPrice: string;
};

type SubscriptionFormState = {
  amount: string;
  billingCycle: "custom" | "monthly" | "yearly";
  currentPeriodEnd: string;
  currentPeriodStart: string;
  notes: string;
  paymentStatus: "not_required" | "overdue" | "paid" | "unpaid" | "waived";
  planId: string;
  status: "active" | "cancelled" | "past_due" | "suspended" | "trial";
  trialEndsAt: string;
  trialStartedAt: string;
};

type SupportFormState = {
  note: string;
  noteType: "billing" | "follow_up" | "general" | "onboarding" | "risk" | "technical";
  status: "archived" | "in_progress" | "open" | "resolved";
};

const emptyPlanForm: PlanFormState = {
  aiMonthlyLimit: "",
  code: "",
  description: "",
  marketingMonthlyLimit: "",
  maxCourses: "",
  maxStorageMb: "",
  maxStudents: "",
  maxTeamMembers: "",
  monthlyPrice: "0",
  name: "",
  status: "active",
  yearlyPrice: "0",
};

const emptySupportForm: SupportFormState = {
  note: "",
  noteType: "general",
  status: "open",
};

function formatLabel(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return value.replace(/_/g, " ");
}

function statusTone(value: string | null | undefined) {
  if (value === "active" || value === "paid" || value === "resolved") {
    return "success" as const;
  }

  if (value === "past_due" || value === "overdue" || value === "suspended") {
    return "warning" as const;
  }

  if (value === "cancelled" || value === "archived") {
    return "danger" as const;
  }

  return "light" as const;
}

function numberOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value: string) {
  return numberOrNull(value) ?? 0;
}

function dateOrNull(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function toDateInput(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 16);
}

function buildSubscriptionForm(detail: PlatformTenantDetail | null): SubscriptionFormState {
  return {
    amount: String(detail?.subscription.amount ?? 0),
    billingCycle: detail?.subscription.billing_cycle === "yearly"
      ? "yearly"
      : detail?.subscription.billing_cycle === "custom"
        ? "custom"
        : "monthly",
    currentPeriodEnd: toDateInput(detail?.subscription.current_period_end),
    currentPeriodStart: toDateInput(detail?.subscription.current_period_start),
    notes: "",
    paymentStatus: detail?.subscription.payment_status ?? "not_required",
    planId: detail?.subscription.plan_id ?? "",
    status: detail?.subscription.status ?? "trial",
    trialEndsAt: toDateInput(detail?.subscription.trial_ends_at),
    trialStartedAt: toDateInput(detail?.subscription.trial_started_at),
  };
}

function canManageBilling(role: PlatformAdminContext["role"] | null | undefined) {
  return role === "owner" || role === "admin" || role === "finance";
}

function canManageSupport(role: PlatformAdminContext["role"] | null | undefined) {
  return role === "owner" || role === "admin" || role === "support";
}

function canManagePlans(role: PlatformAdminContext["role"] | null | undefined) {
  return role === "owner" || role === "admin";
}

export function PlatformOwnerConsolePage() {
  const [adminContext, setAdminContext] = useState<PlatformAdminContext | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<PlatformDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<PlatformSubscriptionPlan[]>([]);
  const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlanForm);
  const [saving, setSaving] = useState(false);
  const [selectedTenantDetail, setSelectedTenantDetail] =
    useState<PlatformTenantDetail | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [subscriptionForm, setSubscriptionForm] =
    useState<SubscriptionFormState>(buildSubscriptionForm(null));
  const [success, setSuccess] = useState<string | null>(null);
  const [supportForm, setSupportForm] =
    useState<SupportFormState>(emptySupportForm);
  const [tenants, setTenants] = useState<PlatformTenantSummary[]>([]);
  const initialLoadStarted = useRef(false);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null,
    [selectedTenantId, tenants],
  );

  const loadTenantDetail = useCallback(async (tenantId: string) => {
    const detail = await getPlatformTenantDetail(tenantId);
    setSelectedTenantDetail(detail);
    setSubscriptionForm(buildSubscriptionForm(detail));
  }, []);

  const loadPlatform = useCallback(async () => {
    setActionError(null);
    setLoading(true);

    try {
      const context = await getPlatformAdminContext();
      setAdminContext(context);

      if (!context) {
        setDashboard(null);
        setTenants([]);
        setPlans([]);
        setSelectedTenantDetail(null);
        return;
      }

      const [dashboardData, tenantData, planData] = await Promise.all([
        getPlatformDashboard(),
        getPlatformTenants(),
        getPlatformPlans(),
      ]);
      setDashboard(dashboardData);
      setTenants(tenantData);
      setPlans(planData);

      const nextTenantId = selectedTenantId ?? tenantData[0]?.id ?? null;
      setSelectedTenantId(nextTenantId);

      if (nextTenantId) {
        await loadTenantDetail(nextTenantId);
      }
    } catch (error) {
      setActionError(normalizePlatformError(error));
    } finally {
      setLoading(false);
    }
  }, [loadTenantDetail, selectedTenantId]);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadPlatform();
  }, [loadPlatform]);

  const handleSelectTenant = async (tenantId: string) => {
    setActionError(null);
    setSelectedTenantId(tenantId);

    try {
      await loadTenantDetail(tenantId);
    } catch (error) {
      setActionError(normalizePlatformError(error));
    }
  };

  const handleSavePlan = async () => {
    if (!adminContext || !canManagePlans(adminContext.role)) return;

    setSaving(true);
    setActionError(null);
    setSuccess(null);

    try {
      await upsertPlatformSubscriptionPlan({
        aiMonthlyLimit: numberOrNull(planForm.aiMonthlyLimit),
        code: planForm.code,
        description: planForm.description || null,
        marketingMonthlyLimit: numberOrNull(planForm.marketingMonthlyLimit),
        maxCourses: numberOrNull(planForm.maxCourses),
        maxStorageMb: numberOrNull(planForm.maxStorageMb),
        maxStudents: numberOrNull(planForm.maxStudents),
        maxTeamMembers: numberOrNull(planForm.maxTeamMembers),
        monthlyPrice: numberOrZero(planForm.monthlyPrice),
        name: planForm.name,
        status: planForm.status,
        yearlyPrice: numberOrZero(planForm.yearlyPrice),
      });
      setPlanForm(emptyPlanForm);
      setSuccess("Platform plan saved.");
      await loadPlatform();
    } catch (error) {
      setActionError(normalizePlatformError(error));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSubscription = async () => {
    if (!adminContext || !selectedTenantId || !canManageBilling(adminContext.role)) {
      return;
    }

    setSaving(true);
    setActionError(null);
    setSuccess(null);

    try {
      await updateTenantSubscription({
        amount: numberOrZero(subscriptionForm.amount),
        billingCycle: subscriptionForm.billingCycle,
        currentPeriodEnd: dateOrNull(subscriptionForm.currentPeriodEnd),
        currentPeriodStart: dateOrNull(subscriptionForm.currentPeriodStart),
        notes: subscriptionForm.notes || null,
        paymentStatus: subscriptionForm.paymentStatus,
        planId: subscriptionForm.planId || null,
        status: subscriptionForm.status,
        tenantId: selectedTenantId,
        trialEndsAt: dateOrNull(subscriptionForm.trialEndsAt),
        trialStartedAt: dateOrNull(subscriptionForm.trialStartedAt),
      });
      setSuccess("Tenant subscription updated.");
      await loadPlatform();
    } catch (error) {
      setActionError(normalizePlatformError(error));
    } finally {
      setSaving(false);
    }
  };

  const handleRecordSupportNote = async () => {
    if (!adminContext || !selectedTenantId || !canManageSupport(adminContext.role)) {
      return;
    }

    setSaving(true);
    setActionError(null);
    setSuccess(null);

    try {
      await recordPlatformSupportNote({
        note: supportForm.note,
        noteType: supportForm.noteType,
        status: supportForm.status,
        tenantId: selectedTenantId,
      });
      setSupportForm(emptySupportForm);
      setSuccess("Support note recorded.");
      await loadTenantDetail(selectedTenantId);
    } catch (error) {
      setActionError(normalizePlatformError(error));
    } finally {
      setSaving(false);
    }
  };

  const handleCaptureUsage = async () => {
    if (!adminContext || !selectedTenantId || !canManagePlans(adminContext.role)) {
      return;
    }

    setSaving(true);
    setActionError(null);
    setSuccess(null);

    try {
      await capturePlatformUsageSnapshot(selectedTenantId);
      setSuccess("Usage snapshot captured.");
      await loadTenantDetail(selectedTenantId);
    } catch (error) {
      setActionError(normalizePlatformError(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F6FAFC] p-6">
        <div className="mx-auto max-w-7xl">
          <Card className="p-6">
            <p className="text-sm font-semibold text-[#5D7185]">
              Loading platform console...
            </p>
          </Card>
        </div>
      </main>
    );
  }

  if (!adminContext) {
    return (
      <main className="min-h-screen bg-[#F6FAFC] p-6">
        <div className="mx-auto max-w-3xl">
          <AccessDeniedCard description="The CoachFort Platform Owner Console is restricted to active platform_admin_users records. Tenant owner/admin roles do not grant access." />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F6FAFC] text-[#0B1F33]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-4 border-b border-[#D8E8F0] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[#5D7185]">
              Nexus Valley operations
            </p>
            <h1 className="text-3xl font-semibold text-[#0B1F33]">
              CoachFort Platform Owner Console
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-[#5D7185]">
              Platform-level subscriptions, usage, tenant health, and support.
              This console is separate from institute finance records.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="dark">Platform {adminContext.role}</Badge>
            <Button onClick={loadPlatform} size="sm" type="button" variant="secondary">
              Refresh
            </Button>
          </div>
        </header>

        {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
        {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Tenants" value={dashboard?.tenant_count ?? 0} />
          <MetricCard label="Active subscriptions" value={dashboard?.active_subscriptions ?? 0} />
          <MetricCard label="Overdue subscriptions" value={dashboard?.overdue_subscriptions ?? 0} tone="warning" />
          <MetricCard label="Students across platform" value={dashboard?.total_students ?? 0} />
        </section>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.45fr]">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Tenants</h2>
                <p className="text-sm text-[#5D7185]">
                  High-level usage and subscription status only.
                </p>
              </div>
              <Badge tone="light">{tenants.length} total</Badge>
            </div>
            <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
              {tenants.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
                  No tenants available.
                </p>
              ) : (
                tenants.map((tenant) => (
                  <button
                    className={[
                      "w-full rounded-2xl border p-4 text-left transition",
                      selectedTenantId === tenant.id
                        ? "border-[#145DA0] bg-[#EAF8FC]"
                        : "border-[#D8E8F0] bg-white hover:border-[#9ADDEA]",
                    ].join(" ")}
                    key={tenant.id}
                    onClick={() => void handleSelectTenant(tenant.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{tenant.name}</p>
                        <p className="text-sm text-[#5D7185]">/{tenant.slug}</p>
                      </div>
                      <Badge tone={statusTone(tenant.subscription.status)}>
                        {formatLabel(tenant.subscription.status)}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-[#5D7185]">
                      <span>{tenant.students_count} students</span>
                      <span>{tenant.courses_count} courses</span>
                      <span>{tenant.team_members_count} team</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>

          <section className="space-y-6">
            <TenantDetailPanel
              detail={selectedTenantDetail}
              selectedTenantName={selectedTenant?.name}
            />

            <Card className="p-5">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Subscription Control</h2>
                  <p className="text-sm text-[#5D7185]">
                    Manual platform billing status only. No gateway or money movement.
                  </p>
                </div>
                <Badge tone={statusTone(subscriptionForm.paymentStatus)}>
                  {formatLabel(subscriptionForm.paymentStatus)}
                </Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <SelectField
                  label="Plan"
                  onChange={(value) =>
                    setSubscriptionForm((current) => ({ ...current, planId: value }))
                  }
                  value={subscriptionForm.planId}
                >
                  <option value="">No plan</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} ({plan.code})
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="Status"
                  onChange={(value) =>
                    setSubscriptionForm((current) => ({
                      ...current,
                      status: value as SubscriptionFormState["status"],
                    }))
                  }
                  value={subscriptionForm.status}
                >
                  {["trial", "active", "past_due", "suspended", "cancelled"].map(
                    (status) => (
                      <option key={status} value={status}>
                        {formatLabel(status)}
                      </option>
                    ),
                  )}
                </SelectField>
                <SelectField
                  label="Payment status"
                  onChange={(value) =>
                    setSubscriptionForm((current) => ({
                      ...current,
                      paymentStatus: value as SubscriptionFormState["paymentStatus"],
                    }))
                  }
                  value={subscriptionForm.paymentStatus}
                >
                  {["not_required", "unpaid", "paid", "overdue", "waived"].map(
                    (status) => (
                      <option key={status} value={status}>
                        {formatLabel(status)}
                      </option>
                    ),
                  )}
                </SelectField>
                <SelectField
                  label="Billing cycle"
                  onChange={(value) =>
                    setSubscriptionForm((current) => ({
                      ...current,
                      billingCycle: value as SubscriptionFormState["billingCycle"],
                    }))
                  }
                  value={subscriptionForm.billingCycle}
                >
                  {["monthly", "yearly", "custom"].map((cycle) => (
                    <option key={cycle} value={cycle}>
                      {formatLabel(cycle)}
                    </option>
                  ))}
                </SelectField>
                <InputField
                  label="Amount"
                  onChange={(value) =>
                    setSubscriptionForm((current) => ({ ...current, amount: value }))
                  }
                  type="number"
                  value={subscriptionForm.amount}
                />
                <InputField
                  label="Trial ends"
                  onChange={(value) =>
                    setSubscriptionForm((current) => ({ ...current, trialEndsAt: value }))
                  }
                  type="datetime-local"
                  value={subscriptionForm.trialEndsAt}
                />
              </div>
              <TextAreaField
                label="Internal notes"
                onChange={(value) =>
                  setSubscriptionForm((current) => ({ ...current, notes: value }))
                }
                value={subscriptionForm.notes}
              />
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  disabled={!selectedTenantId || saving || !canManageBilling(adminContext.role)}
                  onClick={handleSaveSubscription}
                  type="button"
                >
                  Save subscription
                </Button>
                <Button
                  disabled={!selectedTenantId || saving || !canManagePlans(adminContext.role)}
                  onClick={handleCaptureUsage}
                  type="button"
                  variant="secondary"
                >
                  Capture usage snapshot
                </Button>
              </div>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="text-lg font-semibold">Support Notes</h2>
                <p className="mt-1 text-sm text-[#5D7185]">
                  Full notes remain in platform support tables, not copied into audit metadata.
                </p>
                <div className="mt-4 space-y-3">
                  <SelectField
                    label="Type"
                    onChange={(value) =>
                      setSupportForm((current) => ({
                        ...current,
                        noteType: value as SupportFormState["noteType"],
                      }))
                    }
                    value={supportForm.noteType}
                  >
                    {["general", "billing", "technical", "onboarding", "risk", "follow_up"].map(
                      (type) => (
                        <option key={type} value={type}>
                          {formatLabel(type)}
                        </option>
                      ),
                    )}
                  </SelectField>
                  <TextAreaField
                    label="Note"
                    onChange={(value) =>
                      setSupportForm((current) => ({ ...current, note: value }))
                    }
                    value={supportForm.note}
                  />
                  <Button
                    disabled={!selectedTenantId || saving || !canManageSupport(adminContext.role)}
                    onClick={handleRecordSupportNote}
                    type="button"
                  >
                    Add support note
                  </Button>
                </div>
                <div className="mt-5 space-y-3">
                  {(selectedTenantDetail?.support_notes ?? []).map((note) => (
                    <div className="rounded-2xl border border-[#D8E8F0] bg-white p-3" key={note.id}>
                      <div className="flex items-center justify-between gap-3">
                        <Badge tone={statusTone(note.status)}>{formatLabel(note.status)}</Badge>
                        <span className="text-xs text-[#5D7185]">
                          {toDisplayDate(note.created_at)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[#0B1F33]">{note.note}</p>
                      <p className="mt-1 text-xs text-[#5D7185]">
                        {formatLabel(note.note_type)}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="text-lg font-semibold">Platform Plans</h2>
                <p className="mt-1 text-sm text-[#5D7185]">
                  Plan catalog for platform subscriptions. Gateway billing is not connected.
                </p>
                <div className="mt-4 grid gap-3">
                  <InputField
                    label="Code"
                    onChange={(value) =>
                      setPlanForm((current) => ({ ...current, code: value }))
                    }
                    value={planForm.code}
                  />
                  <InputField
                    label="Name"
                    onChange={(value) =>
                      setPlanForm((current) => ({ ...current, name: value }))
                    }
                    value={planForm.name}
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <InputField
                      label="Monthly price"
                      onChange={(value) =>
                        setPlanForm((current) => ({ ...current, monthlyPrice: value }))
                      }
                      type="number"
                      value={planForm.monthlyPrice}
                    />
                    <InputField
                      label="Yearly price"
                      onChange={(value) =>
                        setPlanForm((current) => ({ ...current, yearlyPrice: value }))
                      }
                      type="number"
                      value={planForm.yearlyPrice}
                    />
                  </div>
                  <TextAreaField
                    label="Description"
                    onChange={(value) =>
                      setPlanForm((current) => ({ ...current, description: value }))
                    }
                    value={planForm.description}
                  />
                  <Button
                    disabled={saving || !canManagePlans(adminContext.role)}
                    onClick={handleSavePlan}
                    type="button"
                  >
                    Save plan
                  </Button>
                </div>
                <div className="mt-5 space-y-3">
                  {plans.slice(0, 6).map((plan) => (
                    <div className="rounded-2xl border border-[#D8E8F0] bg-white p-3" key={plan.id}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold">{plan.name}</p>
                        <Badge tone={statusTone(plan.status)}>{formatLabel(plan.status)}</Badge>
                      </div>
                      <p className="text-sm text-[#5D7185]">{plan.code}</p>
                      <p className="mt-2 text-sm">
                        {toCurrency(plan.monthly_price)} monthly /{" "}
                        {toCurrency(plan.yearly_price)} yearly
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  tone = "light",
  value,
}: {
  label: string;
  tone?: "light" | "warning";
  value: number;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[#5D7185]">{label}</p>
          <p className="mt-2 text-3xl font-semibold">{value.toLocaleString("en-IN")}</p>
        </div>
        <Badge tone={tone === "warning" ? "warning" : "light"}>Platform</Badge>
      </div>
    </Card>
  );
}

function TenantDetailPanel({
  detail,
  selectedTenantName,
}: {
  detail: PlatformTenantDetail | null;
  selectedTenantName?: string | null;
}) {
  if (!detail) {
    return (
      <Card className="p-5">
        <p className="text-sm text-[#5D7185]">
          Select a tenant to view platform-safe details.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">
            {detail.tenant.name || selectedTenantName}
          </h2>
          <p className="text-sm text-[#5D7185]">
            /{detail.tenant.slug} | Created {toDisplayDate(detail.tenant.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={statusTone(detail.subscription.status)}>
            {formatLabel(detail.subscription.status)}
          </Badge>
          <Badge tone={statusTone(detail.subscription.payment_status)}>
            {formatLabel(detail.subscription.payment_status)}
          </Badge>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <SmallMetric label="Students" value={detail.counts.students_count} />
        <SmallMetric label="Courses" value={detail.counts.courses_count} />
        <SmallMetric label="Team" value={detail.counts.team_members_count} />
        <SmallMetric label="Owner/Admin" value={detail.counts.owner_admin_count} />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4">
          <p className="text-sm font-semibold">Subscription</p>
          <dl className="mt-3 space-y-2 text-sm text-[#5D7185]">
            <div className="flex justify-between gap-3">
              <dt>Plan</dt>
              <dd className="text-right text-[#0B1F33]">
                {detail.subscription.plan_name ?? "No plan"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Amount</dt>
              <dd className="text-right text-[#0B1F33]">
                {toCurrency(detail.subscription.amount, detail.subscription.currency ?? "INR")}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Period end</dt>
              <dd className="text-right text-[#0B1F33]">
                {toDisplayDate(detail.subscription.current_period_end)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4">
          <p className="text-sm font-semibold">Latest Usage Snapshot</p>
          {detail.latest_usage_snapshot ? (
            <dl className="mt-3 space-y-2 text-sm text-[#5D7185]">
              <div className="flex justify-between gap-3">
                <dt>Date</dt>
                <dd className="text-right text-[#0B1F33]">
                  {toDisplayDate(detail.latest_usage_snapshot.snapshot_date)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>AI requests</dt>
                <dd className="text-right text-[#0B1F33]">
                  {detail.latest_usage_snapshot.ai_requests_count}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Campaigns</dt>
                <dd className="text-right text-[#0B1F33]">
                  {detail.latest_usage_snapshot.marketing_campaigns_count}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-[#5D7185]">No snapshot captured yet.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function SmallMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#D8E8F0] bg-white p-3">
      <p className="text-xs text-[#5D7185]">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value.toLocaleString("en-IN")}</p>
    </div>
  );
}

function InputField({
  label,
  onChange,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold text-[#0B1F33]">
      {label}
      <input
        className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm font-normal outline-none focus:border-[#145DA0]"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function SelectField({
  children,
  label,
  onChange,
  value,
}: {
  children: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold text-[#0B1F33]">
      {label}
      <select
        className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm font-normal outline-none focus:border-[#145DA0]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function TextAreaField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="mt-3 block text-sm font-semibold text-[#0B1F33]">
      {label}
      <textarea
        className="mt-2 min-h-24 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 py-3 text-sm font-normal outline-none focus:border-[#145DA0]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}
