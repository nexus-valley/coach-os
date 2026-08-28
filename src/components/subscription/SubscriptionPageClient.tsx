"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import {
  getBillingSummary,
  type BillingProfile,
} from "@/src/lib/billing";
import {
  getBillingProfileMissingFieldLabels,
  getTenantBillingProfileCompletion,
  type TenantBillingProfileCompletion,
} from "@/src/lib/billingProfile";
import type { PlatformBillingDocument } from "@/src/lib/platformBillingDocuments";
import {
  formatResourceLimit,
  getPlanDefinition,
  getPlanDisplayName,
  getPlanLimits,
  normalizePlanKey,
  planOrder,
  planResourceLabels,
  type PlanKey,
  type PlanResource,
  type ResourceLimit,
} from "@/src/lib/plans";
import {
  getTenantSubscription,
  type SubscriptionPlan,
  type TenantSubscription,
} from "@/src/lib/subscription";
import {
  getTenantEntitlementState,
  getTenantRequestablePlanCatalog,
  getTenantUpgradeRequests,
  requestPlanUpgrade,
  type TenantEntitlementFeature,
  type TenantEntitlementLimit,
  type TenantEntitlementState,
  type TenantRequestablePlan,
  type TenantUpgradeRequest,
} from "@/src/lib/subscriptionEntitlements";
import type {
  BillingSubscription,
  SubscriptionAccessState,
} from "@/src/lib/subscriptions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { canAccessSubscription } from "@/src/lib/permissions";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import {
  getTrialStatus,
  getUsagePercent,
  refreshWorkspaceUsageSnapshot,
  type TrialStatus,
  type WorkspaceUsage,
} from "@/src/lib/usage";

type UsageCounts = WorkspaceUsage;

type BillingSummary = {
  accessState: SubscriptionAccessState;
  billingDocuments: PlatformBillingDocument[];
  billingProfile: BillingProfile;
  currentSubscriptionStatus: {
    billingCycle: "monthly" | "yearly";
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    provider: string;
    status: string;
  };
  planRecommendation: {
    reason: string;
    recommendedPlan: PlanKey;
    recommendedPlanName: string;
  } | null;
  subscription: BillingSubscription | null;
};

const plans: {
  description: string;
  plan: PlanKey;
  target: string;
}[] = planOrder.map((plan) => {
  const definition = getPlanDefinition(plan);

  return {
    description: definition.description,
    plan,
    target: definition.target,
  };
});

const emptyUsage: UsageCounts = {
  automations: 0,
  courses: 0,
  students: 0,
  team_members: 0,
  trainers: 0,
};

const planComparisonResources: PlanResource[] = [
  "students",
  "courses",
  "team_members",
  "trainers",
];

function formatPlan(plan: SubscriptionPlan) {
  return getPlanDisplayName(plan);
}

function normalizeBillingPlan(plan: string) {
  return normalizePlanKey(plan);
}

function formatStatus(value: string) {
  return value.replace("_", " ");
}

function formatCanonicalStatus(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "Not set";
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

function formatCurrency(value: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    currency,
    style: "currency",
  }).format(value);
}

function formatMinorCurrency(value: number, currency: string) {
  return formatCurrency(value / 100, currency);
}

function formatDocumentType(value: PlatformBillingDocument["document_type"]) {
  return value === "receipt" ? "Payment receipt" : "Invoice";
}

function formatLimit(limit: ResourceLimit) {
  return formatResourceLimit(limit);
}

function formatCanonicalLimit(value: number | string | null | undefined) {
  return value === null || typeof value === "undefined" ? "Unlimited" : String(value);
}

function booleanLabel(value: boolean | null | undefined) {
  return value ? "true" : "false";
}

function entitlementTone(value: string | null | undefined) {
  if (
    value === "approved" ||
    value === "included" ||
    value === "active" ||
    value === "trial"
  ) {
    return "success" as const;
  }

  if (
    value === "coming_soon" ||
    value === "in_review" ||
    value === "open" ||
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

function requestBlockingLabel(plan: TenantRequestablePlan) {
  if (plan.blocking_request_status === "approved") {
    return "Approved - waiting for CoachFort";
  }

  if (
    plan.blocking_request_status === "open" ||
    plan.blocking_request_status === "in_review" ||
    plan.has_open_request
  ) {
    return "Request already open/in review";
  }

  if (plan.has_blocking_request) {
    return "CoachFort follow-up pending";
  }

  return "Requestable";
}

function requestBlockingDescription(plan: TenantRequestablePlan) {
  if (plan.blocking_request_status === "approved") {
    return "CoachFort approved this request for follow-up. Your current plan and billing remain unchanged until the update is confirmed.";
  }

  if (
    plan.blocking_request_status === "open" ||
    plan.blocking_request_status === "in_review" ||
    plan.has_open_request
  ) {
    return "Request already open/in review for this plan.";
  }

  return "CoachFort is already reviewing this request.";
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function StatusBadge({ status }: { status: string }) {
  const active = status === "active" || status === "trialing";

  return (
    <Badge
      className={
        active
          ? "border-teal-400/30 bg-teal-400/10 text-teal-300"
          : "border-red-400/30 bg-red-500/10 text-red-200"
      }
    >
      {formatStatus(status)}
    </Badge>
  );
}

function BillingStatusBadge({ status }: { status: string }) {
  if (status === "active" || status === "paid" || status === "success") {
    return <Badge tone="success">{formatStatus(status)}</Badge>;
  }

  if (status === "trialing" || status === "draft" || status === "pending") {
    return <Badge tone="admin">{formatStatus(status)}</Badge>;
  }

  if (status === "past_due" || status === "overdue") {
    return <Badge tone="warning">{formatStatus(status)}</Badge>;
  }

  if (status === "canceled" || status === "expired" || status === "failed") {
    return <Badge tone="danger">{formatStatus(status)}</Badge>;
  }

  return <Badge>{formatStatus(status)}</Badge>;
}

function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#15181b] p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-semibold text-white">
        {value || "Not added"}
      </p>
    </div>
  );
}

function UsageCard({
  limit,
  resource,
  used,
}: {
  limit: ResourceLimit;
  resource: PlanResource;
  used: number;
}) {
  const percent = getUsagePercent(used, limit);
  const overLimit = limit !== "unlimited" && used > limit;
  const nearLimit = limit !== "unlimited" && !overLimit && percent >= 80;

  return (
    <Card className="border-white/10 bg-[#101214] p-5 text-white shadow-2xl shadow-black/10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-400">
            {planResourceLabels[resource]}
          </p>
          <p className="mt-3 text-2xl font-semibold">
            {used.toLocaleString()}{" "}
            <span className="text-base font-medium text-slate-500">
              / {formatLimit(limit)}
            </span>
          </p>
        </div>
        {overLimit ? (
          <Badge className="border-red-400/30 bg-red-500/10 text-red-200">
            Over limit
          </Badge>
        ) : nearLimit ? (
          <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">
            Near limit
          </Badge>
        ) : (
          <Badge className="border-white/10 bg-white/10 text-slate-300">
            Available
          </Badge>
        )}
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full"
          style={{
            backgroundColor: overLimit ? "#ef4444" : "var(--coachos-brand)",
            width: `${percent}%`,
          }}
        />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {limit === "unlimited"
          ? "No limit on this plan."
          : used < limit
            ? `${Math.max(0, limit - used).toLocaleString()} remaining on this plan.`
            : "Usage is at or above this plan limit."}
      </p>
    </Card>
  );
}

function BillingProfileReadinessCard({
  completion,
  error,
}: {
  completion: TenantBillingProfileCompletion | null;
  error: string | null;
}) {
  const score = completion?.completion_score ?? 0;
  const complete = completion?.is_complete === true;
  const missingLabels = getBillingProfileMissingFieldLabels(
    completion?.missing_fields ?? [],
  );

  return (
    <Card className="mt-6 border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <Badge
            className={
              complete
                ? "border-teal-400/30 bg-teal-400/10 text-teal-300"
                : "border-amber-400/30 bg-amber-400/10 text-amber-200"
            }
          >
            Billing profile
          </Badge>
          <h3 className="mt-4 text-2xl font-semibold">
            Invoice and receipt readiness
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Complete your legal, tax, and billing contact details before payment
            support and invoice workflows go live. This does not change your
            plan or record a payment.
          </p>
        </div>
        <Button href="/app/billing-profile" type="button" variant="secondary">
          Open billing profile
        </Button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
          <p className="text-sm text-slate-500">Readiness score</p>
          <p className="mt-2 text-3xl font-semibold">{score}%</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {complete
              ? "Required billing profile fields are ready."
              : "Some billing profile fields are still missing."}
          </p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
          <p className="text-sm font-semibold text-white">Missing fields</p>
          {error ? (
            <p className="mt-3 text-sm leading-6 text-amber-100">
              Billing profile readiness is currently unavailable: {error}
            </p>
          ) : missingLabels.length === 0 ? (
            <p className="mt-3 text-sm leading-6 text-slate-400">
              No required readiness fields are missing.
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {missingLabels.map((label) => (
                <Badge
                  className="border-amber-400/30 bg-amber-400/10 text-amber-200"
                  key={label}
                >
                  {label}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function PaymentGatewayParkedCard() {
  return (
    <Card className="mt-6 border-amber-400/30 bg-amber-400/10 p-5 text-amber-50">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <Badge className="border-amber-300/30 bg-amber-300/10 text-amber-100">
            Online payment unavailable
          </Badge>
          <h3 className="mt-4 text-2xl font-semibold">
            Online plan payment is not available yet
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-100/85">
            You can review your current plan, usage, billing profile, and plan
            requests here. CoachFort support will confirm any plan change
            separately until online subscription payment is ready.
          </p>
        </div>
        <Button href="/payment-policy" type="button" variant="secondary">
          Payment policy
        </Button>
      </div>
    </Card>
  );
}

function CanonicalEntitlementSummary({
  entitlement,
  error,
}: {
  entitlement: TenantEntitlementState | null;
  error: string | null;
}) {
  const assignment = entitlement?.assignment ?? null;
  const keyFeatureKeys = [
    "payment_gateway",
    "live_classes",
    "students",
    "courses",
    "document_uploads",
    "ai_assistant",
  ];
  const keyFeatures = keyFeatureKeys.map((featureKey) => ({
    feature:
      entitlement?.features.find((item) => item.feature_key === featureKey) ?? null,
    featureKey,
  }));
  const usageEntries = entitlement
    ? Object.entries(entitlement.latest_usage).filter(([, value]) => value !== null)
    : [];
  const visibleLimits = entitlement?.limits ?? [];

  return (
    <Card className="mt-6 border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            Plan details
          </Badge>
          <h3 className="mt-4 text-2xl font-semibold">
            Plan access and usage
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            This read-only summary shows your current plan access, usage, and
            limits. It cannot change billing or workspace access.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="border-white/15 bg-white/10 text-white">Read-only</Badge>
          <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">
            No plan change
          </Badge>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
          Detailed plan access is currently unavailable. Your current plan
          summary remains unchanged.
        </div>
      ) : null}

      {!entitlement ? (
        <div className="mt-5 rounded-3xl border border-white/10 bg-[#15181b] p-5 text-sm leading-6 text-slate-400">
          Detailed plan access is not available yet. The current subscription
          summary above remains your plan reference.
        </div>
      ) : (
        <div className="mt-6 grid gap-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ReadOnlyField label="Plan" value={assignment?.plan_code ?? ""} />
            <ReadOnlyField label="Status" value={formatCanonicalStatus(assignment?.status)} />
            <ReadOnlyField
              label="Payment status"
              value={formatCanonicalStatus(assignment?.payment_status)}
            />
            <ReadOnlyField label="Currency" value={assignment?.currency ?? ""} />
            <ReadOnlyField
              label="Billing cycle"
              value={formatCanonicalStatus(assignment?.billing_cycle)}
            />
            <ReadOnlyField
              label="Payment required"
              value={booleanLabel(entitlement.payment_forced)}
            />
            <ReadOnlyField
              label="Online payment required"
              value={booleanLabel(entitlement.gateway_required)}
            />
            <ReadOnlyField
              label="Warnings"
              value={entitlement.warnings.length.toString()}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
              <p className="text-sm font-semibold text-white">Latest usage</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {usageEntries.length === 0 ? (
                  <p className="text-sm text-slate-400">No usage summary is available yet.</p>
                ) : (
                  usageEntries.slice(0, 10).map(([key, value]) => (
                    <CanonicalInfoRow
                      key={key}
                      label={formatCanonicalStatus(key)}
                      value={String(value)}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
              <p className="text-sm font-semibold text-white">Usage limits</p>
              <div className="mt-4 space-y-3">
                {visibleLimits.length === 0 ? (
                  <p className="text-sm text-slate-400">No plan limits are available yet.</p>
                ) : (
                  visibleLimits.map((limit, index) => (
                    <CanonicalLimitRow
                      key={limit.resource_key ?? `limit-${index}`}
                      limit={limit}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {entitlement.warnings.length > 0 ? (
            <div className="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-5 text-amber-100">
              <p className="text-sm font-semibold">Usage warnings</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {entitlement.warnings.map((warning, index) => (
                  <CanonicalInfoRow
                    key={`${String(warning.resource_key ?? "warning")}-${index}`}
                    label={formatCanonicalStatus(String(warning.resource_key ?? "Warning"))}
                    value={`${String(warning.current_usage ?? "0")} / ${formatCanonicalLimit(
                      warning.limit_value as number | string | null | undefined,
                    )}`}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
            <p className="text-sm font-semibold text-white">Key feature statuses</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {keyFeatures.map(({ feature, featureKey }) => (
                <CanonicalFeatureRow
                  feature={feature}
                  featureKey={featureKey}
                  key={featureKey}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function CanonicalInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#101214] p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-2 break-words text-sm font-semibold text-white">
        {value || "Not set"}
      </p>
    </div>
  );
}

function CanonicalLimitRow({ limit }: { limit: TenantEntitlementLimit }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#101214] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">
            {formatCanonicalStatus(limit.resource_key)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Base {formatCanonicalLimit(limit.base_limit_value)}
            {limit.override_type
              ? ` | ${formatCanonicalStatus(limit.override_type)}`
              : ""}
          </p>
        </div>
        <Badge tone={entitlementTone(limit.enforcement_mode)}>
          {formatCanonicalStatus(limit.enforcement_mode)}
        </Badge>
      </div>
      <p className="mt-3 text-xl font-semibold text-white">
        {formatCanonicalLimit(limit.limit_value)}
      </p>
    </div>
  );
}

function CanonicalFeatureRow({
  feature,
  featureKey,
}: {
  feature: TenantEntitlementFeature | null;
  featureKey: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#101214] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-semibold text-white">
          {formatCanonicalStatus(featureKey)}
        </p>
        <Badge tone={entitlementTone(feature?.effective_status)}>
          {formatCanonicalStatus(feature?.effective_status ?? "not configured")}
        </Badge>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        This feature follows your current plan settings.
      </p>
    </div>
  );
}

function RequestPlanUpgradePanel({
  error,
  onSubmit,
  plans,
  submitError,
  submitSuccess,
  submitting,
}: {
  error: string | null;
  onSubmit: (input: {
    reason: string;
    requestedPlanCode: string;
  }) => Promise<boolean>;
  plans: TenantRequestablePlan[];
  submitError: string | null;
  submitSuccess: string | null;
  submitting: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [selectedPlanCode, setSelectedPlanCode] = useState("");
  const selectedPlan =
    plans.find((plan) => plan.plan_code === selectedPlanCode) ?? null;
  const blockingPlans = plans.filter((plan) => plan.has_blocking_request);
  const submitDisabled =
    submitting ||
    !selectedPlan ||
    selectedPlan.has_blocking_request ||
    reason.trim().length === 0 ||
    !confirmed;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitDisabled || !selectedPlan) {
      return;
    }

    const submitted = await onSubmit({
      reason: reason.trim(),
      requestedPlanCode: selectedPlan.plan_code,
    });

    if (submitted) {
      setConfirmed(false);
      setReason("");
      setSelectedPlanCode("");
    }
  }

  return (
    <Card className="mt-6 border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            Request plan upgrade
          </Badge>
          <h3 className="mt-4 text-2xl font-semibold">
            Ask CoachFort to review a plan change
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            This sends a review request only. Your current plan, payment status,
            and workspace access stay unchanged until CoachFort confirms a
            separate plan update.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="border-white/15 bg-white/10 text-white">
            Request only
          </Badge>
          <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">
            No plan change
          </Badge>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
          Plan requests are currently unavailable. Try again later or contact
          CoachFort support.
        </div>
      ) : null}

      {!error && plans.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-white/10 bg-[#15181b] p-5 text-sm leading-6 text-slate-400">
          Available plan requests are still being prepared.
        </div>
      ) : null}

      {!error && plans.length > 0 ? (
        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          <div>
            <label
              className="text-sm font-semibold text-white"
              htmlFor="requested-plan"
            >
              Requested plan
            </label>
            <select
              className="mt-2 w-full rounded-2xl border border-white/10 bg-[#15181b] px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ECBEA]"
              id="requested-plan"
              onChange={(event) => {
                setSelectedPlanCode(event.target.value);
                setConfirmed(false);
              }}
              value={selectedPlanCode}
            >
              <option value="">Select a requestable plan</option>
              {plans.map((plan) => (
                <option
                  disabled={plan.has_blocking_request}
                  key={plan.plan_code}
                  value={plan.plan_code}
                >
                  {plan.plan_name ?? plan.plan_code}
                  {plan.has_blocking_request
                    ? ` - ${requestBlockingLabel(plan)}`
                    : ""}
                </option>
              ))}
            </select>
          </div>

          {blockingPlans.length > 0 ? (
            <div className="space-y-3">
              {blockingPlans.map((plan) => (
                <div
                  className="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100"
                  key={plan.plan_code}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold">
                        {plan.plan_name ?? plan.plan_code}:{" "}
                        {requestBlockingLabel(plan)}
                      </p>
                      <p className="mt-1">{requestBlockingDescription(plan)}</p>
                    </div>
                    <Badge tone="warning">
                      {formatCanonicalStatus(plan.blocking_request_status)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {selectedPlan ? (
            <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {selectedPlan.request_label ??
                      `Request ${selectedPlan.plan_name ?? selectedPlan.plan_code}`}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {selectedPlan.request_description ??
                      "Request access to this plan. CoachFort review is required before any plan change."}
                  </p>
                </div>
                <Badge tone={selectedPlan.has_blocking_request ? "warning" : "success"}>
                  {requestBlockingLabel(selectedPlan)}
                </Badge>
              </div>
              {selectedPlan.has_blocking_request ? (
                <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
                  {requestBlockingDescription(selectedPlan)}
                </p>
              ) : null}
              {selectedPlan.blocking_request_status === "approved" ? (
                <div className="mt-4 rounded-2xl border border-teal-400/30 bg-teal-400/10 p-4 text-sm leading-6 text-teal-100">
                  <p className="font-semibold">
                    Approved - waiting for CoachFort confirmation.
                  </p>
                  <p className="mt-1">
                    Approval does not activate the requested plan or change
                    billing. Keep using the current plan shown above until
                    CoachFort confirms the update.
                  </p>
                  {selectedPlan.latest_reviewed_at ? (
                    <p className="mt-2 text-teal-200">
                      Reviewed {formatDate(selectedPlan.latest_reviewed_at)}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <label className="text-sm font-semibold text-white" htmlFor="request-reason">
              Reason or use case
            </label>
            <textarea
              className="mt-2 min-h-32 w-full rounded-2xl border border-white/10 bg-[#15181b] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-600 focus:border-[#2ECBEA]"
              id="request-reason"
              maxLength={1200}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Share why this plan is needed, expected growth, or any setup context for CoachFort review."
              value={reason}
            />
            <p className="mt-2 text-xs text-slate-500">
              {reason.trim().length}/1200 characters
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-3xl border border-white/10 bg-[#15181b] p-4 text-sm leading-6 text-slate-300">
            <input
              checked={confirmed}
              className="mt-1 h-4 w-4 rounded border-white/20 bg-[#101214]"
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              I understand this only sends a request. It does not change the
              plan, record a payment, or change workspace access.
            </span>
          </label>

          {submitError ? (
            <div className="rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
              {submitError}
            </div>
          ) : null}

          {submitSuccess ? (
            <div className="rounded-3xl border border-teal-400/30 bg-teal-400/10 p-4 text-sm leading-6 text-teal-100">
              {submitSuccess}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={submitDisabled} type="submit">
              {submitting ? "Sending request..." : "Submit upgrade request"}
            </Button>
            <p className="text-sm text-slate-500">
              Your current plan and billing remain unchanged.
            </p>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function UpgradeRequestStatusPanel({
  error,
  requests,
}: {
  error: string | null;
  requests: TenantUpgradeRequest[];
}) {
  return (
    <Card className="mt-6 border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            Upgrade request status
          </Badge>
          <h3 className="mt-4 text-2xl font-semibold">Plan upgrade request history</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Review earlier plan requests and their current status. This section
            cannot submit a request or change your plan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="border-white/15 bg-white/10 text-white">Read-only</Badge>
          <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">
            No plan change
          </Badge>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
          Plan request history is currently unavailable. Try again later or
          contact CoachFort support.
        </div>
      ) : null}

      {!error && requests.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-white/10 bg-[#15181b] p-5 text-sm leading-6 text-slate-400">
          No plan requests have been submitted yet.
        </div>
      ) : null}

      {!error && requests.length > 0 ? (
        <div className="mt-5 space-y-4">
          {requests.map((request) => (
            <UpgradeRequestHistoryCard
              key={request.request_id || `${request.requested_plan_code}-${request.created_at}`}
              request={request}
            />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function UpgradeRequestHistoryCard({
  request,
}: {
  request: TenantUpgradeRequest;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-sm text-slate-500">Requested plan</p>
          <p className="mt-1 text-lg font-semibold text-white">
            {request.requested_plan_name
              ? `${request.requested_plan_name} (${request.requested_plan_code ?? "no code"})`
              : request.requested_plan_code ?? "Not set"}
          </p>
        </div>
        <Badge tone={entitlementTone(request.status)}>
          {formatCanonicalStatus(request.status)}
        </Badge>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ReadOnlyField label="Reason" value={request.reason ?? ""} />
        <ReadOnlyField label="Created" value={formatDate(request.created_at)} />
        <ReadOnlyField label="Updated" value={formatDate(request.updated_at)} />
        <ReadOnlyField
          label="Reviewed at"
          value={formatDate(request.reviewed_at)}
        />
        <ReadOnlyField
          label="Review note"
          value={request.review_note ?? ""}
        />
        <ReadOnlyField
          label="Plan updated"
          value={booleanLabel(request.entitlement_changed)}
        />
        <ReadOnlyField
          label="Online payment started"
          value={booleanLabel(request.payment_gateway_called)}
        />
      </div>

      {request.status === "approved" ? (
        <div className="mt-5 rounded-3xl border border-teal-400/30 bg-teal-400/10 p-4 text-sm leading-6 text-teal-100">
          Approved for CoachFort follow-up only. Your requested plan and billing
          remain unchanged until CoachFort confirms the update.
        </div>
      ) : null}
    </div>
  );
}

export function SubscriptionPageClient() {
  const router = useRouter();
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(
    null,
  );
  const [billingProfileCompletion, setBillingProfileCompletion] =
    useState<TenantBillingProfileCompletion | null>(null);
  const [billingProfileCompletionError, setBillingProfileCompletionError] =
    useState<string | null>(null);
  const [canonicalEntitlementError, setCanonicalEntitlementError] =
    useState<string | null>(null);
  const [canonicalEntitlementState, setCanonicalEntitlementState] =
    useState<TenantEntitlementState | null>(null);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] =
    useState<TenantSubscription | null>(null);
  const [selectedBillingDocument, setSelectedBillingDocument] =
    useState<PlatformBillingDocument | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [trialStatus, setTrialStatus] = useState<TrialStatus | null>(null);
  const [requestablePlanError, setRequestablePlanError] = useState<string | null>(
    null,
  );
  const [requestablePlans, setRequestablePlans] = useState<TenantRequestablePlan[]>([]);
  const [upgradeRequestError, setUpgradeRequestError] = useState<string | null>(
    null,
  );
  const [upgradeRequests, setUpgradeRequests] = useState<TenantUpgradeRequest[]>([]);
  const [upgradeRequestSubmitError, setUpgradeRequestSubmitError] =
    useState<string | null>(null);
  const [upgradeRequestSubmitSuccess, setUpgradeRequestSubmitSuccess] =
    useState<string | null>(null);
  const [upgradeRequestSubmitting, setUpgradeRequestSubmitting] = useState(false);
  const [usage, setUsage] = useState<UsageCounts>(emptyUsage);

  const limits = useMemo(
    () => getPlanLimits(subscription?.plan ?? "free"),
    [subscription?.plan],
  );
  const billingCycle =
    billingSummary?.currentSubscriptionStatus.billingCycle ?? "monthly";
  const billingProfile = billingSummary?.billingProfile;

  useEffect(() => {
    if (!selectedBillingDocument) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedBillingDocument(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedBillingDocument]);

  useEffect(() => {
    let active = true;

    async function loadSubscription() {
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

        if (!user) {
          router.replace("/login");
          return;
        }

        const role = await getCurrentMemberRole(currentTenant.id, user.id);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setCurrentRole(role);

        if (!canAccessSubscription(role)) {
          return;
        }

        const [
          currentSubscription,
          currentUsage,
          currentBillingSummary,
          canonicalEntitlementResult,
          billingProfileCompletionResult,
          requestablePlanResult,
          upgradeRequestResult,
        ] = await Promise.all([
          getTenantSubscription(currentTenant.id),
          refreshWorkspaceUsageSnapshot(currentTenant.id),
          getBillingSummary(currentTenant.id),
          getTenantEntitlementState(currentTenant.id)
            .then((data) => ({ data, error: null }))
            .catch((caught: unknown) => ({
              data: null,
              error: getErrorMessage(
                caught,
                "Unable to load detailed plan access.",
              ),
            })),
          getTenantBillingProfileCompletion(currentTenant.id)
            .then((data) => ({ data, error: null }))
            .catch((caught: unknown) => ({
              data: null,
              error: getErrorMessage(
                caught,
                "Unable to load billing profile readiness.",
              ),
            })),
          getTenantRequestablePlanCatalog(currentTenant.id)
            .then((data) => ({ data, error: null }))
            .catch((caught: unknown) => ({
              data: [],
              error: getErrorMessage(
                caught,
                "Unable to load requestable plans.",
              ),
            })),
          getTenantUpgradeRequests({ tenantId: currentTenant.id })
            .then((data) => ({ data, error: null }))
            .catch((caught: unknown) => ({
              data: [],
              error: getErrorMessage(
                caught,
                "Unable to load upgrade request history.",
              ),
            })),
        ]);
        const currentTrialStatus = await getTrialStatus(currentTenant.id);

        if (!active) {
          return;
        }

        setSubscription(currentSubscription);
        setBillingSummary(currentBillingSummary);
        setBillingProfileCompletion(billingProfileCompletionResult.data);
        setBillingProfileCompletionError(billingProfileCompletionResult.error);
        setCanonicalEntitlementError(canonicalEntitlementResult.error);
        setCanonicalEntitlementState(canonicalEntitlementResult.data);
        setRequestablePlanError(requestablePlanResult.error);
        setRequestablePlans(requestablePlanResult.data);
        setUpgradeRequestError(upgradeRequestResult.error);
        setUpgradeRequests(upgradeRequestResult.data);
        setTrialStatus(currentTrialStatus);
        setUsage(currentUsage);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load subscription."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadSubscription();

    return () => {
      active = false;
    };
  }, [router]);

  async function handleUpgradeRequestSubmit({
    reason,
    requestedPlanCode,
  }: {
    reason: string;
    requestedPlanCode: string;
  }): Promise<boolean> {
    if (!tenant) {
      setUpgradeRequestSubmitError("Workspace context is not available.");
      return false;
    }

    setUpgradeRequestSubmitting(true);
    setUpgradeRequestSubmitError(null);
    setUpgradeRequestSubmitSuccess(null);

    try {
      await requestPlanUpgrade({
        reason,
        requestedPlanCode,
        tenantId: tenant.id,
      });

      const [nextRequests, nextRequestablePlans] = await Promise.all([
        getTenantUpgradeRequests({ tenantId: tenant.id }),
        getTenantRequestablePlanCatalog(tenant.id),
      ]);

      setUpgradeRequests(nextRequests);
      setUpgradeRequestError(null);
      setRequestablePlans(nextRequestablePlans);
      setRequestablePlanError(null);
      setUpgradeRequestSubmitSuccess(
        "Plan request sent for CoachFort review. Your current plan and billing remain unchanged.",
      );
      return true;
    } catch (caught) {
      setUpgradeRequestSubmitError(
        getErrorMessage(caught, "Unable to submit upgrade request."),
      );
      return false;
    } finally {
      setUpgradeRequestSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-white/10 bg-[#101214]">
          <span className="sr-only">Loading subscription</span>
        </Card>
      </div>
    );
  }

  if (currentRole && !canAccessSubscription(currentRole)) {
    return (
      <div className="mx-auto max-w-7xl">
        <AccessDeniedCard description="Subscription and billing controls are available to workspace owners only." />
      </div>
    );
  }

  if (error || !subscription) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-red-400/30 bg-red-500/10 p-6 text-red-100">
          {error || "Subscription is not available for this workspace."}
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        actions={<StatusBadge status={subscription.subscription_status} />}
        description="Review your CoachFort plan, usage, billing profile, and plan request status. Online subscription payment is not available yet."
        eyebrow="CoachFort plan"
        title="Plan & usage"
      />

      <Card className="mt-6 border-teal-400/30 bg-teal-400/10 p-5 text-teal-50">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">
              Plan changes require CoachFort review.
            </p>
            <p className="mt-2 text-sm leading-6 text-teal-100/80">
              Use the plan request section below or contact CoachFort support.
              Your current plan remains active until a change is confirmed.
            </p>
          </div>
          <Button href="/app/billing-profile" type="button" variant="secondary">
            Open billing profile
          </Button>
        </div>
      </Card>

      <BillingProfileReadinessCard
        completion={billingProfileCompletion}
        error={billingProfileCompletionError}
      />

      <CanonicalEntitlementSummary
        entitlement={canonicalEntitlementState}
        error={canonicalEntitlementError}
      />

      <PaymentGatewayParkedCard />

      <RequestPlanUpgradePanel
        error={requestablePlanError}
        onSubmit={handleUpgradeRequestSubmit}
        plans={requestablePlans}
        submitError={upgradeRequestSubmitError}
        submitSuccess={upgradeRequestSubmitSuccess}
        submitting={upgradeRequestSubmitting}
      />

      <UpgradeRequestStatusPanel
        error={upgradeRequestError}
        requests={upgradeRequests}
      />

      <section className="mt-8 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <p className="text-sm font-medium text-slate-400">
            Current workspace
          </p>
          <h3 className="mt-3 text-2xl font-semibold">
            {tenant?.name ?? subscription.name}
          </h3>
          <div className="mt-6 rounded-3xl border border-white/10 bg-[#15181b] p-5">
            <p className="text-sm font-semibold text-slate-400">
              Current plan
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-4xl font-semibold">
                {formatPlan(subscription.plan)}
              </span>
              <StatusBadge status={subscription.subscription_status} />
            </div>
            <div className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-slate-500">Started</p>
                <p className="mt-1 font-semibold text-white">
                  {formatDate(subscription.plan_started_at)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Renews</p>
                <p className="mt-1 font-semibold text-white">
                  {formatDate(subscription.plan_renews_at)}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
            Online plan payment is not available yet.
          </div>
          <div className="mt-5 rounded-3xl border border-white/10 bg-[#15181b] p-5 text-sm leading-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold text-white">Trial status</p>
              <Badge
                className={
                  trialStatus?.active
                    ? "border-teal-400/30 bg-teal-400/10 text-teal-300"
                    : "border-amber-400/30 bg-amber-400/10 text-amber-200"
                }
              >
                {trialStatus?.active
                  ? `${trialStatus.daysRemaining} days left`
                  : trialStatus?.expired
                    ? "Expired"
                    : "Not active"}
              </Badge>
            </div>
            <p className="mt-3 text-slate-400">
              Trial ends: {formatDate(trialStatus?.endsAt ?? null)}
            </p>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(limits) as PlanResource[]).map((resource) => (
            <UsageCard
              key={resource}
              limit={limits[resource]}
              resource={resource}
              used={usage[resource]}
            />
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
                Subscription status
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                CoachFort billing
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Review the current plan, billing cycle, payment status, and
                renewal information recorded for this workspace.
              </p>
            </div>
            {billingSummary ? (
              <BillingStatusBadge status={billingSummary.accessState} />
            ) : null}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
              <p className="text-sm text-slate-500">Billing plan</p>
              <p className="mt-2 text-xl font-semibold">
                {billingSummary?.subscription
                  ? formatPlan(
                      normalizeBillingPlan(
                        billingSummary.subscription.plan_code,
                      ),
                    )
                  : formatPlan(subscription.plan)}
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
              <p className="text-sm text-slate-500">Billing cycle</p>
              <p className="mt-2 text-xl font-semibold">
                {billingSummary?.subscription?.billing_cycle ?? "monthly"}
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
              <p className="text-sm text-slate-500">Provider</p>
              <p className="mt-2 text-xl font-semibold">
                {formatStatus(
                  billingSummary?.currentSubscriptionStatus.provider ??
                    "manual",
                )}
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
              <p className="text-sm text-slate-500">Current period ends</p>
              <p className="mt-2 text-xl font-semibold">
                {formatDate(
                  billingSummary?.currentSubscriptionStatus.currentPeriodEnd ??
                    billingSummary?.subscription?.renewal_at ??
                    null,
                )}
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
              <p className="text-sm text-slate-500">Amount</p>
              <p className="mt-2 text-xl font-semibold">
                {formatCurrency(
                  billingSummary?.subscription?.amount ?? 0,
                  billingSummary?.subscription?.currency ?? "INR",
                )}
              </p>
            </div>
          </div>
          {billingSummary?.planRecommendation ? (
            <div className="mt-5 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
              {billingSummary.planRecommendation.reason} Recommended next plan:{" "}
              <span className="font-semibold">
                {billingSummary.planRecommendation.recommendedPlanName}
              </span>
              .
            </div>
          ) : null}
        </Card>

        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Billing profile
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Workspace billing details
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                These details are read-only for tenant users. Contact platform
                support or your platform admin to update subscription billing
                records.
              </p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <ReadOnlyField
              label="Billing email"
              value={billingProfile?.billingEmail ?? ""}
            />
            <ReadOnlyField
              label="Tax registration"
              value={
                billingProfile?.taxRegistrationType === "NONE"
                  ? ""
                  : billingProfile?.taxRegistrationType ?? ""
              }
            />
            <ReadOnlyField
              label="Tax registration ID"
              value={billingProfile?.taxRegistrationId ?? ""}
            />
            <ReadOnlyField
              label="Billing currency"
              value={billingProfile?.billingCurrency ?? ""}
            />
            <ReadOnlyField
              label="Address line 1"
              value={billingProfile?.billingAddress.line1 ?? ""}
            />
            <ReadOnlyField
              label="Address line 2"
              value={billingProfile?.billingAddress.line2 ?? ""}
            />
            <ReadOnlyField
              label="City"
              value={billingProfile?.billingAddress.city ?? ""}
            />
            <ReadOnlyField
              label="State"
              value={billingProfile?.billingAddress.state ?? ""}
            />
            <ReadOnlyField
              label="Country"
              value={billingProfile?.billingAddress.country ?? ""}
            />
            <ReadOnlyField
              label="Postal code"
              value={billingProfile?.billingAddress.postalCode ?? ""}
            />
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-400">
              Status:{" "}
              {formatStatus(
                billingSummary?.billingProfile.billingStatus ??
                  "not_configured",
              )}
            </p>
            <p className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold uppercase text-slate-400">
              Platform-managed
            </p>
          </div>
        </Card>
      </section>

      <section className="mt-8">
        <Card className="overflow-hidden border-white/10 bg-[#101214] text-white shadow-2xl shadow-black/10">
          <div className="flex flex-col justify-between gap-4 border-b border-white/10 p-6 sm:flex-row sm:items-center">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                CoachFort billing
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">Billing documents</h3>
              <p className="mt-2 text-sm text-slate-400">
                Subscription invoices and payment receipts issued by CoachFort.
              </p>
            </div>
            <p className="text-sm text-slate-400">
              {billingSummary?.billingDocuments.length ?? 0} records
            </p>
          </div>
          {!billingSummary || billingSummary.billingDocuments.length === 0 ? (
            <div className="p-8 text-center" role="status">
              <p className="font-semibold">No billing documents yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
                Your CoachFort invoices and payment receipts will appear here.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-4">Document</th>
                      <th className="px-5 py-4">Date</th>
                      <th className="px-5 py-4">Amount</th>
                      <th className="px-5 py-4">Status</th>
                      <th className="px-5 py-4">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {billingSummary.billingDocuments.map((document) => (
                      <tr key={`${document.document_type}-${document.id}`}>
                        <td className="px-5 py-4">
                          <p className="font-semibold">
                            {document.document_number}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatDocumentType(document.document_type)}
                            {document.plan_name ? ` - ${document.plan_name}` : ""}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-slate-400">
                          {formatDate(document.issued_at)}
                        </td>
                        <td className="px-5 py-4 font-semibold">
                          {formatMinorCurrency(
                            document.total_amount_minor,
                            document.currency,
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <BillingStatusBadge status={document.status} />
                        </td>
                        <td className="px-5 py-4">
                          <Button
                            aria-label={`View ${formatDocumentType(document.document_type).toLowerCase()} ${document.document_number}`}
                            onClick={() => setSelectedBillingDocument(document)}
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-white/10 md:hidden">
                {billingSummary.billingDocuments.map((document) => (
                  <div
                    className="space-y-4 p-5"
                    key={`${document.document_type}-${document.id}-mobile`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase text-slate-500">
                          Document
                        </p>
                        <p className="mt-1 break-words font-semibold">
                          {document.document_number}
                        </p>
                        <p className="mt-1 text-sm text-slate-400">
                          {formatDocumentType(document.document_type)}
                          {document.plan_name ? ` - ${document.plan_name}` : ""}
                        </p>
                      </div>
                      <BillingStatusBadge status={document.status} />
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-xs uppercase text-slate-500">Date</p>
                        <p className="mt-1">{formatDate(document.issued_at)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-slate-500">Amount</p>
                        <p className="mt-1 font-semibold">
                          {formatMinorCurrency(
                            document.total_amount_minor,
                            document.currency,
                          )}
                        </p>
                      </div>
                    </div>
                    <Button
                      aria-label={`View ${formatDocumentType(document.document_type).toLowerCase()} ${document.document_number}`}
                      className="min-h-11 w-full"
                      onClick={() => setSelectedBillingDocument(document)}
                      type="button"
                      variant="secondary"
                    >
                      View document
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </section>

      <section className="mt-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h3 className="text-2xl font-semibold text-white">
              Plan comparison
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Compare available plan limits. Ask CoachFort support to review a
              plan change.
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
              Prices may be subject to applicable taxes. Starter and Growth
              plan changes require CoachFort confirmation. Premium remains
              contact-sales and is not available for self-service selection.{" "}
              <Link
                className="font-semibold text-sky-300 underline-offset-4 transition hover:text-white hover:underline"
                href="/payment-policy"
              >
                Review the payment policy
              </Link>
            </p>
          </div>
          <p className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-slate-300">
            CoachFort-reviewed
          </p>
        </div>
        <p className="mt-5 text-sm font-semibold uppercase text-slate-500">
          Showing {billingCycle} billing
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((planOption) => {
            const planOptionLimits = getPlanLimits(planOption.plan);
            const currentPlan = planOption.plan === subscription.plan;
            const definition = getPlanDefinition(planOption.plan);
            const manualLimits = definition.manualLimits;
            const price = definition.billing[billingCycle];

            return (
              <Card
                className={[
                  "flex flex-col border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10",
                  currentPlan ? "ring-2 ring-[var(--coachos-brand)]" : "",
                ].join(" ")}
                key={planOption.plan}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-xl font-semibold">
                      {formatPlan(planOption.plan)}
                    </h4>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {planOption.description}
                    </p>
                  </div>
                  {currentPlan ? (
                    <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
                      Current
                    </Badge>
                  ) : null}
                </div>

                <p className="mt-5 text-sm font-semibold text-slate-300">
                  {planOption.target}
                </p>
                <div className="mt-5">
                  <p className="text-3xl font-semibold">
                    {price === null
                      ? "Custom"
                      : price === 0
                        ? "Free"
                        : formatCurrency(price, "INR")}
                  </p>
                  <p className="mt-1 text-xs font-semibold uppercase text-slate-500">
                    {price === null
                      ? "Contact sales"
                      : `${billingCycle} billing`}
                  </p>
                </div>

                <div className="mt-6 space-y-3 text-sm">
                  {planComparisonResources.map((resource) => (
                    <div
                      className="flex items-center justify-between gap-4 border-b border-white/10 pb-3 last:border-b-0 last:pb-0"
                      key={resource}
                    >
                      <span className="text-slate-400">
                        {planResourceLabels[resource]}
                      </span>
                      <span className="font-semibold text-white">
                        {formatLimit(planOptionLimits[resource])}
                      </span>
                    </div>
                  ))}
                </div>

                {manualLimits.length > 0 ? (
                  <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm">
                    <p className="font-semibold text-amber-100">
                      Additional plan limits
                    </p>
                    <div className="mt-3 space-y-3">
                      {manualLimits.map((limit) => (
                        <div
                          className="border-b border-amber-100/10 pb-3 last:border-b-0 last:pb-0"
                          key={`${planOption.plan}-${limit.label}`}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-amber-100/80">
                              {limit.label}
                            </span>
                            <span className="font-semibold text-white">
                              {limit.value}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-auto pt-7">
                  {currentPlan ? (
                    <Button disabled className="w-full" type="button">
                      Current plan
                    </Button>
                  ) : (
                    <Button disabled className="w-full" type="button">
                      Contact CoachFort
                    </Button>
                  )}
                  <p className="mt-3 text-center text-xs text-slate-500">
                    Online plan changes are not available yet.
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {selectedBillingDocument ? (
        <div
          aria-labelledby="billing-document-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center"
          role="dialog"
        >
          <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge className="border-white/15 bg-white/10 text-white">
                  {formatDocumentType(selectedBillingDocument.document_type)}
                </Badge>
                <h3
                  className="mt-4 break-words text-2xl font-semibold"
                  id="billing-document-title"
                >
                  {selectedBillingDocument.document_number}
                </h3>
              </div>
              <button
                aria-label="Close billing document"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-sm font-semibold text-slate-400 transition hover:bg-white/10 hover:text-white"
                onClick={() => setSelectedBillingDocument(null)}
                type="button"
              >
                X
              </button>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase text-slate-500">Status</p>
                <div className="mt-2">
                  <BillingStatusBadge status={selectedBillingDocument.status} />
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase text-slate-500">Total</p>
                <p className="mt-2 font-semibold">
                  {formatMinorCurrency(
                    selectedBillingDocument.total_amount_minor,
                    selectedBillingDocument.currency,
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase text-slate-500">Issued</p>
                <p className="mt-2 font-semibold">
                  {formatDate(selectedBillingDocument.issued_at)}
                </p>
              </div>
            </div>
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
              <p className="font-semibold">Billed to</p>
              <div className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                <p>
                  Name: {selectedBillingDocument.billing_snapshot.legal_name}
                </p>
                <p>
                  Email: {selectedBillingDocument.billing_snapshot.billing_email}
                </p>
                <p className="sm:col-span-2">
                  Address: {[
                    selectedBillingDocument.billing_snapshot.address_line1,
                    selectedBillingDocument.billing_snapshot.address_line2,
                    selectedBillingDocument.billing_snapshot.city,
                    selectedBillingDocument.billing_snapshot.state,
                    selectedBillingDocument.billing_snapshot.postal_code,
                    selectedBillingDocument.billing_snapshot.country,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </div>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <ReadOnlyField
                label="CoachFort Plan"
                value={selectedBillingDocument.plan_name ?? "Not recorded"}
              />
              <ReadOnlyField
                label="Billing cycle"
                value={formatCanonicalStatus(
                  selectedBillingDocument.billing_cycle,
                )}
              />
              <ReadOnlyField
                label="Billing period"
                value={
                  selectedBillingDocument.period_start &&
                  selectedBillingDocument.period_end
                    ? `${formatDate(selectedBillingDocument.period_start)} - ${formatDate(selectedBillingDocument.period_end)}`
                    : "Not recorded"
                }
              />
            </div>
            {selectedBillingDocument.line_items.length > 0 ? (
              <div className="mt-6 overflow-x-auto rounded-3xl border border-white/10">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-4">Item</th>
                      <th className="px-5 py-4">Qty</th>
                      <th className="px-5 py-4">Unit</th>
                      <th className="px-5 py-4">Line total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {selectedBillingDocument.line_items.map((item, index) => (
                      <tr key={`${item.description}-${index}`}>
                        <td className="px-5 py-4 font-semibold">
                          {item.description}
                        </td>
                        <td className="px-5 py-4">{item.quantity}</td>
                        <td className="px-5 py-4">
                          {formatMinorCurrency(
                            item.unit_amount_minor,
                            selectedBillingDocument.currency,
                          )}
                        </td>
                        <td className="px-5 py-4 font-semibold">
                          {formatMinorCurrency(
                            item.line_total_minor,
                            selectedBillingDocument.currency,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
