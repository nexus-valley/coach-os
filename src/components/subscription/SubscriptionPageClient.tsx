"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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

function formatPlan(plan: SubscriptionPlan) {
  return getPlanDisplayName(plan);
}

function normalizeBillingPlan(plan: string) {
  return normalizePlanKey(plan);
}

function formatStatus(value: string) {
  return value.replace("_", " ");
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

export function SubscriptionPageClient() {
  const router = useRouter();
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(
    null,
  );
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] =
    useState<TenantSubscription | null>(null);
  const [selectedInvoice, setSelectedInvoice] =
    useState<InvoiceWithItems | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [trialStatus, setTrialStatus] = useState<TrialStatus | null>(null);
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

        const [currentSubscription, currentUsage, currentBillingSummary] =
          await Promise.all([
          getTenantSubscription(currentTenant.id),
          refreshWorkspaceUsageSnapshot(currentTenant.id),
          getBillingSummary(currentTenant.id),
        ]);
        const currentTrialStatus = await getTrialStatus(currentTenant.id);

        if (!active) {
          return;
        }

        setSubscription(currentSubscription);
        setBillingSummary(currentBillingSummary);
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
