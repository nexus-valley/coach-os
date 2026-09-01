"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import {
  getBillingProfileMissingFieldLabels,
  getTenantBillingProfile,
  getTenantBillingProfileCompletion,
  type TenantBillingProfile,
  type TenantBillingProfileCompletion,
} from "@/src/lib/billingProfile";
import {
  getPlatformBillingDocuments,
  type PlatformBillingDocument,
} from "@/src/lib/platformBillingDocuments";
import {
  formatResourceLimit,
  planResourceLabels,
  type PlanResource,
  type ResourceLimit,
} from "@/src/lib/plans";
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
import {
  getCurrentTenantOperationalState,
  getTenantSubscriptionLifecycle,
} from "@/src/lib/subscriptionLifecycle";
import {
  deriveSubscriptionLifecyclePresentation,
  getSubscriptionPlanRequestMode,
  type SubscriptionPlanRequestMode,
  type TenantOperationalState,
  type TenantSubscriptionLifecycle,
} from "@/src/lib/subscriptionLifecycleModel";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { canAccessSubscription } from "@/src/lib/permissions";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import {
  getUsagePercent,
  getWorkspaceUsage,
  type WorkspaceUsage,
} from "@/src/lib/usage";

type UsageCounts = WorkspaceUsage;

function formatStatus(value: string) {
  return value.replace(/_/g, " ");
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

function asPlanResource(value: string | null): PlanResource | null {
  return value === "automations" ||
    value === "courses" ||
    value === "students" ||
    value === "team_members" ||
    value === "trainers"
    ? value
    : null;
}

function canonicalResourceLimit(
  value: number | string | null | undefined,
): ResourceLimit {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : "unlimited";
  }

  return "unlimited";
}

function resourceDisplayName(value: string | null | undefined) {
  const resource = asPlanResource(value ?? null);
  return resource ? planResourceLabels[resource] : formatCanonicalStatus(value);
}

function customerUsageWarning(warning: Record<string, unknown>) {
  const currentUsage = warning.current_usage;
  const limitValue = warning.limit_value;

  if (
    (typeof currentUsage === "number" || typeof currentUsage === "string") &&
    (typeof limitValue === "number" || typeof limitValue === "string")
  ) {
    return `${String(currentUsage)} used of ${String(limitValue)}`;
  }

  return "Current usage needs attention for this plan limit.";
}

function booleanLabel(value: boolean | null | undefined) {
  return value ? "Yes" : "No";
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
    value === "past_due"
  ) {
    return "warning" as const;
  }

  if (
    value === "locked" ||
    value === "disabled" ||
    value === "suspended" ||
    value === "cancelled" ||
    value === "expired"
  ) {
    return "danger" as const;
  }

  return "light" as const;
}

function featureDisplayName(featureKey: string) {
  const labels: Record<string, string> = {
    ai_assistant: "AI assistant",
    courses: "Programs",
    document_uploads: "Document uploads",
    live_classes: "Live classes",
    payment_gateway: "Online payments",
    students: "Students",
  };

  return labels[featureKey] ?? formatCanonicalStatus(featureKey);
}

function featureAvailability(status: string | null | undefined) {
  if (["active", "approved", "enabled", "included", "trial"].includes(status ?? "")) {
    return { label: "Available", tone: "success" as const };
  }

  if (status === "coming_soon") {
    return { label: "Coming soon", tone: "warning" as const };
  }

  if (["addon", "platform_approval_required"].includes(status ?? "")) {
    return { label: "Contact CoachFort", tone: "warning" as const };
  }

  if (["disabled", "expired", "locked", "suspended"].includes(status ?? "")) {
    return { label: "Not available", tone: "danger" as const };
  }

  return { label: "Not included", tone: "light" as const };
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

function requestBlockingDescription(
  plan: TenantRequestablePlan,
  mode: "change" | "selection",
) {
  if (plan.blocking_request_status === "approved") {
    return mode === "change"
      ? "CoachFort approved this request for follow-up. Your current plan and billing remain unchanged until the update is confirmed."
      : "CoachFort approved this request for follow-up. Workspace access and billing remain unchanged until the selection is confirmed.";
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

function safeLoadError(fallback: string) {
  return fallback;
}

type IsolatedLoadResult<T> = {
  data: T | null;
  error: string | null;
};

async function isolatedLoad<T>(
  loader: () => Promise<T>,
  fallback: string,
): Promise<IsolatedLoadResult<T>> {
  try {
    return { data: await loader(), error: null };
  } catch {
    return { data: null, error: safeLoadError(fallback) };
  }
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
  warning,
}: {
  limit: ResourceLimit;
  resource: PlanResource;
  used: number;
  warning: boolean;
}) {
  const percent = getUsagePercent(used, limit);
  const overLimit = limit !== "unlimited" && used > limit;

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
        ) : warning ? (
          <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">
            Plan attention
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
  const completionUnavailable = Boolean(error) || completion === null;
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
            Keep your legal, tax, address, and billing contact details accurate
            for CoachFort invoices, payment receipts, and renewal support. This
            does not change your plan or record a payment.
          </p>
        </div>
        <Button href="/app/billing-profile" type="button" variant="secondary">
          Open billing profile
        </Button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
          <p className="text-sm text-slate-500">Readiness score</p>
          <p className="mt-2 text-3xl font-semibold">
            {completionUnavailable ? "Unavailable" : `${completion.completion_score}%`}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {completionUnavailable
              ? "Billing profile readiness could not be loaded."
              : complete
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
  const visibleLimits = entitlement?.limits ?? [];
  const trialAssignment = assignment?.status === "trial";

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
            <ReadOnlyField
              label="Plan"
              value={assignment?.plan_name ?? assignment?.plan_code ?? ""}
            />
            <ReadOnlyField label="Status" value={formatCanonicalStatus(assignment?.status)} />
            <ReadOnlyField
              label="Payment status"
              value={formatCanonicalStatus(assignment?.payment_status)}
            />
            {!trialAssignment ? (
              <>
                <ReadOnlyField label="Currency" value={assignment?.currency ?? ""} />
                <ReadOnlyField
                  label="Billing cycle"
                  value={formatCanonicalStatus(assignment?.billing_cycle)}
                />
              </>
            ) : null}
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
            <p className="text-sm font-semibold text-white">Usage limits</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
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

          {entitlement.warnings.length > 0 ? (
            <div className="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-5 text-amber-100">
              <p className="text-sm font-semibold">Plan attention</p>
              <p className="mt-2 text-sm leading-6 text-amber-100/80">
                Review the following workspace usage against your current plan.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {entitlement.warnings.map((warning, index) => (
                  <CanonicalInfoRow
                    key={`${String(warning.resource_key ?? "warning")}-${index}`}
                    label={resourceDisplayName(String(warning.resource_key ?? ""))}
                    value={customerUsageWarning(warning)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
            <p className="text-sm font-semibold text-white">Plan features</p>
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
        <p className="text-sm font-semibold text-white">
          {resourceDisplayName(limit.resource_key)}
        </p>
        <Badge tone="light">Plan limit</Badge>
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
  const availability = featureAvailability(feature?.effective_status);

  return (
    <div className="rounded-2xl border border-white/10 bg-[#101214] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-semibold text-white">
          {featureDisplayName(featureKey)}
        </p>
        <Badge tone={availability.tone}>
          {availability.label}
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
  mode,
  onSubmit,
  plans,
  submitError,
  submitSuccess,
  submitting,
}: {
  error: string | null;
  mode: SubscriptionPlanRequestMode;
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
  const selectingFirstPlan = mode === "selection";
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
            {selectingFirstPlan ? "Choose a CoachFort plan" : "Request a plan change"}
          </Badge>
          <h3 className="mt-4 text-2xl font-semibold">
            {selectingFirstPlan
              ? "Ask CoachFort to review your plan selection"
              : "Ask CoachFort to review a plan change"}
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            {selectingFirstPlan
              ? "This sends a plan selection request only. Workspace access and billing stay unchanged until CoachFort confirms the selection."
              : "This sends a plan change request only. Your current plan, payment status, and workspace access stay unchanged until CoachFort confirms a separate update."}
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
                      <p className="mt-1">{requestBlockingDescription(plan, mode)}</p>
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
                    {selectingFirstPlan
                      ? `Choose ${selectedPlan.plan_name ?? selectedPlan.plan_code}`
                      : selectedPlan.request_label ??
                        `Request ${selectedPlan.plan_name ?? selectedPlan.plan_code}`}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {selectingFirstPlan
                      ? "Ask CoachFort to review this plan selection. No plan or billing change occurs until CoachFort confirms it."
                      : selectedPlan.request_description ??
                        "Request access to this plan. CoachFort review is required before any plan change."}
                  </p>
                </div>
                <Badge tone={selectedPlan.has_blocking_request ? "warning" : "success"}>
                  {requestBlockingLabel(selectedPlan)}
                </Badge>
              </div>
              {selectedPlan.has_blocking_request ? (
                <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
                  {requestBlockingDescription(selectedPlan, mode)}
                </p>
              ) : null}
              {selectedPlan.blocking_request_status === "approved" ? (
                <div className="mt-4 rounded-2xl border border-teal-400/30 bg-teal-400/10 p-4 text-sm leading-6 text-teal-100">
                  <p className="font-semibold">
                    Approved - waiting for CoachFort confirmation.
                  </p>
                  <p className="mt-1">
                    Approval does not activate the requested plan or change
                    billing. {selectingFirstPlan
                      ? "Workspace access remains unchanged until CoachFort confirms the selection."
                      : "Keep using the current plan shown above until CoachFort confirms the update."}
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
              {submitting
                ? "Sending request..."
                : selectingFirstPlan
                  ? "Submit plan request"
                  : "Submit plan change request"}
            </Button>
            <p className="text-sm text-slate-500">
              {selectingFirstPlan
                ? "Workspace access and billing remain unchanged until confirmation."
                : "Your current plan and billing remain unchanged."}
            </p>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function UpgradeRequestStatusPanel({
  error,
  mode,
  requests,
}: {
  error: string | null;
  mode: SubscriptionPlanRequestMode;
  requests: TenantUpgradeRequest[];
}) {
  const selectingFirstPlan = mode === "selection";

  return (
    <Card className="mt-6 border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            {selectingFirstPlan ? "Plan request status" : "Plan change request status"}
          </Badge>
          <h3 className="mt-4 text-2xl font-semibold">
            {selectingFirstPlan ? "Plan request history" : "Plan change request history"}
          </h3>
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
  const [billingDocuments, setBillingDocuments] = useState<
    PlatformBillingDocument[]
  >([]);
  const [billingDocumentsError, setBillingDocumentsError] = useState<
    string | null
  >(null);
  const [billingProfile, setBillingProfile] =
    useState<TenantBillingProfile | null>(null);
  const [billingProfileError, setBillingProfileError] = useState<string | null>(
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
  const [lifecycle, setLifecycle] =
    useState<TenantSubscriptionLifecycle | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [operationalState, setOperationalState] =
    useState<TenantOperationalState | null>(null);
  const [selectedBillingDocument, setSelectedBillingDocument] =
    useState<PlatformBillingDocument | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
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
  const [usage, setUsage] = useState<UsageCounts | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

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
          lifecycleResult,
          canonicalEntitlementResult,
          billingProfileResult,
          billingProfileCompletionResult,
          billingDocumentsResult,
          requestablePlanResult,
          upgradeRequestResult,
        ] = await Promise.all([
          isolatedLoad(
            async () => {
              const [nextOperationalState, nextLifecycle] = await Promise.all([
                getCurrentTenantOperationalState(currentTenant.id),
                getTenantSubscriptionLifecycle(currentTenant.id),
              ]);

              return {
                lifecycle: nextLifecycle,
                operationalState: nextOperationalState,
              };
            },
            "Subscription lifecycle is temporarily unavailable.",
          ),
          isolatedLoad(
            () => getTenantEntitlementState(currentTenant.id),
            "Unable to load detailed plan access.",
          ),
          isolatedLoad(
            () => getTenantBillingProfile(currentTenant.id),
            "Unable to load billing profile details.",
          ),
          isolatedLoad(
            () => getTenantBillingProfileCompletion(currentTenant.id),
            "Unable to load billing profile readiness.",
          ),
          isolatedLoad(
            () => getPlatformBillingDocuments(currentTenant.id),
            "Unable to load CoachFort billing documents.",
          ),
          isolatedLoad(
            () => getTenantRequestablePlanCatalog(currentTenant.id),
            "Unable to load requestable plans.",
          ),
          isolatedLoad(
            () => getTenantUpgradeRequests({ tenantId: currentTenant.id }),
            "Unable to load upgrade request history.",
          ),
        ]);

        const usageResult = lifecycleResult.data?.operationalState.operationalAllowed
          ? await isolatedLoad(
              () => getWorkspaceUsage(currentTenant.id),
              "Workspace usage is temporarily unavailable.",
            )
          : { data: null, error: null };

        if (!active) {
          return;
        }

        setOperationalState(lifecycleResult.data?.operationalState ?? null);
        setLifecycle(lifecycleResult.data?.lifecycle ?? null);
        setLifecycleError(lifecycleResult.error);
        setBillingProfile(billingProfileResult.data);
        setBillingProfileError(billingProfileResult.error);
        setBillingProfileCompletion(billingProfileCompletionResult.data);
        setBillingProfileCompletionError(billingProfileCompletionResult.error);
        setBillingDocuments(billingDocumentsResult.data ?? []);
        setBillingDocumentsError(billingDocumentsResult.error);
        setCanonicalEntitlementError(canonicalEntitlementResult.error);
        setCanonicalEntitlementState(canonicalEntitlementResult.data);
        setRequestablePlanError(requestablePlanResult.error);
        setRequestablePlans(requestablePlanResult.data ?? []);
        setUpgradeRequestError(upgradeRequestResult.error);
        setUpgradeRequests(upgradeRequestResult.data ?? []);
        setUsage(usageResult.data);
        setUsageError(usageResult.error);
        setError("");
      } catch {
        if (!active) {
          return;
        }

        setError("Unable to load subscription. Please try again.");
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

  const lifecyclePresentation = deriveSubscriptionLifecyclePresentation(
    operationalState,
    lifecycle,
  );
  const planRequestMode = getSubscriptionPlanRequestMode(
    lifecyclePresentation.state,
  );

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
        planRequestMode === "selection"
          ? "Plan request sent for CoachFort review. Workspace access and billing remain unchanged until confirmation."
          : "Plan change request sent for CoachFort review. Your current plan and billing remain unchanged.",
      );
      return true;
    } catch {
      setUpgradeRequestSubmitError(
        "Unable to submit the plan request. Please try again.",
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
        <AccessDeniedCard description="Subscription and billing controls are available to workspace Owners and Admins." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-red-400/30 bg-red-500/10 p-6 text-red-100">
          {error}
        </Card>
      </div>
    );
  }

  const assignment = canonicalEntitlementState?.assignment ?? null;
  const currentPlanName = assignment?.plan_name ?? assignment?.plan_code ?? null;
  const trialAssignment = lifecycle?.storedStatus === "trial";
  const usageLimits = (canonicalEntitlementState?.limits ?? [])
    .map((limit) => ({ limit, resource: asPlanResource(limit.resource_key) }))
    .filter(
      (entry): entry is {
        limit: TenantEntitlementLimit;
        resource: PlanResource;
      } => entry.resource !== null,
    );
  const warningResources = new Set(
    (canonicalEntitlementState?.warnings ?? []).map((warning) =>
      String(warning.resource_key ?? ""),
    ),
  );
  const renewalHelpAvailable =
    lifecyclePresentation.state === "grace" ||
    lifecyclePresentation.state === "expired_paid";
  const planChoiceNeeded =
    lifecyclePresentation.state === "trial_expired" ||
    lifecyclePresentation.state === "subscription_required";

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        actions={<Badge tone={operationalState?.operationalAllowed ? "success" : "warning"}>{lifecyclePresentation.badge}</Badge>}
        description="Review your CoachFort plan, workspace access, billing profile, and plan request status."
        eyebrow="CoachFort plan"
        title="Subscription"
      />

      <Card className="mt-6 border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div>
            <Badge tone={operationalState?.operationalAllowed ? "success" : "warning"}>
              {lifecyclePresentation.badge}
            </Badge>
            <h2 className="mt-4 text-2xl font-semibold">
              {lifecyclePresentation.title}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              {lifecyclePresentation.description}
            </p>
            {lifecycleError ? (
              <p className="mt-3 text-sm text-amber-200">
                Subscription details are temporarily unavailable. Contact CoachFort support if you need help.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
            {renewalHelpAvailable ? (
              <Button href="/support" type="button">
                Get renewal help
              </Button>
            ) : planChoiceNeeded ? (
              <Button href="#plan-options" type="button">
                Choose a plan
              </Button>
            ) : lifecyclePresentation.state === "needs_attention" ? (
              <Button href="/support" type="button">
                Contact CoachFort support
              </Button>
            ) : null}
            <Button href="/app/billing-profile" type="button" variant="secondary">
              Open billing profile
            </Button>
          </div>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ReadOnlyField label="Workspace" value={tenant?.name ?? ""} />
          <ReadOnlyField label="Current plan" value={currentPlanName ?? ""} />
          <ReadOnlyField
            label={trialAssignment ? "Trial started" : "Current period started"}
            value={formatDate(
              trialAssignment
                ? lifecycle?.trialStartedAt ?? null
                : lifecycle?.currentPeriodStart ?? null,
            )}
          />
          <ReadOnlyField
            label={trialAssignment ? "Trial ends" : "Current period ends"}
            value={formatDate(
              trialAssignment
                ? lifecycle?.trialEndsAt ?? null
                : lifecycle?.currentPeriodEnd ?? null,
            )}
          />
          {lifecyclePresentation.state === "grace" ? (
            <ReadOnlyField
              label="Workspace access through"
              value={formatDate(lifecycle?.gracePeriodEndsAt ?? null)}
            />
          ) : null}
          {!trialAssignment ? (
            <>
              <ReadOnlyField
                label="Billing cycle"
                value={formatCanonicalStatus(assignment?.billing_cycle)}
              />
              <ReadOnlyField label="Currency" value={assignment?.currency ?? ""} />
            </>
          ) : null}
          <ReadOnlyField
            label="Payment status"
            value={formatCanonicalStatus(lifecycle?.paymentStatus)}
          />
        </div>
      </Card>

      <Card className="mt-6 border-teal-400/30 bg-teal-400/10 p-5 text-teal-50">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">
              {planRequestMode === "selection"
                ? "Plan selections require CoachFort review."
                : "Plan changes require CoachFort review."}
            </p>
            <p className="mt-2 text-sm leading-6 text-teal-100/80">
              {planRequestMode === "selection" ? (
                <>
                  Choose a plan below or contact CoachFort support. Workspace access
                  and billing remain unchanged until CoachFort confirms the selection.
                </>
              ) : (
                <>
                  Request a plan change below or contact CoachFort support. Your current
                  plan and billing remain unchanged until CoachFort confirms the change.
                </>
              )}
            </p>
          </div>
          <Button href="/support" type="button" variant="secondary">
            Contact support
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

      <Card className="mt-6 border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
        <h3 className="text-2xl font-semibold">Workspace usage</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Current workspace usage compared with your plan limits.
        </p>
        {!operationalState?.operationalAllowed ? (
          <div className="mt-5 rounded-3xl border border-white/10 bg-[#15181b] p-5 text-sm text-slate-400" role="status">
            Usage is unavailable while workspace access is paused.
          </div>
        ) : usageError || !usage ? (
          <div className="mt-5 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-100" role="status">
            Workspace usage is temporarily unavailable. No usage totals have been substituted.
          </div>
        ) : usageLimits.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-white/10 bg-[#15181b] p-5 text-sm text-slate-400" role="status">
            Usage limits are not available for this plan.
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {usageLimits.map(({ limit, resource }) => (
              <UsageCard
                key={resource}
                limit={canonicalResourceLimit(limit.limit_value)}
                resource={resource}
                used={usage[resource]}
                warning={warningResources.has(resource)}
              />
            ))}
          </div>
        )}
      </Card>

      <PaymentGatewayParkedCard />

      <section id="plan-options">
        <RequestPlanUpgradePanel
          error={requestablePlanError}
          mode={planRequestMode}
          onSubmit={handleUpgradeRequestSubmit}
          plans={requestablePlans}
          submitError={upgradeRequestSubmitError}
          submitSuccess={upgradeRequestSubmitSuccess}
          submitting={upgradeRequestSubmitting}
        />
      </section>

      <UpgradeRequestStatusPanel
        error={upgradeRequestError}
        mode={planRequestMode}
        requests={upgradeRequests}
      />

      <section className="mt-8 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
                Current plan
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                CoachFort billing
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Review your current plan, billing cycle, payment status, and billing period.
              </p>
            </div>
            {lifecycle?.storedStatus ? (
              <BillingStatusBadge status={lifecycle.storedStatus} />
            ) : null}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <ReadOnlyField label="Plan" value={currentPlanName ?? ""} />
            <ReadOnlyField
              label="Subscription status"
              value={formatCanonicalStatus(lifecycle?.storedStatus)}
            />
            <ReadOnlyField
              label="Payment status"
              value={formatCanonicalStatus(lifecycle?.paymentStatus)}
            />
            {!trialAssignment ? (
              <>
                <ReadOnlyField
                  label="Billing cycle"
                  value={formatCanonicalStatus(assignment?.billing_cycle)}
                />
                <ReadOnlyField label="Currency" value={assignment?.currency ?? ""} />
                <ReadOnlyField
                  label="Current period ends"
                  value={formatDate(lifecycle?.currentPeriodEnd ?? null)}
                />
              </>
            ) : (
              <ReadOnlyField
                label="Trial ends"
                value={formatDate(lifecycle?.trialEndsAt ?? null)}
              />
            )}
          </div>
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
                These billing-profile details support CoachFort invoices
                and payment receipts. These details are read-only for workspace members.
                Open the billing profile to update them.
              </p>
            </div>
            <Button href="/app/billing-profile" type="button" variant="secondary">
              Open billing profile
            </Button>
          </div>
          {billingProfileError ? (
            <div className="mt-6 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-100" role="status">
              Billing profile details are temporarily unavailable. Lifecycle and plan options remain available.
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <ReadOnlyField label="Legal name" value={billingProfile?.legal_name ?? ""} />
              <ReadOnlyField label="Billing email" value={billingProfile?.billing_email ?? ""} />
              <ReadOnlyField
                label="Tax registration"
                value={
                  billingProfile?.tax_registration_type === "NONE"
                    ? ""
                    : billingProfile?.tax_registration_type ?? ""
                }
              />
              <ReadOnlyField label="Tax registration ID" value={billingProfile?.tax_id ?? ""} />
              <ReadOnlyField label="Billing currency" value={billingProfile?.preferred_currency ?? ""} />
              <ReadOnlyField label="Address line 1" value={billingProfile?.address_line1 ?? ""} />
              <ReadOnlyField label="City" value={billingProfile?.city ?? ""} />
              <ReadOnlyField label="State" value={billingProfile?.state ?? ""} />
              <ReadOnlyField label="Country" value={billingProfile?.country ?? ""} />
              <ReadOnlyField label="Postal code" value={billingProfile?.postal_code ?? ""} />
            </div>
          )}
          <p className="mt-5 text-xs font-semibold uppercase text-slate-500">
            Managed by CoachFort
          </p>
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
              {billingDocumentsError ? "Unavailable" : `${billingDocuments.length} records`}
            </p>
          </div>
          {billingDocumentsError ? (
            <div className="p-8 text-center" role="status">
              <p className="font-semibold">Billing documents are temporarily unavailable</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
                Lifecycle, billing profile, and plan options remain available.
              </p>
            </div>
          ) : billingDocuments.length === 0 ? (
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
                    {billingDocuments.map((document) => (
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
                {billingDocuments.map((document) => (
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
