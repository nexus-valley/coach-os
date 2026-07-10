"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import {
  getBillingSummary,
  type BillingProfile,
} from "@/src/lib/billing";
import type {
  InvoiceWithItems,
  PaymentTransaction,
} from "@/src/lib/invoices";
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

type RazorpayCheckoutInstance = {
  on?: (event: "payment.failed", handler: (response: unknown) => void) => void;
  open: () => void;
};

type RazorpayCheckoutOptions = {
  amount: number;
  currency: "INR";
  description: string;
  handler: (response: RazorpaySuccessResponse) => void | Promise<void>;
  key: string;
  modal?: {
    ondismiss?: () => void;
  };
  name: string;
  order_id: string;
};

type RazorpaySuccessResponse = {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
};

type RazorpayOrderResponse = {
  activationEnabled: false;
  amount: number;
  billingCycle: "monthly" | "yearly";
  currency: "INR";
  description: string;
  keyId: string;
  name: string;
  orderId: string;
  planCode: "growth" | "starter";
  razorpayOrderId: string;
};

type RazorpayActivationResponse = {
  activated?: boolean;
  activationEventId?: string | null;
  activationEnabled?: boolean;
  activationStatus?: string;
  assignmentId?: string | null;
  idempotent?: boolean;
  orderId?: string;
  pending?: boolean;
  planCode?: string | null;
  reason?: string;
  tenantId?: string;
};

type RazorpayWindow = typeof window & {
  Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
};

type BillingSummary = {
  accessState: SubscriptionAccessState;
  billingProfile: BillingProfile;
  currentSubscriptionStatus: {
    billingCycle: "monthly" | "yearly";
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    provider: string;
    status: string;
  };
  invoices: InvoiceWithItems[];
  paymentHistory: PaymentTransaction[];
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

const razorpayCheckoutScriptUrl = "https://checkout.razorpay.com/v1/checkout.js";
const razorpayRegressionTenantId = "29a33701-82ed-4c7f-8042-0a1af8296ce5";
const razorpayTestCheckoutPlans: {
  billingCycle: "monthly" | "yearly";
  label: string;
}[] = [
  {
    billingCycle: "monthly",
    label: "Test checkout: Growth Monthly \u20b95,999",
  },
  {
    billingCycle: "yearly",
    label: "Test checkout: Growth Yearly \u20b959,990",
  },
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
    return "Approved - waiting for platform follow-up";
  }

  if (
    plan.blocking_request_status === "open" ||
    plan.blocking_request_status === "in_review" ||
    plan.has_open_request
  ) {
    return "Request already open/in review";
  }

  if (plan.has_blocking_request) {
    return "Platform follow-up pending";
  }

  return "Requestable";
}

function requestBlockingDescription(plan: TenantRequestablePlan) {
  if (plan.blocking_request_status === "approved") {
    return "The platform has approved this request. Your current plan is unchanged until CoachFort completes the separate activation/assignment step. No checkout or payment has been started from this approval.";
  }

  if (
    plan.blocking_request_status === "open" ||
    plan.blocking_request_status === "in_review" ||
    plan.has_open_request
  ) {
    return "Request already open/in review for this plan.";
  }

  return "Request is already being handled by platform operations.";
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
            Read-only entitlement summary
          </Badge>
          <h3 className="mt-4 text-2xl font-semibold">
            Canonical plan, usage, and feature access
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            This does not change your plan or billing. Payment gateway is not
            active. Checkout is not enabled.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="border-white/15 bg-white/10 text-white">Read-only</Badge>
          <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">
            Checkout off
          </Badge>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
          Canonical entitlement summary is currently unavailable: {error}
        </div>
      ) : null}

      {!entitlement ? (
        <div className="mt-5 rounded-3xl border border-white/10 bg-[#15181b] p-5 text-sm leading-6 text-slate-400">
          No canonical entitlement assignment is available yet. The existing
          subscription summary above remains the active tenant-facing reference.
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
              label="Payment forced"
              value={booleanLabel(entitlement.payment_forced)}
            />
            <ReadOnlyField
              label="Gateway required"
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
                  <p className="text-sm text-slate-400">No canonical usage snapshot.</p>
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
                  <p className="text-sm text-slate-400">No canonical limits configured.</p>
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
        Reason: {formatCanonicalStatus(feature?.reason)} | Plan:{" "}
        {formatCanonicalStatus(feature?.plan_status)}
      </p>
    </div>
  );
}

async function getClientAccessToken() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session?.access_token) {
    throw new Error("Your session expired. Please sign in again.");
  }

  return data.session.access_token;
}

async function parseApiJson<T>(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? fallback);
  }

  return payload as T;
}

let razorpayCheckoutScriptPromise: Promise<void> | null = null;

function loadRazorpayCheckoutScript() {
  const razorpayWindow = window as RazorpayWindow;

  if (razorpayWindow.Razorpay) {
    return Promise.resolve();
  }

  if (razorpayCheckoutScriptPromise) {
    return razorpayCheckoutScriptPromise;
  }

  razorpayCheckoutScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${razorpayCheckoutScriptUrl}"]`,
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Unable to load Razorpay checkout.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = razorpayCheckoutScriptUrl;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Razorpay checkout."));
    document.body.appendChild(script);
  });

  return razorpayCheckoutScriptPromise;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function activationComplete(payload: RazorpayActivationResponse) {
  return (
    payload.activated === true ||
    payload.activationStatus === "activated" ||
    payload.activationStatus === "skipped_already_active"
  );
}

function activationMessage(payload: RazorpayActivationResponse) {
  if (activationComplete(payload)) {
    return "Verified payment activation is complete. Refresh the page if the subscription summary has not updated yet.";
  }

  if (payload.pending) {
    return "Payment is being verified. This may take a few seconds.";
  }

  if (payload.activationStatus === "failed") {
    return payload.reason ?? "Verified payment activation failed.";
  }

  return payload.reason ?? "Still waiting for verified server confirmation.";
}

function RazorpayTestCheckoutPanel({
  currentRole,
  tenantId,
}: {
  currentRole: MemberRole | null;
  tenantId: string | null;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [creatingCycle, setCreatingCycle] = useState<"monthly" | "yearly" | null>(
    null,
  );
  const [lastOrder, setLastOrder] = useState<RazorpayOrderResponse | null>(null);
  const [lastPaymentSignal, setLastPaymentSignal] =
    useState<RazorpaySuccessResponse | null>(null);

  const eligible =
    tenantId === razorpayRegressionTenantId &&
    (currentRole === "owner" || currentRole === "admin");

  if (!eligible || !tenantId) {
    return null;
  }

  const activeTenantId = tenantId;

  async function postJson<T>(
    url: string,
    body: Record<string, string>,
    fallback: string,
  ) {
    const token = await getClientAccessToken();
    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    return parseApiJson<T>(response, fallback);
  }

  async function postActivationStatus(orderId: string) {
    const token = await getClientAccessToken();
    const response = await fetch("/api/billing/razorpay/activate", {
      body: JSON.stringify({
        orderId,
        tenantId: activeTenantId,
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json().catch(() => ({}))) as
      RazorpayActivationResponse & {
        error?: string;
      };

    if (response.ok || payload.pending === true) {
      return payload;
    }

    if (typeof payload.activationStatus === "string") {
      return payload;
    }

    throw new Error(payload.error ?? "Unable to check activation status.");
  }

  async function checkActivationStatus(orderId: string, poll = false) {
    setCheckingStatus(true);
    setActionError(null);

    try {
      const maxAttempts = poll ? 8 : 1;
      let lastResponse: RazorpayActivationResponse | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          lastResponse = await postActivationStatus(orderId);
        } catch (caught) {
          if (!poll || attempt === maxAttempts) {
            throw caught;
          }

          lastResponse = {
            pending: true,
            reason: getErrorMessage(
              caught,
              "Payment is being verified. This may take a few seconds.",
            ),
          };
        }

        setActionMessage(activationMessage(lastResponse));

        if (activationComplete(lastResponse) || !lastResponse.pending || !poll) {
          break;
        }

        await sleep(3000);
      }

      if (poll && lastResponse?.pending) {
        setActionMessage(
          "Still waiting for webhook confirmation. Please try Check Status again after a minute.",
        );
      }
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to check activation status."),
      );
    } finally {
      setCheckingStatus(false);
    }
  }

  async function handleCheckout(billingCycle: "monthly" | "yearly") {
    setActionError(null);
    setActionMessage(null);
    setCreatingCycle(billingCycle);

    try {
      const order = await postJson<RazorpayOrderResponse>(
        "/api/billing/razorpay/orders",
        {
          billingCycle,
          planCode: "growth",
          tenantId: activeTenantId,
        },
        "Unable to create Razorpay test order.",
      );

      if (order.activationEnabled !== false) {
        throw new Error("Checkout response failed the activation safety check.");
      }

      setLastOrder(order);
      setActionMessage("Opening Razorpay test checkout.");
      await loadRazorpayCheckoutScript();

      const razorpayWindow = window as RazorpayWindow;

      if (!razorpayWindow.Razorpay) {
        throw new Error("Razorpay checkout is not available.");
      }

      const checkout = new razorpayWindow.Razorpay({
        amount: order.amount,
        currency: order.currency,
        description: order.description,
        handler: async (response) => {
          setLastPaymentSignal(response);
          setActionError(null);
          setActionMessage(
            "Payment returned from Razorpay. Waiting for verified server confirmation.",
          );
          await checkActivationStatus(order.orderId, true);
        },
        key: order.keyId,
        modal: {
          ondismiss: () => {
            setActionMessage(
              "Checkout was closed. No activation was attempted from the browser.",
            );
          },
        },
        name: order.name,
        order_id: order.razorpayOrderId,
      });

      checkout.on?.("payment.failed", () => {
        setActionMessage(
          "Razorpay reported a failed payment. No activation was attempted.",
        );
      });
      checkout.open();
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to start Razorpay test checkout."),
      );
    } finally {
      setCreatingCycle(null);
    }
  }

  return (
    <Card className="mt-6 border-sky-400/30 bg-sky-400/10 p-6 text-white shadow-2xl shadow-black/10">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <Badge className="border-sky-300/30 bg-sky-300/10 text-sky-100">
            Razorpay Test Checkout
          </Badge>
          <h3 className="mt-4 text-2xl font-semibold">Razorpay test checkout</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Test mode only. No live payment is enabled. Activation happens only
            after verified server-side payment confirmation. Browser success is
            not activation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-100">
            Regression tenant
          </Badge>
          <Badge className="border-white/15 bg-white/10 text-white">
            Owner/admin only
          </Badge>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {razorpayTestCheckoutPlans.map((option) => (
          <div
            className="rounded-3xl border border-white/10 bg-[#101214] p-5"
            key={option.billingCycle}
          >
            <p className="text-sm font-semibold text-white">
              Growth {option.billingCycle}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Creates a Razorpay test order only after you click. Premium and
              public checkout remain unavailable.
            </p>
            <Button
              className="mt-5 w-full"
              disabled={creatingCycle !== null || checkingStatus}
              onClick={() => void handleCheckout(option.billingCycle)}
              type="button"
              variant="secondary"
            >
              {creatingCycle === option.billingCycle
                ? "Starting test checkout..."
                : option.label}
            </Button>
          </div>
        ))}
      </div>

      {lastOrder ? (
        <div className="mt-6 rounded-3xl border border-white/10 bg-[#101214] p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div>
              <p className="text-sm font-semibold text-white">Payment status</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Internal order id:{" "}
                <span className="break-all font-semibold text-slate-300">
                  {lastOrder.orderId}
                </span>
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Plan: {formatCanonicalStatus(lastOrder.planCode)} | Billing:{" "}
                {formatCanonicalStatus(lastOrder.billingCycle)}
              </p>
              {lastPaymentSignal?.razorpay_payment_id ? (
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Razorpay payment signal received. Waiting for webhook-backed
                  verification.
                </p>
              ) : null}
            </div>
            <Button
              disabled={checkingStatus}
              onClick={() => void checkActivationStatus(lastOrder.orderId)}
              type="button"
              variant="secondary"
            >
              {checkingStatus ? "Checking..." : "Check activation status"}
            </Button>
          </div>
        </div>
      ) : null}

      {actionMessage ? (
        <div className="mt-5 rounded-3xl border border-white/10 bg-white/10 p-4 text-sm leading-6 text-slate-100">
          {actionMessage}
        </div>
      ) : null}

      {actionError ? (
        <div className="mt-5 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
          {actionError}
        </div>
      ) : null}
    </Card>
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
            Send a request to platform operations
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            This only sends a request to CoachFort platform operations. It does
            not change your plan, start checkout, charge money, or activate the
            payment gateway. Platform review is required.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="border-white/15 bg-white/10 text-white">
            Request only
          </Badge>
          <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">
            No checkout
          </Badge>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
          Requestable plans are currently unavailable: {error}
        </div>
      ) : null}

      {!error && plans.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-white/10 bg-[#15181b] p-5 text-sm leading-6 text-slate-400">
          Plan upgrade requests are not enabled yet. Public requestable plans are
          pending platform review.
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
                      "Request access to this plan. Platform review is required before any plan change."}
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
                    Approved - waiting for platform follow-up/manual assignment.
                  </p>
                  <p className="mt-1">
                    This approval does not activate the requested plan, start
                    checkout, or change billing. The canonical entitlement summary
                    remains the source of truth until CoachFort completes the
                    separate assignment step.
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
              placeholder="Share why this plan is needed, expected growth, or any setup context for platform review."
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
              I understand this only sends a request, does not change the plan,
              does not start checkout, does not charge money, and payment
              gateway remains inactive until platform review is completed.
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
              No payment, checkout, billing, or assignment action is performed.
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
            Read-only request history. This does not submit a request, change your
            plan, start checkout, or activate payment gateway billing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="border-white/15 bg-white/10 text-white">Read-only</Badge>
          <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">
            No checkout
          </Badge>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
          Upgrade request history is currently unavailable: {error}
        </div>
      ) : null}

      {!error && requests.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-white/10 bg-[#15181b] p-5 text-sm leading-6 text-slate-400">
          Plan upgrade requests are not enabled yet. Public requestable plans are
          pending platform review.
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
          label="Entitlement changed"
          value={booleanLabel(request.entitlement_changed)}
        />
        <ReadOnlyField
          label="Payment gateway called"
          value={booleanLabel(request.payment_gateway_called)}
        />
      </div>

      {request.status === "approved" ? (
        <div className="mt-5 rounded-3xl border border-teal-400/30 bg-teal-400/10 p-4 text-sm leading-6 text-teal-100">
          Approved for platform follow-up only. This does not activate the
          requested plan, change billing, start checkout, or charge money.
          Canonical entitlement assignment remains the source of truth.
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
  const [canonicalEntitlementError, setCanonicalEntitlementError] =
    useState<string | null>(null);
  const [canonicalEntitlementState, setCanonicalEntitlementState] =
    useState<TenantEntitlementState | null>(null);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] =
    useState<TenantSubscription | null>(null);
  const [selectedInvoice, setSelectedInvoice] =
    useState<InvoiceWithItems | null>(null);
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
                "Unable to load canonical entitlement summary.",
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
        "Upgrade request sent for platform review. No plan, billing, or checkout change was made.",
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
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            Subscription
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Plans & limits
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Track workspace usage against the current SaaS plan. Payment gateway
            billing is intentionally not connected in this foundation module.
          </p>
        </div>
        <StatusBadge status={subscription.subscription_status} />
      </div>

      <Card className="mt-6 border-teal-400/30 bg-teal-400/10 p-5 text-teal-50">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">
              Subscription is managed by the platform owner.
            </p>
            <p className="mt-2 text-sm leading-6 text-teal-100/80">
              Contact platform support or your platform admin to change plans.
              Payment gateway billing is not connected yet.
            </p>
          </div>
          <Button href="/app/finance" type="button" variant="secondary">
            Open Finance Center
          </Button>
        </div>
      </Card>

      <CanonicalEntitlementSummary
        entitlement={canonicalEntitlementState}
        error={canonicalEntitlementError}
      />

      <RazorpayTestCheckoutPanel
        currentRole={currentRole}
        tenantId={tenant?.id ?? null}
      />

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
            Read-only - payment gateway billing is not connected yet.
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
                Billing lifecycle
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Subscription foundation
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Billing records are ready for future Razorpay or Stripe
                integration. No live gateway calls are made yet.
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
              label="GST number"
              value={billingProfile?.billingGstNumber ?? ""}
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

      <section className="mt-8 grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden border-white/10 bg-[#101214] text-white shadow-2xl shadow-black/10">
          <div className="flex flex-col justify-between gap-4 border-b border-white/10 p-6 sm:flex-row sm:items-center">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Invoice history
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">Invoices</h3>
            </div>
            <p className="text-sm text-slate-400">
              {billingSummary?.invoices.length ?? 0} records
            </p>
          </div>
          {!billingSummary || billingSummary.invoices.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-semibold">No billing invoices yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
                Draft, issued, paid, and overdue invoices will appear here once
                billing workflows are activated.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-4">Invoice</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4">Total</th>
                    <th className="px-5 py-4">Due</th>
                    <th className="px-5 py-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {billingSummary.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="px-5 py-4 font-semibold">
                        {invoice.invoice_number}
                      </td>
                      <td className="px-5 py-4">
                        <BillingStatusBadge status={invoice.status} />
                      </td>
                      <td className="px-5 py-4 font-semibold">
                        {formatCurrency(invoice.total_amount, invoice.currency)}
                      </td>
                      <td className="px-5 py-4 text-slate-400">
                        {formatDate(invoice.due_at)}
                      </td>
                      <td className="px-5 py-4">
                        <Button
                          onClick={() => setSelectedInvoice(invoice)}
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
          )}
        </Card>

        <Card className="overflow-hidden border-white/10 bg-[#101214] text-white shadow-2xl shadow-black/10">
          <div className="flex flex-col justify-between gap-4 border-b border-white/10 p-6 sm:flex-row sm:items-center">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Payment history
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Billing payments
              </h3>
            </div>
            <p className="text-sm text-slate-400">
              {billingSummary?.paymentHistory.length ?? 0} records
            </p>
          </div>
          {!billingSummary || billingSummary.paymentHistory.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-semibold">No billing payments yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
                Manual, Razorpay, and Stripe transaction records will appear
                here after payment collection is connected.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-4">Provider</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4">Amount</th>
                    <th className="px-5 py-4">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {billingSummary.paymentHistory.map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-5 py-4 font-semibold">
                        {formatStatus(payment.provider)}
                      </td>
                      <td className="px-5 py-4">
                        <BillingStatusBadge status={payment.status} />
                      </td>
                      <td className="px-5 py-4 font-semibold">
                        {formatCurrency(payment.amount, payment.currency)}
                      </td>
                      <td className="px-5 py-4 text-slate-400">
                        {formatDate(payment.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              Compare available plan limits. Plan changes are handled by the
              platform owner while gateway billing is not connected.
            </p>
          </div>
          <p className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-slate-300">
            Platform-managed
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
                  {(Object.keys(planOptionLimits) as PlanResource[]).map(
                    (resource) => (
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
                    ),
                  )}
                </div>

                <div className="mt-auto pt-7">
                  {currentPlan ? (
                    <Button disabled className="w-full" type="button">
                      Current plan
                    </Button>
                  ) : (
                    <Button disabled className="w-full" type="button">
                      Contact platform admin
                    </Button>
                  )}
                  <p className="mt-3 text-center text-xs text-slate-500">
                    Tenant-side checkout and plan changes are not enabled.
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {selectedInvoice ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-3xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge className="border-white/15 bg-white/10 text-white">
                  Invoice detail
                </Badge>
                <h3 className="mt-4 text-2xl font-semibold">
                  {selectedInvoice.invoice_number}
                </h3>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-sm font-semibold text-slate-400 transition hover:bg-white/10 hover:text-white"
                onClick={() => setSelectedInvoice(null)}
                type="button"
              >
                X
              </button>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase text-slate-500">Status</p>
                <div className="mt-2">
                  <BillingStatusBadge status={selectedInvoice.status} />
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase text-slate-500">Total</p>
                <p className="mt-2 font-semibold">
                  {formatCurrency(
                    selectedInvoice.total_amount,
                    selectedInvoice.currency,
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase text-slate-500">GST number</p>
                <p className="mt-2 font-semibold">
                  {selectedInvoice.gst_number || "Not added"}
                </p>
              </div>
            </div>
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
              <p className="font-semibold">Billing details</p>
              <div className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                <p>Name: {selectedInvoice.billing_name || "Not added"}</p>
                <p>Email: {selectedInvoice.billing_email || "Not added"}</p>
                <p className="sm:col-span-2">
                  Address: {selectedInvoice.billing_address || "Not added"}
                </p>
              </div>
            </div>
            <div className="mt-6 overflow-x-auto rounded-3xl border border-white/10">
              <table className="min-w-[620px] w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-4">Item</th>
                    <th className="px-5 py-4">Qty</th>
                    <th className="px-5 py-4">Unit</th>
                    <th className="px-5 py-4">Tax</th>
                    <th className="px-5 py-4">Line total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {selectedInvoice.items.length === 0 ? (
                    <tr>
                      <td className="px-5 py-5 text-slate-400" colSpan={5}>
                        No line items attached.
                      </td>
                    </tr>
                  ) : (
                    selectedInvoice.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-5 py-4 font-semibold">
                          {item.description}
                        </td>
                        <td className="px-5 py-4">{item.quantity}</td>
                        <td className="px-5 py-4">
                          {formatCurrency(item.unit_price, selectedInvoice.currency)}
                        </td>
                        <td className="px-5 py-4">{item.tax_percent}%</td>
                        <td className="px-5 py-4 font-semibold">
                          {formatCurrency(item.line_total, selectedInvoice.currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
