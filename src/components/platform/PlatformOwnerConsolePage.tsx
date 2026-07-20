"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { ManualActivationPanel } from "@/src/components/platform/ManualActivationPanel";
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
  updatePlatformSupportNote,
  updateTenantSubscription,
  upsertPlatformSubscriptionPlan,
  type PlatformActivity,
  type PlatformAdminContext,
  type PlatformDashboard,
  type PlatformSubscriptionPlan,
  type PlatformTenantDetail,
  type PlatformTenantSummary,
} from "@/src/lib/platform";
import {
  getPlatformPlanCatalog,
  getPlatformUpgradeRequests,
  getTenantEntitlementState,
  reviewTenantPlanUpgradeRequest,
  setTenantSubscriptionPlan,
  type CanonicalPlanCatalogItem,
  type PlatformUpgradeRequest,
  type PlatformUpgradeRequestStatus,
  type ReviewUpgradeRequestStatus,
  type SetTenantSubscriptionPlanInput,
  type TenantEntitlementFeature,
  type TenantEntitlementLimit,
  type TenantEntitlementState,
} from "@/src/lib/subscriptionEntitlements";

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

type CanonicalAssignmentFormState = {
  billingCycle: SetTenantSubscriptionPlanInput["billingCycle"] | "";
  currency: SetTenantSubscriptionPlanInput["currency"] | "";
  note: string;
  paymentStatus: SetTenantSubscriptionPlanInput["paymentStatus"] | "";
  planCode: string;
  status: SetTenantSubscriptionPlanInput["status"] | "";
  trialEndsAt: string;
};

type SubscriptionStatusFilter =
  | "active"
  | "all"
  | "cancelled"
  | "not_set"
  | "past_due"
  | "suspended"
  | "trial";
type PaymentStatusFilter =
  | "all"
  | "not_required"
  | "not_set"
  | "overdue"
  | "paid"
  | "unpaid"
  | "waived";
type TenantSort = "activity" | "name" | "newest" | "students";
type UpgradeRequestStatusFilter =
  | "all"
  | "approved"
  | "cancelled"
  | "in_review"
  | "open"
  | "rejected";
type ReviewUpgradeRequestSubmitInput = {
  request: PlatformUpgradeRequest;
  reviewNote: string | null;
  status: ReviewUpgradeRequestStatus;
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

const emptyCanonicalAssignmentForm: CanonicalAssignmentFormState = {
  billingCycle: "monthly",
  currency: "INR",
  note: "",
  paymentStatus: "not_required",
  planCode: "",
  status: "trial",
  trialEndsAt: "",
};

const subscriptionStatuses: SubscriptionFormState["status"][] = [
  "trial",
  "active",
  "past_due",
  "suspended",
  "cancelled",
];
const paymentStatuses: SubscriptionFormState["paymentStatus"][] = [
  "not_required",
  "unpaid",
  "paid",
  "overdue",
  "waived",
];
const supportTypes: SupportFormState["noteType"][] = [
  "general",
  "billing",
  "technical",
  "onboarding",
  "risk",
  "follow_up",
];
const supportStatuses: SupportFormState["status"][] = [
  "open",
  "in_progress",
  "resolved",
  "archived",
];
const canonicalAssignmentStatuses: SetTenantSubscriptionPlanInput["status"][] = [
  "trial",
  "active",
  "past_due",
  "grace",
  "suspended",
  "cancelled",
  "expired",
];
const canonicalPaymentStatuses: SetTenantSubscriptionPlanInput["paymentStatus"][] = [
  "not_required",
  "unpaid",
  "paid",
  "overdue",
  "waived",
];
const canonicalCurrencies: SetTenantSubscriptionPlanInput["currency"][] = [
  "INR",
  "USD",
  "EUR",
];
const canonicalBillingCycles: SetTenantSubscriptionPlanInput["billingCycle"][] = [
  "monthly",
  "yearly",
  "custom",
];
const upgradeRequestStatuses: UpgradeRequestStatusFilter[] = [
  "all",
  "open",
  "in_review",
  "approved",
  "rejected",
  "cancelled",
];
const upgradeReviewTerminalStatuses = new Set([
  "approved",
  "cancelled",
  "rejected",
]);
const openUpgradeReviewActions: ReviewUpgradeRequestStatus[] = [
  "in_review",
  "approved",
  "rejected",
  "cancelled",
];
const inReviewUpgradeReviewActions: ReviewUpgradeRequestStatus[] = [
  "approved",
  "rejected",
  "cancelled",
];

function formatLabel(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replace(/_/g, " ");
}

function statusTone(value: string | null | undefined) {
  if (
    value === "active" ||
    value === "approved" ||
    value === "paid" ||
    value === "resolved"
  ) {
    return "success" as const;
  }

  if (
    value === "in_review" ||
    value === "open" ||
    value === "past_due" ||
    value === "overdue" ||
    value === "suspended" ||
    value === "unpaid" ||
    value === "in_progress"
  ) {
    return "warning" as const;
  }

  if (value === "cancelled" || value === "archived" || value === "rejected") {
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
    billingCycle:
      detail?.subscription.billing_cycle === "yearly"
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

function buildCanonicalAssignmentForm(
  entitlement: TenantEntitlementState | null,
): CanonicalAssignmentFormState {
  const assignment = entitlement?.assignment;

  return {
    billingCycle:
      assignment?.billing_cycle === "yearly" || assignment?.billing_cycle === "custom"
        ? assignment.billing_cycle
        : "monthly",
    currency:
      assignment?.currency === "USD" || assignment?.currency === "EUR"
        ? assignment.currency
        : "INR",
    note: "",
    paymentStatus:
      assignment?.payment_status === "unpaid" ||
      assignment?.payment_status === "paid" ||
      assignment?.payment_status === "overdue" ||
      assignment?.payment_status === "waived"
        ? assignment.payment_status
        : "not_required",
    planCode: assignment?.plan_code ?? "",
    status:
      assignment?.status === "active" ||
      assignment?.status === "past_due" ||
      assignment?.status === "grace" ||
      assignment?.status === "suspended" ||
      assignment?.status === "cancelled" ||
      assignment?.status === "expired"
        ? assignment.status
        : "trial",
    trialEndsAt: toDateInput(assignment?.trial_ends_at),
  };
}

function canonicalAssignmentSummary(
  assignment: TenantEntitlementState["assignment"] | null,
) {
  if (!assignment) return "No canonical assignment";

  return [
    assignment.plan_code ?? "no plan",
    assignment.status ?? "no status",
    assignment.payment_status ?? "no payment status",
    assignment.currency ?? "no currency",
    assignment.billing_cycle ?? "no cycle",
  ].join(" / ");
}

function canonicalFormSummary(form: CanonicalAssignmentFormState) {
  return [
    form.planCode || "no plan",
    form.status || "no status",
    form.paymentStatus || "no payment status",
    form.currency || "no currency",
    form.billingCycle || "no cycle",
  ].join(" / ");
}

function hasLegacyCanonicalMismatch(
  detail: PlatformTenantDetail | null,
  entitlement: TenantEntitlementState | null,
) {
  const legacy = detail?.subscription;
  const canonical = entitlement?.assignment;

  if (!legacy) return false;
  if (!canonical) {
    return Boolean(
      legacy.plan_code ||
        legacy.status ||
        legacy.payment_status ||
        legacy.currency ||
        legacy.billing_cycle,
    );
  }

  const compare = (left: string | null | undefined, right: string | null | undefined) =>
    (left ?? "").toLowerCase() === (right ?? "").toLowerCase();

  return !(
    compare(legacy.plan_code, canonical.plan_code) &&
    compare(legacy.status, canonical.status) &&
    compare(legacy.payment_status, canonical.payment_status) &&
    compare(legacy.currency, canonical.currency) &&
    compare(legacy.billing_cycle, canonical.billing_cycle)
  );
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

function safeMetadataSummary(metadata: Record<string, unknown>) {
  const text = JSON.stringify(metadata ?? {});
  return text === "{}" ? "No metadata" : text.slice(0, 180);
}

function planFormFromPlan(plan: PlatformSubscriptionPlan): PlanFormState {
  return {
    aiMonthlyLimit: plan.ai_monthly_limit?.toString() ?? "",
    code: plan.code,
    description: plan.description ?? "",
    marketingMonthlyLimit: plan.marketing_monthly_limit?.toString() ?? "",
    maxCourses: plan.max_courses?.toString() ?? "",
    maxStorageMb: plan.max_storage_mb?.toString() ?? "",
    maxStudents: plan.max_students?.toString() ?? "",
    maxTeamMembers: plan.max_team_members?.toString() ?? "",
    monthlyPrice: plan.monthly_price.toString(),
    name: plan.name,
    status: plan.status,
    yearlyPrice: plan.yearly_price.toString(),
  };
}

function booleanLabel(value: boolean) {
  return value ? "true" : "false";
}

function reviewActionLabel(status: ReviewUpgradeRequestStatus) {
  if (status === "in_review") return "Mark in review";
  if (status === "approved") return "Approve request";
  if (status === "rejected") return "Reject request";
  return "Cancel request";
}

function reviewActionRequiresNote(status: ReviewUpgradeRequestStatus) {
  return status !== "in_review";
}

function reviewActionsForStatus(
  status: string | null | undefined,
): ReviewUpgradeRequestStatus[] {
  if (status === "open") return openUpgradeReviewActions;
  if (status === "in_review") return inReviewUpgradeReviewActions;
  return [];
}

function displayLimitValue(value: number | string | null | undefined) {
  return value === null || typeof value === "undefined" ? "Unlimited" : String(value);
}

function entitlementTone(value: string | null | undefined) {
  if (value === "included" || value === "active" || value === "trial") {
    return "success" as const;
  }

  if (
    value === "coming_soon" ||
    value === "platform_approval_required" ||
    value === "addon" ||
    value === "past_due" ||
    value === "warn"
  ) {
    return "warning" as const;
  }

  if (
    value === "locked" ||
    value === "disabled" ||
    value === "suspended" ||
    value === "cancelled" ||
    value === "expired" ||
    value === "hard"
  ) {
    return "danger" as const;
  }

  return "light" as const;
}

export function PlatformOwnerConsolePage() {
  const [adminContext, setAdminContext] = useState<PlatformAdminContext | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [canonicalAssignmentConfirmed, setCanonicalAssignmentConfirmed] =
    useState(false);
  const [canonicalAssignmentError, setCanonicalAssignmentError] =
    useState<string | null>(null);
  const [canonicalAssignmentForm, setCanonicalAssignmentForm] =
    useState<CanonicalAssignmentFormState>(emptyCanonicalAssignmentForm);
  const [canonicalEntitlementError, setCanonicalEntitlementError] =
    useState<string | null>(null);
  const [canonicalEntitlementState, setCanonicalEntitlementState] =
    useState<TenantEntitlementState | null>(null);
  const [canonicalPlanCatalog, setCanonicalPlanCatalog] = useState<
    CanonicalPlanCatalogItem[]
  >([]);
  const [dashboard, setDashboard] = useState<PlatformDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatusFilter>("all");
  const [plans, setPlans] = useState<PlatformSubscriptionPlan[]>([]);
  const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlanForm);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedTenantDetail, setSelectedTenantDetail] =
    useState<PlatformTenantDetail | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [sort, setSort] = useState<TenantSort>("newest");
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatusFilter>("all");
  const [subscriptionForm, setSubscriptionForm] =
    useState<SubscriptionFormState>(buildSubscriptionForm(null));
  const [success, setSuccess] = useState<string | null>(null);
  const [supportForm, setSupportForm] = useState<SupportFormState>(emptySupportForm);
  const [tenants, setTenants] = useState<PlatformTenantSummary[]>([]);
  const [upgradeRequestError, setUpgradeRequestError] = useState<string | null>(null);
  const [upgradeRequests, setUpgradeRequests] = useState<PlatformUpgradeRequest[]>([]);
  const [upgradeRequestStatusFilter, setUpgradeRequestStatusFilter] =
    useState<UpgradeRequestStatusFilter>("all");
  const [upgradeRequestsTenantOnly, setUpgradeRequestsTenantOnly] = useState(false);
  const initialLoadStarted = useRef(false);

  const totalTeamMembers = useMemo(
    () =>
      tenants.reduce((sum, tenant) => sum + (tenant.team_members_count ?? 0), 0),
    [tenants],
  );

  const filteredTenants = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return [...tenants]
      .filter((tenant) => {
        const subscriptionStatus = tenant.subscription.status ?? "not_set";
        const paymentStatus = tenant.subscription.payment_status ?? "not_set";
        const matchesQuery =
          !normalizedQuery ||
          tenant.name.toLowerCase().includes(normalizedQuery) ||
          tenant.slug.toLowerCase().includes(normalizedQuery);
        const matchesStatus =
          statusFilter === "all" || subscriptionStatus === statusFilter;
        const matchesPayment =
          paymentFilter === "all" || paymentStatus === paymentFilter;

        return matchesQuery && matchesStatus && matchesPayment;
      })
      .sort((left, right) => {
        if (sort === "name") return left.name.localeCompare(right.name);
        if (sort === "students") return right.students_count - left.students_count;
        if (sort === "activity") {
          return (
            new Date(right.last_activity_at ?? 0).getTime() -
            new Date(left.last_activity_at ?? 0).getTime()
          );
        }

        return (
          new Date(right.created_at ?? 0).getTime() -
          new Date(left.created_at ?? 0).getTime()
        );
      });
  }, [paymentFilter, query, sort, statusFilter, tenants]);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null,
    [selectedTenantId, tenants],
  );

  const loadCanonicalEntitlements = useCallback(async (tenantId: string | null) => {
    setCanonicalEntitlementError(null);

    try {
      const [catalogData, entitlementData] = await Promise.all([
        getPlatformPlanCatalog(),
        tenantId ? getTenantEntitlementState(tenantId) : Promise.resolve(null),
      ]);
      setCanonicalPlanCatalog(catalogData);
      setCanonicalEntitlementState(entitlementData);
      setCanonicalAssignmentForm(buildCanonicalAssignmentForm(entitlementData));
      setCanonicalAssignmentConfirmed(false);
      setCanonicalAssignmentError(null);
    } catch (error) {
      setCanonicalEntitlementState(null);
      setCanonicalAssignmentForm(emptyCanonicalAssignmentForm);
      setCanonicalAssignmentConfirmed(false);
      setCanonicalEntitlementError(normalizePlatformError(error));
    }
  }, []);

  const loadUpgradeRequests = useCallback(
    async ({
      role,
      status,
      tenantId,
      tenantOnly,
    }: {
      role: PlatformAdminContext["role"] | null | undefined;
      status: UpgradeRequestStatusFilter;
      tenantId: string | null;
      tenantOnly: boolean;
    }) => {
      setUpgradeRequestError(null);

      if (!canManagePlans(role)) {
        setUpgradeRequests([]);
        return;
      }

      try {
        const requests = await getPlatformUpgradeRequests({
          limit: 50,
          offset: 0,
          status:
            status === "all"
              ? null
              : (status as PlatformUpgradeRequestStatus),
          tenantId: tenantOnly ? tenantId : null,
        });
        setUpgradeRequests(requests);
      } catch (error) {
        setUpgradeRequests([]);
        setUpgradeRequestError(normalizePlatformError(error));
      }
    },
    [],
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
        setCanonicalPlanCatalog([]);
        setCanonicalEntitlementState(null);
        setCanonicalEntitlementError(null);
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

      const nextTenantId =
        selectedTenantId && tenantData.some((tenant) => tenant.id === selectedTenantId)
          ? selectedTenantId
          : tenantData[0]?.id ?? null;
      setSelectedTenantId(nextTenantId);

      if (nextTenantId) {
        await loadTenantDetail(nextTenantId);
      }
      await Promise.all([
        loadCanonicalEntitlements(nextTenantId),
        loadUpgradeRequests({
          role: context.role,
          status: upgradeRequestStatusFilter,
          tenantId: nextTenantId,
          tenantOnly: upgradeRequestsTenantOnly,
        }),
      ]);
    } catch (error) {
      setActionError(normalizePlatformError(error));
    } finally {
      setLoading(false);
    }
  }, [
    loadCanonicalEntitlements,
    loadTenantDetail,
    loadUpgradeRequests,
    selectedTenantId,
    upgradeRequestStatusFilter,
    upgradeRequestsTenantOnly,
  ]);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadPlatform();
  }, [loadPlatform]);

  const handleSelectTenant = async (tenantId: string) => {
    setActionError(null);
    setSelectedTenantId(tenantId);

    try {
      await Promise.all([
        loadTenantDetail(tenantId),
        loadCanonicalEntitlements(tenantId),
        loadUpgradeRequests({
          role: adminContext?.role,
          status: upgradeRequestStatusFilter,
          tenantId,
          tenantOnly: upgradeRequestsTenantOnly,
        }),
      ]);
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
      await Promise.all([loadTenantDetail(selectedTenantId), loadPlatform()]);
    } catch (error) {
      setActionError(normalizePlatformError(error));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCanonicalAssignment = async () => {
    if (
      !adminContext ||
      !selectedTenantId ||
      !canManagePlans(adminContext.role) ||
      !canonicalAssignmentForm.planCode ||
      !canonicalAssignmentForm.status ||
      !canonicalAssignmentForm.paymentStatus ||
      !canonicalAssignmentForm.currency ||
      !canonicalAssignmentForm.billingCycle ||
      !canonicalAssignmentForm.note.trim() ||
      !canonicalAssignmentConfirmed
    ) {
      return;
    }

    setSaving(true);
    setCanonicalAssignmentError(null);
    setActionError(null);
    setSuccess(null);

    try {
      const entitlement = await setTenantSubscriptionPlan({
        billingCycle: canonicalAssignmentForm.billingCycle,
        currency: canonicalAssignmentForm.currency,
        metadata: {
          module: "71.7G5",
          operator_note: canonicalAssignmentForm.note.trim(),
          source: "platform_manual_assignment_ui",
        },
        paymentStatus: canonicalAssignmentForm.paymentStatus,
        planCode: canonicalAssignmentForm.planCode,
        status: canonicalAssignmentForm.status,
        tenantId: selectedTenantId,
        trialEndsAt: dateOrNull(canonicalAssignmentForm.trialEndsAt),
      });
      setCanonicalEntitlementState(entitlement);
      setCanonicalAssignmentConfirmed(false);
      setCanonicalAssignmentForm(buildCanonicalAssignmentForm(entitlement));
      setSuccess("Canonical entitlement assignment updated.");
      await Promise.all([
        loadCanonicalEntitlements(selectedTenantId),
        loadTenantDetail(selectedTenantId),
      ]);
    } catch (error) {
      setCanonicalAssignmentError(normalizePlatformError(error));
    } finally {
      setSaving(false);
    }
  };

  const handleReviewUpgradeRequest = async ({
    request,
    reviewNote,
    status,
  }: ReviewUpgradeRequestSubmitInput) => {
    if (!adminContext || !canManagePlans(adminContext.role)) {
      return "Upgrade request review is restricted to platform owner/admin roles.";
    }

    setSaving(true);
    setActionError(null);
    setUpgradeRequestError(null);
    setSuccess(null);

    try {
      await reviewTenantPlanUpgradeRequest({
        metadataJson: {
          assignment_changed: false,
          checkout_enabled: false,
          module: "71.7G17",
          payment_gateway_called: false,
          requested_plan_code: request.requested_plan_code,
          source: "platform_upgrade_request_review_ui",
        },
        requestId: request.request_id,
        reviewNote,
        status,
      });
      setSuccess(`Upgrade request status updated to ${formatLabel(status)}.`);
      await Promise.all([
        loadUpgradeRequests({
          role: adminContext.role,
          status: upgradeRequestStatusFilter,
          tenantId: selectedTenantId,
          tenantOnly: upgradeRequestsTenantOnly,
        }),
        selectedTenantId
          ? loadCanonicalEntitlements(selectedTenantId)
          : Promise.resolve(),
      ]);
      return null;
    } catch (error) {
      return normalizePlatformError(error);
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

  const handleSupportStatusChange = async (noteId: string, status: string) => {
    if (!adminContext || !selectedTenantId || !canManageSupport(adminContext.role)) {
      return;
    }

    setSaving(true);
    setActionError(null);
    setSuccess(null);

    try {
      await updatePlatformSupportNote(noteId, { status });
      setSuccess("Support note status updated.");
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

  const handleUpgradeRequestStatusFilterChange = (
    nextStatus: UpgradeRequestStatusFilter,
  ) => {
    setUpgradeRequestStatusFilter(nextStatus);
    void loadUpgradeRequests({
      role: adminContext?.role,
      status: nextStatus,
      tenantId: selectedTenantId,
      tenantOnly: upgradeRequestsTenantOnly,
    });
  };

  const handleUpgradeRequestTenantFilterChange = (nextTenantOnly: boolean) => {
    setUpgradeRequestsTenantOnly(nextTenantOnly);
    void loadUpgradeRequests({
      role: adminContext?.role,
      status: upgradeRequestStatusFilter,
      tenantId: selectedTenantId,
      tenantOnly: nextTenantOnly,
    });
  };

  if (loading) {
    return <PlatformLoadingState />;
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
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6">
        <PlatformHeader adminContext={adminContext} onRefresh={loadPlatform} />

        {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
        {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <MetricCard label="Tenants" value={dashboard?.tenant_count ?? 0} />
          <MetricCard label="Active" value={dashboard?.active_tenants ?? 0} tone="success" />
          <MetricCard label="Trial" value={dashboard?.trial_tenants ?? 0} />
          <MetricCard
            label="Past due"
            value={dashboard?.overdue_subscriptions ?? 0}
            tone="warning"
          />
          <MetricCard
            label="Suspended"
            value={dashboard?.suspended_tenants ?? 0}
            tone="warning"
          />
          <MetricCard label="Students" value={dashboard?.total_students ?? 0} />
          <MetricCard label="Courses" value={dashboard?.total_courses ?? 0} />
          <MetricCard label="Team" value={totalTeamMembers} />
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.55fr)]">
          <TenantDirectory
            filteredTenants={filteredTenants}
            paymentFilter={paymentFilter}
            query={query}
            selectedTenantId={selectedTenantId}
            setPaymentFilter={setPaymentFilter}
            setQuery={setQuery}
            setSort={setSort}
            setStatusFilter={setStatusFilter}
            sort={sort}
            statusFilter={statusFilter}
            tenants={tenants}
            onSelectTenant={(tenantId) => void handleSelectTenant(tenantId)}
          />

          <section className="space-y-6">
            <TenantDetailPanel
              detail={selectedTenantDetail}
              selectedTenantName={selectedTenant?.name}
            />

            <CanonicalEntitlementPanel
              catalog={canonicalPlanCatalog}
              entitlement={canonicalEntitlementState}
              error={canonicalEntitlementError}
              selectedTenantName={selectedTenant?.name}
            />

            <CanonicalAssignmentControlsPanel
              adminRole={adminContext.role}
              catalog={canonicalPlanCatalog}
              confirmed={canonicalAssignmentConfirmed}
              detail={selectedTenantDetail}
              entitlement={canonicalEntitlementState}
              error={canonicalAssignmentError}
              form={canonicalAssignmentForm}
              saving={saving}
              selectedTenantId={selectedTenantId}
              selectedTenantName={selectedTenant?.name}
              setConfirmed={setCanonicalAssignmentConfirmed}
              setForm={setCanonicalAssignmentForm}
              onSave={handleSaveCanonicalAssignment}
            />

            {canManagePlans(adminContext.role) ? (
              <ManualActivationPanel
                adminRole={adminContext.role}
                canonicalEntitlement={canonicalEntitlementState}
                detail={selectedTenantDetail}
                selectedTenant={selectedTenant}
                onActivated={async () => {
                  if (selectedTenantId) {
                    await Promise.all([
                      loadTenantDetail(selectedTenantId),
                      loadCanonicalEntitlements(selectedTenantId),
                      loadPlatform(),
                    ]);
                  }
                }}
              />
            ) : null}

            <UpgradeRequestReviewPanel
              adminRole={adminContext.role}
              error={upgradeRequestError}
              requests={upgradeRequests}
              selectedTenantId={selectedTenantId}
              selectedTenantName={selectedTenant?.name}
              saving={saving}
              statusFilter={upgradeRequestStatusFilter}
              tenantOnly={upgradeRequestsTenantOnly}
              onReviewRequest={handleReviewUpgradeRequest}
              onStatusFilterChange={handleUpgradeRequestStatusFilterChange}
              onTenantOnlyChange={handleUpgradeRequestTenantFilterChange}
              onRefresh={() =>
                void loadUpgradeRequests({
                  role: adminContext.role,
                  status: upgradeRequestStatusFilter,
                  tenantId: selectedTenantId,
                  tenantOnly: upgradeRequestsTenantOnly,
                })
              }
            />

            <SubscriptionPanel
              adminRole={adminContext.role}
              form={subscriptionForm}
              plans={plans}
              saving={saving}
              selectedTenantId={selectedTenantId}
              setForm={setSubscriptionForm}
              onCaptureUsage={handleCaptureUsage}
              onSave={handleSaveSubscription}
            />

            <div className="grid gap-6 lg:grid-cols-2">
              <SupportNotesPanel
                adminRole={adminContext.role}
                detail={selectedTenantDetail}
                form={supportForm}
                saving={saving}
                selectedTenantId={selectedTenantId}
                setForm={setSupportForm}
                onRecord={handleRecordSupportNote}
                onStatusChange={handleSupportStatusChange}
              />

              <PlanManagementPanel
                adminRole={adminContext.role}
                form={planForm}
                plans={plans}
                saving={saving}
                setForm={setPlanForm}
                onLoadPlan={(plan) => setPlanForm(planFormFromPlan(plan))}
                onReset={() => setPlanForm(emptyPlanForm)}
                onSave={handleSavePlan}
              />
            </div>

            <PlatformActivityPanel
              activity={selectedTenantDetail?.activity ?? dashboard?.recent_activity ?? []}
            />
          </section>
        </div>
      </div>
    </main>
  );
}

function PlatformHeader({
  adminContext,
  onRefresh,
}: {
  adminContext: PlatformAdminContext;
  onRefresh: () => void;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-[#D8E8F0] pb-5 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[#5D7185]">
          Nexus Valley operations
        </p>
        <h1 className="text-3xl font-semibold text-[#0B1F33]">
          CoachFort Platform Owner Console
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[#5D7185]">
          Platform-level subscriptions, usage, tenant health, and support. This
          console manages platform status, not institute finance records.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="dark">Platform {adminContext.role}</Badge>
        <Button onClick={onRefresh} size="sm" type="button" variant="secondary">
          Refresh
        </Button>
      </div>
    </header>
  );
}

function PlatformLoadingState() {
  return (
    <main className="min-h-screen bg-[#F6FAFC] p-6">
      <div className="mx-auto grid max-w-7xl gap-4">
        <Card className="p-6">
          <div className="h-5 w-56 rounded-full bg-[#E5EEF4]" />
          <div className="mt-4 h-9 w-96 max-w-full rounded-full bg-[#E5EEF4]" />
        </Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Card className="p-5" key={item}>
              <div className="h-4 w-24 rounded-full bg-[#E5EEF4]" />
              <div className="mt-4 h-8 w-16 rounded-full bg-[#E5EEF4]" />
            </Card>
          ))}
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
  tone?: "light" | "success" | "warning";
  value: number;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#5D7185]">
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-2xl font-semibold">{value.toLocaleString("en-IN")}</p>
        <Badge tone={tone}>{tone === "light" ? "Count" : formatLabel(tone)}</Badge>
      </div>
    </Card>
  );
}

function TenantDirectory({
  filteredTenants,
  paymentFilter,
  query,
  selectedTenantId,
  setPaymentFilter,
  setQuery,
  setSort,
  setStatusFilter,
  sort,
  statusFilter,
  tenants,
  onSelectTenant,
}: {
  filteredTenants: PlatformTenantSummary[];
  paymentFilter: PaymentStatusFilter;
  query: string;
  selectedTenantId: string | null;
  setPaymentFilter: (value: PaymentStatusFilter) => void;
  setQuery: (value: string) => void;
  setSort: (value: TenantSort) => void;
  setStatusFilter: (value: SubscriptionStatusFilter) => void;
  sort: TenantSort;
  statusFilter: SubscriptionStatusFilter;
  tenants: PlatformTenantSummary[];
  onSelectTenant: (tenantId: string) => void;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Tenant Directory</h2>
          <p className="text-sm text-[#5D7185]">
            {filteredTenants.length} visible of {tenants.length} tenants.
          </p>
        </div>
        <Badge tone="light">No PII</Badge>
      </div>

      <div className="grid gap-3">
        <InputField
          label="Search"
          onChange={setQuery}
          placeholder="Tenant name or slug"
          value={query}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="Subscription"
            onChange={(value) => setStatusFilter(value as SubscriptionStatusFilter)}
            value={statusFilter}
          >
            {["all", "not_set", ...subscriptionStatuses].map((status) => (
              <option key={status} value={status}>
                {formatLabel(status)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Payment"
            onChange={(value) => setPaymentFilter(value as PaymentStatusFilter)}
            value={paymentFilter}
          >
            {["all", "not_set", ...paymentStatuses].map((status) => (
              <option key={status} value={status}>
                {formatLabel(status)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Sort"
            onChange={(value) => setSort(value as TenantSort)}
            value={sort}
          >
            <option value="newest">Newest</option>
            <option value="name">Name A-Z</option>
            <option value="students">Students high-low</option>
            <option value="activity">Activity recent</option>
          </SelectField>
        </div>
      </div>

      <div className="mt-4 max-h-[720px] space-y-3 overflow-y-auto pr-1">
        {filteredTenants.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
            No tenants match the current filters.
          </p>
        ) : (
          filteredTenants.map((tenant) => (
            <button
              className={[
                "w-full rounded-2xl border p-4 text-left transition",
                selectedTenantId === tenant.id
                  ? "border-[#145DA0] bg-[#EAF8FC] shadow-sm"
                  : "border-[#D8E8F0] bg-white hover:border-[#9ADDEA]",
              ].join(" ")}
              key={tenant.id}
              onClick={() => onSelectTenant(tenant.id)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{tenant.name}</p>
                  <p className="truncate text-sm text-[#5D7185]">/{tenant.slug}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Badge tone={statusTone(tenant.subscription.status)}>
                    {formatLabel(tenant.subscription.status)}
                  </Badge>
                  <Badge tone={statusTone(tenant.subscription.payment_status)}>
                    {formatLabel(tenant.subscription.payment_status)}
                  </Badge>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-[#5D7185]">
                <span>{tenant.students_count} students</span>
                <span>{tenant.courses_count} courses</span>
                <span>{tenant.team_members_count} team</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#5D7185]">
                <span>Plan: {tenant.subscription.plan_name ?? "Not set"}</span>
                <span>Last activity: {toDisplayDate(tenant.last_activity_at)}</span>
              </div>
            </button>
          ))
        )}
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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.06em] text-[#5D7185]">
            Tenant profile
          </p>
          <h2 className="mt-1 text-2xl font-semibold">
            {detail.tenant.name || selectedTenantName}
          </h2>
          <p className="mt-1 text-sm text-[#5D7185]">
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

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SmallMetric label="Students" value={detail.counts.students_count} />
        <SmallMetric label="Courses" value={detail.counts.courses_count} />
        <SmallMetric label="Team members" value={detail.counts.team_members_count} />
        <SmallMetric label="Owners/Admins" value={detail.counts.owner_admin_count} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <InfoPanel title="Subscription">
          <InfoRow label="Plan" value={detail.subscription.plan_name ?? "Not set"} />
          <InfoRow label="Billing cycle" value={formatLabel(detail.subscription.billing_cycle)} />
          <InfoRow
            label="Amount"
            value={toCurrency(
              detail.subscription.amount,
              detail.subscription.currency ?? "INR",
            )}
          />
          <InfoRow label="Trial ends" value={toDisplayDate(detail.subscription.trial_ends_at)} />
          <InfoRow
            label="Current period ends"
            value={toDisplayDate(detail.subscription.current_period_end)}
          />
          <InfoRow
            label="Billing notes"
            value={detail.subscription.notes_present ? "Present" : "Not set"}
          />
        </InfoPanel>

        <InfoPanel title="Latest Usage Snapshot">
          {detail.latest_usage_snapshot ? (
            <>
              <InfoRow
                label="Snapshot date"
                value={toDisplayDate(detail.latest_usage_snapshot.snapshot_date)}
              />
              <InfoRow
                label="AI requests this month"
                value={detail.latest_usage_snapshot.ai_requests_count.toString()}
              />
              <InfoRow
                label="Marketing campaigns"
                value={detail.latest_usage_snapshot.marketing_campaigns_count.toString()}
              />
              <InfoRow
                label="Storage MB"
                value={detail.latest_usage_snapshot.storage_mb.toString()}
              />
            </>
          ) : (
            <p className="text-sm text-[#5D7185]">No usage snapshot captured yet.</p>
          )}
        </InfoPanel>
      </div>
    </Card>
  );
}

function CanonicalEntitlementPanel({
  catalog,
  entitlement,
  error,
  selectedTenantName,
}: {
  catalog: CanonicalPlanCatalogItem[];
  entitlement: TenantEntitlementState | null;
  error: string | null;
  selectedTenantName?: string | null;
}) {
  const keyFeatureKeys = ["payment_gateway", "live_classes", "students", "courses"];
  const keyFeatures = keyFeatureKeys.map((featureKey) => ({
    featureKey,
    feature:
      entitlement?.features.find((item) => item.feature_key === featureKey) ?? null,
  }));
  const keyLimits = ["students", "courses", "storage_mb", "document_uploads"]
    .map((resourceKey) => ({
      limit: entitlement?.limits.find((item) => item.resource_key === resourceKey) ?? null,
      resourceKey,
    }))
    .filter((item) => item.limit);
  const usageEntries = entitlement
    ? Object.entries(entitlement.latest_usage).filter(([, value]) => value !== null)
    : [];
  const assignment = entitlement?.assignment ?? null;

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.06em] text-[#5D7185]">
            Canonical entitlement foundation
          </p>
          <h2 className="mt-1 text-xl font-semibold">Read-only subscription entitlements</h2>
          <p className="mt-1 max-w-3xl text-sm text-[#5D7185]">
            Read-only view of the new entitlement foundation. No checkout, payment
            enforcement, plan assignment, or feature gate changes are active from this
            panel.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="dark">Read-only</Badge>
          <Badge tone="warning">Checkout off</Badge>
        </div>
      </div>

      <p className="mt-4 rounded-2xl border border-[#FED7AA] bg-[#FFF7ED] p-3 text-sm text-[#9A3412]">
        Payment gateway is not active. Checkout is not enabled.
      </p>

      {error ? (
        <p className="mt-4 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-[#B91C1C]">
          Canonical entitlement data is currently unavailable: {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Plan catalog summary</p>
              <p className="text-xs text-[#5D7185]">
                Canonical plans returned by get_platform_plan_catalog().
              </p>
            </div>
            <Badge tone="light">{catalog.length} plans</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {catalog.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#D8E8F0] bg-white p-3 text-sm text-[#5D7185]">
                No canonical catalog rows returned for this platform role.
              </p>
            ) : (
              catalog.slice(0, 6).map((plan) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-white p-3"
                  key={plan.id || plan.code}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{plan.name}</p>
                      <p className="text-sm text-[#5D7185]">{plan.code}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={statusTone(plan.status)}>{formatLabel(plan.status)}</Badge>
                      <Badge tone={plan.is_public ? "success" : "light"}>
                        {plan.is_public ? "Public" : "Private"}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-[#5D7185]">
                    <span>{plan.prices.length} prices</span>
                    <span>{plan.usage_limits.length} limits</span>
                    <span>{plan.feature_entitlements.length} features</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Selected tenant entitlement state</p>
              <p className="text-xs text-[#5D7185]">
                {selectedTenantName ?? "Select a tenant"} canonical assignment and usage.
              </p>
            </div>
            <Badge tone={assignment ? entitlementTone(assignment.status) : "light"}>
              {assignment ? formatLabel(assignment.status) : "No assignment"}
            </Badge>
          </div>

          {!entitlement ? (
            <p className="mt-4 rounded-2xl border border-dashed border-[#D8E8F0] bg-white p-3 text-sm text-[#5D7185]">
              Select a tenant to load canonical entitlement state.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SmallMetric
                  label="Payment forced"
                  value={entitlement.payment_forced ? 1 : 0}
                />
                <SmallMetric
                  label="Gateway required"
                  value={entitlement.gateway_required ? 1 : 0}
                />
                <SmallMetric label="Warnings" value={entitlement.warnings.length} />
                <SmallMetric label="Limits" value={entitlement.limits.length} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <InfoPanel title="Canonical Assignment">
                  <InfoRow label="Plan" value={assignment?.plan_code ?? "Not assigned"} />
                  <InfoRow label="Status" value={formatLabel(assignment?.status)} />
                  <InfoRow
                    label="Payment status"
                    value={formatLabel(assignment?.payment_status)}
                  />
                  <InfoRow label="Currency" value={assignment?.currency ?? "Not set"} />
                  <InfoRow
                    label="Payment forced"
                    value={booleanLabel(entitlement.payment_forced)}
                  />
                  <InfoRow
                    label="Gateway required"
                    value={booleanLabel(entitlement.gateway_required)}
                  />
                </InfoPanel>

                <InfoPanel title="Latest Canonical Usage">
                  {usageEntries.length === 0 ? (
                    <p className="text-sm text-[#5D7185]">No canonical usage snapshot.</p>
                  ) : (
                    usageEntries.slice(0, 6).map(([key, value]) => (
                      <InfoRow
                        key={key}
                        label={formatLabel(key)}
                        value={String(value)}
                      />
                    ))
                  )}
                </InfoPanel>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-[#D8E8F0] bg-white p-3">
                  <p className="text-sm font-semibold">Key limits</p>
                  <div className="mt-3 space-y-2">
                    {keyLimits.length === 0 ? (
                      <p className="text-sm text-[#5D7185]">No key limits configured.</p>
                    ) : (
                      keyLimits.map(({ limit, resourceKey }) => (
                        <LimitSummaryRow
                          key={resourceKey}
                          limit={limit}
                          resourceKey={resourceKey}
                        />
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-[#D8E8F0] bg-white p-3">
                  <p className="text-sm font-semibold">Key feature statuses</p>
                  <div className="mt-3 space-y-2">
                    {keyFeatures.map(({ feature, featureKey }) => (
                      <FeatureSummaryRow
                        feature={feature}
                        featureKey={featureKey}
                        key={featureKey}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function LimitSummaryRow({
  limit,
  resourceKey,
}: {
  limit: TenantEntitlementLimit | null;
  resourceKey: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] px-3 py-2 text-sm">
      <div>
        <p className="font-semibold">{formatLabel(resourceKey)}</p>
        <p className="text-xs text-[#5D7185]">
          Base {displayLimitValue(limit?.base_limit_value)}
          {limit?.override_type ? ` | ${formatLabel(limit.override_type)}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={entitlementTone(limit?.enforcement_mode)}>
          {formatLabel(limit?.enforcement_mode)}
        </Badge>
        <span className="font-semibold">{displayLimitValue(limit?.limit_value)}</span>
      </div>
    </div>
  );
}

function FeatureSummaryRow({
  feature,
  featureKey,
}: {
  feature: TenantEntitlementFeature | null;
  featureKey: string;
}) {
  return (
    <div className="rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{formatLabel(featureKey)}</p>
        <Badge tone={entitlementTone(feature?.effective_status)}>
          {formatLabel(feature?.effective_status ?? "not configured")}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-[#5D7185]">
        Reason: {formatLabel(feature?.reason)} | Plan:{" "}
        {formatLabel(feature?.plan_status)} | Module 62:{" "}
        {formatLabel(feature?.module62_status)}
      </p>
    </div>
  );
}

function CanonicalAssignmentControlsPanel({
  adminRole,
  catalog,
  confirmed,
  detail,
  entitlement,
  error,
  form,
  saving,
  selectedTenantId,
  selectedTenantName,
  setConfirmed,
  setForm,
  onSave,
}: {
  adminRole: PlatformAdminContext["role"];
  catalog: CanonicalPlanCatalogItem[];
  confirmed: boolean;
  detail: PlatformTenantDetail | null;
  entitlement: TenantEntitlementState | null;
  error: string | null;
  form: CanonicalAssignmentFormState;
  saving: boolean;
  selectedTenantId: string | null;
  selectedTenantName?: string | null;
  setConfirmed: React.Dispatch<React.SetStateAction<boolean>>;
  setForm: React.Dispatch<React.SetStateAction<CanonicalAssignmentFormState>>;
  onSave: () => void;
}) {
  const canEditCanonical = canManagePlans(adminRole);
  const availablePlans = catalog.filter((plan) => plan.status !== "archived");
  const assignment = entitlement?.assignment ?? null;
  const mismatch = hasLegacyCanonicalMismatch(detail, entitlement);
  const keyFeatures = ["payment_gateway", "live_classes"].map((featureKey) => ({
    feature:
      entitlement?.features.find((item) => item.feature_key === featureKey) ?? null,
    featureKey,
  }));
  const keyLimits = ["students", "courses"]
    .map((resourceKey) => ({
      limit: entitlement?.limits.find((item) => item.resource_key === resourceKey) ?? null,
      resourceKey,
    }))
    .filter((item) => item.limit);
  const canSave =
    canEditCanonical &&
    Boolean(selectedTenantId) &&
    Boolean(form.planCode) &&
    Boolean(form.status) &&
    Boolean(form.paymentStatus) &&
    Boolean(form.currency) &&
    Boolean(form.billingCycle) &&
    Boolean(form.note.trim()) &&
    confirmed &&
    !saving;

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.06em] text-[#5D7185]">
            Canonical assignment controls
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            Manual canonical subscription assignment
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[#5D7185]">
            This updates canonical entitlement assignment only. It does not charge
            money, activate checkout, or update legacy billing records. Payment
            gateway remains inactive unless separately enabled in a reviewed
            gateway module.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="dark">Canonical only</Badge>
          <Badge tone="warning">Checkout off</Badge>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-[#B91C1C]">
          Canonical assignment update failed: {error}
        </p>
      ) : null}

      {mismatch ? (
        <p className="mt-4 rounded-2xl border border-[#FED7AA] bg-[#FFF7ED] p-3 text-sm text-[#9A3412]">
          Canonical entitlement assignment may differ from legacy billing records
          during transition. Legacy billing is retained for historical/platform
          operations until a reviewed migration sync is approved.
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <InfoPanel title="Current Canonical Assignment">
          <InfoRow label="Tenant" value={selectedTenantName ?? "No tenant selected"} />
          <InfoRow label="Plan" value={assignment?.plan_code ?? "Not assigned"} />
          <InfoRow label="Status" value={formatLabel(assignment?.status)} />
          <InfoRow
            label="Payment status"
            value={formatLabel(assignment?.payment_status)}
          />
          <InfoRow label="Currency" value={assignment?.currency ?? "Not set"} />
          <InfoRow
            label="Billing cycle"
            value={formatLabel(assignment?.billing_cycle)}
          />
          <InfoRow
            label="Payment forced"
            value={booleanLabel(Boolean(entitlement?.payment_forced))}
          />
          <InfoRow
            label="Gateway required"
            value={booleanLabel(Boolean(entitlement?.gateway_required))}
          />
        </InfoPanel>

        <InfoPanel title="Legacy Module 56 Billing Reference">
          <InfoRow label="Plan" value={detail?.subscription.plan_name ?? "Not set"} />
          <InfoRow label="Status" value={formatLabel(detail?.subscription.status)} />
          <InfoRow
            label="Payment status"
            value={formatLabel(detail?.subscription.payment_status)}
          />
          <InfoRow label="Currency" value={detail?.subscription.currency ?? "Not set"} />
          <InfoRow
            label="Billing cycle"
            value={formatLabel(detail?.subscription.billing_cycle)}
          />
          <InfoRow
            label="Amount"
            value={toCurrency(
              detail?.subscription.amount,
              detail?.subscription.currency ?? "INR",
            )}
          />
        </InfoPanel>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4">
          <p className="text-sm font-semibold">Current limits</p>
          <div className="mt-3 space-y-2">
            {keyLimits.length === 0 ? (
              <p className="text-sm text-[#5D7185]">No key canonical limits.</p>
            ) : (
              keyLimits.map(({ limit, resourceKey }) => (
                <LimitSummaryRow
                  key={resourceKey}
                  limit={limit}
                  resourceKey={resourceKey}
                />
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4">
          <p className="text-sm font-semibold">Gateway and live class status</p>
          <div className="mt-3 space-y-2">
            {keyFeatures.map(({ feature, featureKey }) => (
              <FeatureSummaryRow
                feature={feature}
                featureKey={featureKey}
                key={featureKey}
              />
            ))}
          </div>
        </div>
      </div>

      {!canEditCanonical ? (
        <p className="mt-5 rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4 text-sm text-[#5D7185]">
          Your platform role can view canonical entitlement state but cannot change
          canonical subscription assignment.
        </p>
      ) : (
        <div className="mt-5 rounded-2xl border border-[#D8E8F0] bg-white p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SelectField
              label="Canonical plan"
              onChange={(value) => {
                setConfirmed(false);
                setForm((current) => ({ ...current, planCode: value }));
              }}
              value={form.planCode}
            >
              <option value="">Select plan</option>
              {availablePlans.map((plan) => (
                <option key={plan.id || plan.code} value={plan.code}>
                  {plan.name} ({plan.code}, {formatLabel(plan.status)})
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Canonical status"
              onChange={(value) => {
                setConfirmed(false);
                setForm((current) => ({
                  ...current,
                  status: value as CanonicalAssignmentFormState["status"],
                }));
              }}
              value={form.status}
            >
              {canonicalAssignmentStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatLabel(status)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Payment status"
              onChange={(value) => {
                setConfirmed(false);
                setForm((current) => ({
                  ...current,
                  paymentStatus:
                    value as CanonicalAssignmentFormState["paymentStatus"],
                }));
              }}
              value={form.paymentStatus}
            >
              {canonicalPaymentStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatLabel(status)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Currency"
              onChange={(value) => {
                setConfirmed(false);
                setForm((current) => ({
                  ...current,
                  currency: value as CanonicalAssignmentFormState["currency"],
                }));
              }}
              value={form.currency}
            >
              {canonicalCurrencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Billing cycle"
              onChange={(value) => {
                setConfirmed(false);
                setForm((current) => ({
                  ...current,
                  billingCycle:
                    value as CanonicalAssignmentFormState["billingCycle"],
                }));
              }}
              value={form.billingCycle}
            >
              {canonicalBillingCycles.map((cycle) => (
                <option key={cycle} value={cycle}>
                  {formatLabel(cycle)}
                </option>
              ))}
            </SelectField>
            <InputField
              label="Trial ends"
              onChange={(value) => {
                setConfirmed(false);
                setForm((current) => ({ ...current, trialEndsAt: value }));
              }}
              type="datetime-local"
              value={form.trialEndsAt}
            />
          </div>
          <TextAreaField
            label="Reason / operator note"
            onChange={(value) => {
              setConfirmed(false);
              setForm((current) => ({ ...current, note: value }));
            }}
            value={form.note}
          />

          <label className="mt-4 flex gap-3 rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4 text-sm text-[#0B1F33]">
            <input
              checked={confirmed}
              className="mt-1 h-4 w-4"
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              Confirm assignment for {selectedTenantName ?? "the selected tenant"}:
              old canonical assignment is {canonicalAssignmentSummary(assignment)};
              new canonical assignment is {canonicalFormSummary(form)}. No payment
              will be charged. Checkout will not be enabled. Legacy billing records
              will not be updated.
            </span>
          </label>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button disabled={!canSave} onClick={onSave} type="button">
              Save canonical assignment
            </Button>
            <p className="text-sm text-[#5D7185]">
              Save calls only set_tenant_subscription_plan and then re-fetches
              canonical state. No legacy billing RPC is called from this control.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

function UpgradeRequestReviewPanel({
  adminRole,
  error,
  requests,
  selectedTenantId,
  selectedTenantName,
  saving,
  statusFilter,
  tenantOnly,
  onReviewRequest,
  onStatusFilterChange,
  onTenantOnlyChange,
  onRefresh,
}: {
  adminRole: PlatformAdminContext["role"];
  error: string | null;
  requests: PlatformUpgradeRequest[];
  selectedTenantId: string | null;
  selectedTenantName?: string | null;
  saving: boolean;
  statusFilter: UpgradeRequestStatusFilter;
  tenantOnly: boolean;
  onReviewRequest: (
    input: ReviewUpgradeRequestSubmitInput,
  ) => Promise<string | null>;
  onStatusFilterChange: (status: UpgradeRequestStatusFilter) => void;
  onTenantOnlyChange: (tenantOnly: boolean) => void;
  onRefresh: () => void;
}) {
  const canReviewRequests = canManagePlans(adminRole);

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.06em] text-[#5D7185]">
            Upgrade request review
          </p>
          <h2 className="mt-1 text-xl font-semibold">Tenant upgrade request queue</h2>
          <p className="mt-1 max-w-3xl text-sm text-[#5D7185]">
            Review queue for tenant upgrade requests. Review actions update request
            status only. Payment, checkout, and plan assignment are handled
            separately.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="dark">Status review</Badge>
          <Badge tone="warning">No payment action</Badge>
        </div>
      </div>

      {!canReviewRequests ? (
        <p className="mt-4 rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4 text-sm text-[#5D7185]">
          Upgrade request review is restricted to platform owner/admin roles.
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <SelectField
              label="Status filter"
              onChange={(value) =>
                onStatusFilterChange(value as UpgradeRequestStatusFilter)
              }
              value={statusFilter}
            >
              {upgradeRequestStatuses.map((status) => (
                <option key={status} value={status}>
                  {status === "all" ? "All statuses" : formatLabel(status)}
                </option>
              ))}
            </SelectField>

            <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm text-[#0B1F33]">
              <input
                checked={tenantOnly}
                className="h-4 w-4"
                disabled={!selectedTenantId}
                onChange={(event) => onTenantOnlyChange(event.target.checked)}
                type="checkbox"
              />
              <span>
                {selectedTenantId
                  ? `Show selected tenant only: ${selectedTenantName ?? "selected tenant"}`
                  : "Select a tenant to filter"}
              </span>
            </label>

            <Button onClick={onRefresh} type="button" variant="secondary">
              Refresh
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="light">{requests.length} requests</Badge>
            <Badge tone={tenantOnly ? "dark" : "light"}>
              {tenantOnly ? "Selected tenant" : "All tenants"}
            </Badge>
            <Badge tone="light">
              {statusFilter === "all" ? "All statuses" : formatLabel(statusFilter)}
            </Badge>
          </div>

          {error ? (
            <p className="mt-4 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-[#B91C1C]">
              Upgrade requests are currently unavailable: {error}
            </p>
          ) : null}

          <div className="mt-4 space-y-3">
            {!error && requests.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#D8E8F0] bg-white p-4 text-sm text-[#5D7185]">
                No upgrade requests yet. Tenant upgrade request UI has not been
                enabled.
              </p>
            ) : (
              requests.map((request) => (
                <UpgradeRequestCard
                  key={request.request_id || `${request.tenant_id}-${request.created_at}`}
                  canReview={canReviewRequests}
                  request={request}
                  saving={saving}
                  onReviewRequest={onReviewRequest}
                />
              ))
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function UpgradeRequestCard({
  canReview,
  request,
  saving,
  onReviewRequest,
}: {
  canReview: boolean;
  request: PlatformUpgradeRequest;
  saving: boolean;
  onReviewRequest: (
    input: ReviewUpgradeRequestSubmitInput,
  ) => Promise<string | null>;
}) {
  const assignment = request.current_assignment;
  const availableActions = reviewActionsForStatus(request.status);
  const isTerminal = upgradeReviewTerminalStatuses.has(request.status ?? "");
  const [selectedAction, setSelectedAction] =
    useState<ReviewUpgradeRequestStatus | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const noteRequired = selectedAction
    ? reviewActionRequiresNote(selectedAction)
    : false;
  const canSubmitReview =
    Boolean(selectedAction) &&
    confirmed &&
    !saving &&
    request.request_id.length > 0 &&
    (!noteRequired || reviewNote.trim().length > 0);

  const selectAction = (status: ReviewUpgradeRequestStatus) => {
    setSelectedAction(status);
    setConfirmed(false);
    setActionError(null);
  };

  const submitReview = async () => {
    if (!selectedAction) return;

    if (reviewActionRequiresNote(selectedAction) && !reviewNote.trim()) {
      setActionError("A review note is required for this action.");
      return;
    }

    const error = await onReviewRequest({
      request,
      reviewNote: reviewNote.trim() || null,
      status: selectedAction,
    });

    if (error) {
      setActionError(error);
      return;
    }

    setSelectedAction(null);
    setReviewNote("");
    setConfirmed(false);
    setActionError(null);
  };

  return (
    <div className="rounded-2xl border border-[#D8E8F0] bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="font-semibold">
            {request.tenant_name ?? "Unknown tenant"}
          </p>
          <p className="text-sm text-[#5D7185]">
            {request.tenant_slug ?? "no slug"} | Requested by{" "}
            {request.requested_by_email ?? "unknown requester"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={statusTone(request.status)}>{formatLabel(request.status)}</Badge>
          <Badge tone={request.metadata_present ? "warning" : "light"}>
            {request.metadata_present ? "Metadata present" : "No metadata"}
          </Badge>
          <Badge tone={request.decision_metadata_present ? "warning" : "light"}>
            {request.decision_metadata_present
              ? "Decision metadata"
              : "No decision metadata"}
          </Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <InfoPanel title="Requested plan">
          <InfoRow
            label="Plan"
            value={
              request.requested_plan_name
                ? `${request.requested_plan_name} (${request.requested_plan_code ?? "no code"})`
                : request.requested_plan_code ?? "Not set"
            }
          />
          <InfoRow label="Reason" value={request.reason ?? "Not provided"} />
          <InfoRow label="Created" value={toDisplayDate(request.created_at)} />
          <InfoRow label="Updated" value={toDisplayDate(request.updated_at)} />
        </InfoPanel>

        <InfoPanel title="Review status">
          <InfoRow label="Status" value={formatLabel(request.status)} />
          <InfoRow
            label="Reviewed by"
            value={request.reviewed_by_email ?? request.reviewed_by ?? "Not reviewed"}
          />
          <InfoRow label="Reviewed at" value={toDisplayDate(request.reviewed_at)} />
          <InfoRow label="Review note" value={request.review_note ?? "Not set"} />
          <InfoRow
            label="Decision metadata"
            value={request.decision_metadata_present ? "Present" : "Not present"}
          />
        </InfoPanel>

        <InfoPanel title="Current canonical assignment">
          <InfoRow label="Plan" value={assignment?.plan_code ?? "Not assigned"} />
          <InfoRow label="Status" value={formatLabel(assignment?.status)} />
          <InfoRow
            label="Payment status"
            value={formatLabel(assignment?.payment_status)}
          />
          <InfoRow label="Currency" value={assignment?.currency ?? "Not set"} />
          <InfoRow
            label="Billing cycle"
            value={formatLabel(assignment?.billing_cycle)}
          />
          <InfoRow
            label="Payment forced"
            value={booleanLabel(request.payment_forced)}
          />
          <InfoRow
            label="Gateway required"
            value={booleanLabel(request.gateway_required)}
          />
        </InfoPanel>
      </div>

      <div className="mt-4 rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#0B1F33]">
              Review action
            </p>
            <p className="mt-1 text-sm text-[#5D7185]">
              This only updates the request review status. It does not change the
              tenant plan, start checkout, charge money, or activate the payment
              gateway. Canonical assignment remains separate.
            </p>
          </div>
          <Badge tone={isTerminal ? "success" : "warning"}>
            {isTerminal ? "Terminal state" : "Reviewable"}
          </Badge>
        </div>

        {!canReview ? (
          <p className="mt-3 text-sm text-[#5D7185]">
            Review actions are restricted to platform owner/admin roles.
          </p>
        ) : isTerminal ? (
          <p className="mt-3 text-sm text-[#5D7185]">
            This request is {formatLabel(request.status)}. No further review
            actions are available.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {availableActions.map((status) => (
                <Button
                  key={status}
                  onClick={() => selectAction(status)}
                  type="button"
                  variant={selectedAction === status ? "primary" : "secondary"}
                >
                  {reviewActionLabel(status)}
                </Button>
              ))}
            </div>

            {selectedAction ? (
              <div className="mt-4 rounded-2xl border border-[#D8E8F0] bg-white p-4">
                <p className="text-sm font-semibold text-[#0B1F33]">
                  {reviewActionLabel(selectedAction)}
                </p>
                <p className="mt-1 text-sm text-[#5D7185]">
                  {selectedAction === "approved"
                    ? `Approving this request does not activate ${request.requested_plan_name ?? request.requested_plan_code ?? "the requested plan"} or change billing. Use canonical assignment controls separately if you decide to change the tenant plan.`
                    : "This action updates the request status only. It does not assign a plan or change billing."}
                </p>
                <ul className="mt-3 space-y-1 text-sm text-[#5D7185]">
                  <li>This only updates the request review status.</li>
                  <li>This does not change the tenant plan.</li>
                  <li>This does not start checkout.</li>
                  <li>This does not charge money.</li>
                  <li>Payment gateway remains inactive.</li>
                  <li>Canonical assignment remains separate.</li>
                </ul>

                <TextAreaField
                  label={
                    noteRequired
                      ? "Review note (required)"
                      : "Review note (optional)"
                  }
                  onChange={setReviewNote}
                  value={reviewNote}
                />

                <label className="mt-3 flex items-start gap-3 text-sm text-[#0B1F33]">
                  <input
                    checked={confirmed}
                    className="mt-1 h-4 w-4"
                    onChange={(event) => setConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    Confirm {reviewActionLabel(selectedAction).toLowerCase()} for{" "}
                    {request.tenant_name ?? "this tenant"}. No payment will be
                    charged. Checkout will not be enabled. Canonical assignment
                    will not be changed.
                  </span>
                </label>

                {actionError ? (
                  <p className="mt-3 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-[#B91C1C]">
                    {actionError}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    disabled={!canSubmitReview}
                    onClick={() => void submitReview()}
                    type="button"
                  >
                    Submit review status
                  </Button>
                  <Button
                    disabled={saving}
                    onClick={() => {
                      setSelectedAction(null);
                      setReviewNote("");
                      setConfirmed(false);
                      setActionError(null);
                    }}
                    type="button"
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function SubscriptionPanel({
  adminRole,
  form,
  plans,
  saving,
  selectedTenantId,
  setForm,
  onCaptureUsage,
  onSave,
}: {
  adminRole: PlatformAdminContext["role"];
  form: SubscriptionFormState;
  plans: PlatformSubscriptionPlan[];
  saving: boolean;
  selectedTenantId: string | null;
  setForm: React.Dispatch<React.SetStateAction<SubscriptionFormState>>;
  onCaptureUsage: () => void;
  onSave: () => void;
}) {
  const canEditBilling = canManageBilling(adminRole);
  const canCapture = canManagePlans(adminRole);

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Subscription & Billing Status</h2>
          <p className="text-sm text-[#5D7185]">
            This only updates platform subscription status. It does not charge money.
          </p>
        </div>
        <Badge tone={statusTone(form.paymentStatus)}>{formatLabel(form.paymentStatus)}</Badge>
      </div>

      {!canEditBilling ? (
        <p className="rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4 text-sm text-[#5D7185]">
          Your platform role can view tenant health but cannot update billing status.
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SelectField
              label="Plan"
              onChange={(value) => setForm((current) => ({ ...current, planId: value }))}
              value={form.planId}
            >
              <option value="">No plan</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} ({plan.code})
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Subscription status"
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  status: value as SubscriptionFormState["status"],
                }))
              }
              value={form.status}
            >
              {subscriptionStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatLabel(status)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Payment status"
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  paymentStatus: value as SubscriptionFormState["paymentStatus"],
                }))
              }
              value={form.paymentStatus}
            >
              {paymentStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatLabel(status)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Billing cycle"
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  billingCycle: value as SubscriptionFormState["billingCycle"],
                }))
              }
              value={form.billingCycle}
            >
              {["monthly", "yearly", "custom"].map((cycle) => (
                <option key={cycle} value={cycle}>
                  {formatLabel(cycle)}
                </option>
              ))}
            </SelectField>
            <InputField
              label="Amount"
              onChange={(value) => setForm((current) => ({ ...current, amount: value }))}
              type="number"
              value={form.amount}
            />
            <InputField
              label="Trial ends"
              onChange={(value) =>
                setForm((current) => ({ ...current, trialEndsAt: value }))
              }
              type="datetime-local"
              value={form.trialEndsAt}
            />
            <InputField
              label="Current period ends"
              onChange={(value) =>
                setForm((current) => ({ ...current, currentPeriodEnd: value }))
              }
              type="datetime-local"
              value={form.currentPeriodEnd}
            />
          </div>
          <TextAreaField
            label="Internal billing note"
            onChange={(value) => setForm((current) => ({ ...current, notes: value }))}
            value={form.notes}
          />
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          disabled={!selectedTenantId || saving || !canEditBilling}
          onClick={onSave}
          type="button"
        >
          Save subscription
        </Button>
        <Button
          disabled={!selectedTenantId || saving || !canCapture}
          onClick={onCaptureUsage}
          type="button"
          variant="secondary"
        >
          Capture usage snapshot
        </Button>
      </div>
    </Card>
  );
}

function SupportNotesPanel({
  adminRole,
  detail,
  form,
  saving,
  selectedTenantId,
  setForm,
  onRecord,
  onStatusChange,
}: {
  adminRole: PlatformAdminContext["role"];
  detail: PlatformTenantDetail | null;
  form: SupportFormState;
  saving: boolean;
  selectedTenantId: string | null;
  setForm: React.Dispatch<React.SetStateAction<SupportFormState>>;
  onRecord: () => void;
  onStatusChange: (noteId: string, status: string) => void;
}) {
  const canEditSupport = canManageSupport(adminRole);
  const counts = detail?.support_note_counts;

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Support Notes</h2>
      <p className="mt-1 text-sm text-[#5D7185]">
        Full notes stay in support tables and are not copied into activity metadata.
      </p>

      {!canEditSupport ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <SmallMetric label="Open" value={counts?.open ?? 0} />
          <SmallMetric label="In progress" value={counts?.in_progress ?? 0} />
          <SmallMetric label="Resolved" value={counts?.resolved ?? 0} />
          <SmallMetric label="Archived" value={counts?.archived ?? 0} />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Type"
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  noteType: value as SupportFormState["noteType"],
                }))
              }
              value={form.noteType}
            >
              {supportTypes.map((type) => (
                <option key={type} value={type}>
                  {formatLabel(type)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Status"
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  status: value as SupportFormState["status"],
                }))
              }
              value={form.status}
            >
              {supportStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatLabel(status)}
                </option>
              ))}
            </SelectField>
          </div>
          <TextAreaField
            label="Note"
            onChange={(value) => setForm((current) => ({ ...current, note: value }))}
            value={form.note}
          />
          <div className="mt-3">
            <Button
              disabled={!selectedTenantId || saving}
              onClick={onRecord}
              type="button"
            >
              Add support note
            </Button>
          </div>

          <div className="mt-5 space-y-3">
            {(detail?.support_notes ?? []).length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
                No support notes for this tenant.
              </p>
            ) : (
              (detail?.support_notes ?? []).map((note) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-white p-3"
                  key={note.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={statusTone(note.status)}>
                        {formatLabel(note.status)}
                      </Badge>
                      <Badge tone="light">{formatLabel(note.note_type)}</Badge>
                    </div>
                    <span className="text-xs text-[#5D7185]">
                      {toDisplayDate(note.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[#0B1F33]">{note.note}</p>
                  <SelectField
                    label="Update status"
                    onChange={(value) => onStatusChange(note.id, value)}
                    value={note.status}
                  >
                    {supportStatuses.map((status) => (
                      <option key={status} value={status}>
                        {formatLabel(status)}
                      </option>
                    ))}
                  </SelectField>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function PlanManagementPanel({
  adminRole,
  form,
  plans,
  saving,
  setForm,
  onLoadPlan,
  onReset,
  onSave,
}: {
  adminRole: PlatformAdminContext["role"];
  form: PlanFormState;
  plans: PlatformSubscriptionPlan[];
  saving: boolean;
  setForm: React.Dispatch<React.SetStateAction<PlanFormState>>;
  onLoadPlan: (plan: PlatformSubscriptionPlan) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const canEditPlans = canManagePlans(adminRole);

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Plan Management</h2>
      <p className="mt-1 text-sm text-[#5D7185]">
        Create, update, or archive plan records. Plans are never deleted here.
      </p>

      {!canEditPlans ? (
        <p className="mt-4 rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4 text-sm text-[#5D7185]">
          Your platform role can view plans but cannot manage the plan catalog.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField
              label="Code"
              onChange={(value) => setForm((current) => ({ ...current, code: value }))}
              value={form.code}
            />
            <InputField
              label="Name"
              onChange={(value) => setForm((current) => ({ ...current, name: value }))}
              value={form.name}
            />
            <InputField
              label="Monthly price"
              onChange={(value) =>
                setForm((current) => ({ ...current, monthlyPrice: value }))
              }
              type="number"
              value={form.monthlyPrice}
            />
            <InputField
              label="Yearly price"
              onChange={(value) =>
                setForm((current) => ({ ...current, yearlyPrice: value }))
              }
              type="number"
              value={form.yearlyPrice}
            />
            <InputField
              label="Max students"
              onChange={(value) =>
                setForm((current) => ({ ...current, maxStudents: value }))
              }
              type="number"
              value={form.maxStudents}
            />
            <InputField
              label="Max courses"
              onChange={(value) =>
                setForm((current) => ({ ...current, maxCourses: value }))
              }
              type="number"
              value={form.maxCourses}
            />
            <InputField
              label="Max team members"
              onChange={(value) =>
                setForm((current) => ({ ...current, maxTeamMembers: value }))
              }
              type="number"
              value={form.maxTeamMembers}
            />
            <InputField
              label="AI monthly limit"
              onChange={(value) =>
                setForm((current) => ({ ...current, aiMonthlyLimit: value }))
              }
              type="number"
              value={form.aiMonthlyLimit}
            />
            <InputField
              label="Marketing monthly limit"
              onChange={(value) =>
                setForm((current) => ({ ...current, marketingMonthlyLimit: value }))
              }
              type="number"
              value={form.marketingMonthlyLimit}
            />
            <SelectField
              label="Status"
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  status: value as PlanFormState["status"],
                }))
              }
              value={form.status}
            >
              {["active", "inactive", "archived"].map((status) => (
                <option key={status} value={status}>
                  {formatLabel(status)}
                </option>
              ))}
            </SelectField>
          </div>
          <TextAreaField
            label="Description"
            onChange={(value) =>
              setForm((current) => ({ ...current, description: value }))
            }
            value={form.description}
          />
          <div className="flex flex-wrap gap-3">
            <Button disabled={saving} onClick={onSave} type="button">
              Save plan
            </Button>
            <Button disabled={saving} onClick={onReset} type="button" variant="secondary">
              Clear form
            </Button>
          </div>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {plans.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
            No platform plans configured yet.
          </p>
        ) : (
          plans.slice(0, 8).map((plan) => (
            <div className="rounded-2xl border border-[#D8E8F0] bg-white p-3" key={plan.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{plan.name}</p>
                  <p className="text-sm text-[#5D7185]">{plan.code}</p>
                </div>
                <Badge tone={statusTone(plan.status)}>{formatLabel(plan.status)}</Badge>
              </div>
              <p className="mt-2 text-sm">
                {toCurrency(plan.monthly_price)} monthly /{" "}
                {toCurrency(plan.yearly_price)} yearly
              </p>
              {canEditPlans ? (
                <Button
                  className="mt-3"
                  onClick={() => onLoadPlan(plan)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Load for edit
                </Button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function PlatformActivityPanel({ activity }: { activity: PlatformActivity[] }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Platform Activity</h2>
          <p className="text-sm text-[#5D7185]">
            Safe platform metadata only. Notes, prompts, and private PII are excluded.
          </p>
        </div>
        <Badge tone="light">{activity.length} events</Badge>
      </div>

      <div className="mt-4 space-y-3">
        {activity.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
            No platform activity available for this view.
          </p>
        ) : (
          activity.slice(0, 12).map((event) => (
            <div className="rounded-2xl border border-[#D8E8F0] bg-white p-3" key={event.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge tone="light">{formatLabel(event.action)}</Badge>
                <span className="text-xs text-[#5D7185]">
                  {toDisplayDate(event.created_at)}
                </span>
              </div>
              <p className="mt-2 text-sm text-[#5D7185]">
                {event.entity_type ? formatLabel(event.entity_type) : "Platform event"}
              </p>
              <p className="mt-1 break-words text-xs text-[#5D7185]">
                {safeMetadataSummary(event.metadata_json)}
              </p>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function InfoPanel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="rounded-2xl border border-[#D8E8F0] bg-[#F8FBFD] p-4">
      <p className="text-sm font-semibold">{title}</p>
      <dl className="mt-3 space-y-2 text-sm text-[#5D7185]">{children}</dl>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-right text-[#0B1F33]">{value}</dd>
    </div>
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
  placeholder,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold text-[#0B1F33]">
      {label}
      <input
        className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm font-normal outline-none focus:border-[#145DA0]"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
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
