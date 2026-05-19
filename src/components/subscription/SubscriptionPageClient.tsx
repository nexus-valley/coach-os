"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import {
  formatResourceLimit,
  getPlanDefinition,
  getPlanDisplayName,
  getPlanLimits,
  planOrder,
  planResourceLabels,
  type PlanKey,
  type PlanResource,
  type ResourceLimit,
} from "@/src/lib/plans";
import {
  getTenantSubscription,
  updateTenantPlanForTesting,
  type SubscriptionPlan,
  type TenantSubscription,
} from "@/src/lib/subscription";
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
          ? "No limit on the Business plan."
          : used < limit
            ? `${Math.max(0, limit - used).toLocaleString()} remaining on this plan.`
            : "Usage is at or above this plan limit."}
      </p>
    </Card>
  );
}

export function SubscriptionPageClient() {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutatingPlan, setMutatingPlan] = useState<SubscriptionPlan | "">("");
  const [subscription, setSubscription] =
    useState<TenantSubscription | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [trialStatus, setTrialStatus] = useState<TrialStatus | null>(null);
  const [usage, setUsage] = useState<UsageCounts>(emptyUsage);

  const limits = useMemo(
    () => getPlanLimits(subscription?.plan ?? "free"),
    [subscription?.plan],
  );
  const canManageSubscription = currentRole === "owner";

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

        const [currentSubscription, currentUsage] = await Promise.all([
          getTenantSubscription(currentTenant.id),
          refreshWorkspaceUsageSnapshot(currentTenant.id),
        ]);
        const currentTrialStatus = await getTrialStatus(currentTenant.id);

        if (!active) {
          return;
        }

        setSubscription(currentSubscription);
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

  async function handlePlanChange(plan: SubscriptionPlan) {
    if (!tenant || !canManageSubscription || plan === subscription?.plan) {
      return;
    }

    setActionError("");
    setActionMessage("");
    setMutatingPlan(plan);

    try {
      const updatedSubscription = await updateTenantPlanForTesting(
        tenant.id,
        plan,
      );

      setSubscription(updatedSubscription);
      setActionMessage(
        `Testing plan changed to ${formatPlan(updatedSubscription.plan)}.`,
      );
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to change plan."));
    } finally {
      setMutatingPlan("");
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

      {actionError ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {actionError}
        </div>
      ) : null}

      {actionMessage ? (
        <div className="mt-6 rounded-3xl border border-teal-400/30 bg-teal-400/10 p-4 text-sm text-teal-100">
          {actionMessage}
        </div>
      ) : null}

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
            Testing only — payment gateway not connected yet.
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

      <section className="mt-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h3 className="text-2xl font-semibold text-white">
              Plan comparison
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Upgrade-ready UI for SaaS billing. Owners can manually switch
              plans while gateway integration is pending.
            </p>
          </div>
          <p className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-slate-300">
            {canManageSubscription ? "Owner controls enabled" : "View only"}
          </p>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((planOption) => {
            const planOptionLimits = getPlanLimits(planOption.plan);
            const currentPlan = planOption.plan === subscription.plan;

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
                  ) : canManageSubscription ? (
                    <Button
                      className="w-full"
                      disabled={mutatingPlan === planOption.plan}
                      onClick={() => handlePlanChange(planOption.plan)}
                      type="button"
                      variant="secondary"
                    >
                      {mutatingPlan === planOption.plan
                        ? "Changing..."
                        : "Change for testing"}
                    </Button>
                  ) : (
                    <Button disabled className="w-full" type="button">
                      Upgrade placeholder
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
