"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  getOperationsConsoleData,
  type OperationsAlert,
  type OperationsConsoleData,
  type OperationsFeedItem,
  type OperationsHealthCard,
  type OperationsMetric,
  type OperationsStatus,
  type OperationsUsageItem,
} from "@/src/lib/operations";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

const metricToneClass: Record<OperationsMetric["tone"], string> = {
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  slate: "border-slate-200 bg-slate-50 text-slate-700",
};

const statusTone: Record<OperationsStatus, "success" | "warning" | "danger"> = {
  attention: "warning",
  healthy: "success",
  warning: "danger",
};

const quickLinks = [
  { href: "/app/reports", label: "Reports" },
  { href: "/app/notifications", label: "Notifications" },
  { href: "/app/messages", label: "Messages" },
  { href: "/app/automations", label: "Automations" },
  { href: "/app/payments", label: "Payments" },
  { href: "/app/settings", label: "Settings" },
];

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function MetricCard({ metric }: { metric: OperationsMetric }) {
  return (
    <Card className="border-[#D8E8F0] bg-white p-5 shadow-sm">
      <div
        className={[
          "inline-flex rounded-full border px-3 py-1 text-xs font-semibold",
          metricToneClass[metric.tone],
        ].join(" ")}
      >
        {metric.label}
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-normal text-[#0B1F33]">
        {metric.value}
      </p>
      <p className="mt-2 text-sm leading-6 text-[#66788F]">{metric.helper}</p>
    </Card>
  );
}

function HealthCard({ card }: { card: OperationsHealthCard }) {
  return (
    <Card className="border-[#D8E8F0] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#0B1F33]">{card.title}</p>
          <p className="mt-2 text-sm leading-6 text-[#66788F]">
            {card.description}
          </p>
        </div>
        <Badge tone={statusTone[card.status]}>{card.status}</Badge>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-2xl font-semibold text-[#0B1F33]">{card.value}</p>
        <p className="text-xs font-semibold text-[#66788F]">{card.score}%</p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#EAF7FC]">
        <div
          className={[
            "h-full rounded-full",
            card.status === "healthy"
              ? "bg-[#14B8A6]"
              : card.status === "attention"
                ? "bg-[#F59E0B]"
                : "bg-[#DC2626]",
          ].join(" ")}
          style={{ width: `${card.score}%` }}
        />
      </div>
    </Card>
  );
}

function UsageBar({ item }: { item: OperationsUsageItem }) {
  return (
    <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-semibold text-[#0B1F33]">{item.label}</p>
        <p className="text-xs font-semibold text-[#425B76]">
          {item.limit === "unlimited"
            ? "Unlimited"
            : `${item.used.toLocaleString()} / ${item.limit.toLocaleString()}`}
        </p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
        <div
          className={[
            "h-full rounded-full",
            item.percent >= 100
              ? "bg-[#DC2626]"
              : item.percent >= 80
                ? "bg-[#F59E0B]"
                : "bg-[#145DA0]",
          ].join(" ")}
          style={{ width: `${item.percent}%` }}
        />
      </div>
    </div>
  );
}

function AlertList({ alerts }: { alerts: OperationsAlert[] }) {
  if (alerts.length === 0) {
    return (
      <EmptyState
        description="No operational warnings are active right now."
        icon="OK"
        title="Workspace looks healthy"
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {alerts.map((alert) => (
        <Card
          className="border-[#FED7AA] bg-[#FFFBF7] p-5 shadow-sm"
          key={alert.key}
        >
          <Badge tone={alert.severity === "warning" ? "danger" : "warning"}>
            {alert.severity === "warning" ? "Warning" : "Attention"}
          </Badge>
          <h3 className="mt-4 text-lg font-semibold text-[#0B1F33]">
            {alert.title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[#66788F]">
            {alert.description}
          </p>
        </Card>
      ))}
    </div>
  );
}

function FeedList({
  emptyText,
  items,
}: {
  emptyText: string;
  items: OperationsFeedItem[];
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-4 text-sm text-[#425B76]">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
          key={item.id}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-[#0B1F33]">
                {item.action.replace(/_/g, " ")}
              </p>
              <p className="mt-1 text-sm leading-6 text-[#66788F]">
                {item.description}
              </p>
            </div>
            <Badge
              tone={
                item.severity === "critical"
                  ? "danger"
                  : item.severity === "warning"
                    ? "warning"
                    : "light"
              }
            >
              {item.entityType}
            </Badge>
          </div>
          <p className="mt-3 text-xs font-semibold text-[#66788F]">
            {formatDateTime(item.createdAt)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function OperationsPageClient() {
  const router = useRouter();
  const [data, setData] = useState<OperationsConsoleData | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    let active = true;

    async function loadOperations() {
      setLoading(true);
      setError("");
      setDenied(false);

      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const operationsData = await getOperationsConsoleData(currentTenant.id);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setData(operationsData);
      } catch (caught) {
        if (!active) {
          return;
        }

        const message = getErrorMessage(
          caught,
          "Unable to load operations console.",
        );

        if (message.toLowerCase().includes("owners and admins")) {
          setDenied(true);
        } else {
          setError(message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadOperations();

    return () => {
      active = false;
    };
  }, [router]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-[#D8E8F0] bg-white">
          <span className="sr-only">Loading operations console</span>
        </Card>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="mx-auto max-w-7xl">
        <AccessDeniedCard description="Operations visibility is available to workspace owners and admins only." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl">
        <FeedbackAlert onRetry={() => window.location.reload()}>
          {error || "Unable to load operations console."}
        </FeedbackAlert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
            Read-only operations
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Operations Console
          </h2>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#425B76]">
            Tenant-scoped workspace health, SaaS readiness, security signals,
            communication status, and subscription utilization for{" "}
            {tenant?.name ?? "this workspace"}.
          </p>
        </div>
        <div className="rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm font-semibold text-[#425B76] shadow-sm">
          Generated {formatDateTime(data.generatedAt)}
        </div>
      </div>

      <section className="mt-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-xl font-semibold text-[#0B1F33]">
              Workspace Health
            </h3>
            <p className="mt-2 text-sm text-[#66788F]">
              Setup readiness and operational confidence checks.
            </p>
          </div>
          <Badge tone={data.health.readinessPercent >= 80 ? "success" : "warning"}>
            {data.health.readinessPercent}% ready
          </Badge>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.health.cards.map((card) => (
            <HealthCard card={card} key={card.key} />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h3 className="text-xl font-semibold text-[#0B1F33]">Usage Overview</h3>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.metrics.map((metric) => (
            <MetricCard key={metric.key} metric={metric} />
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-[#D8E8F0] bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <Badge tone="owner">{data.subscription.planName} plan</Badge>
              <h3 className="mt-4 text-xl font-semibold text-[#0B1F33]">
                Subscription & Limits
              </h3>
              <p className="mt-2 text-sm leading-6 text-[#66788F]">
                Trial status and plan utilization based on cached usage snapshots.
              </p>
            </div>
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] px-4 py-3 text-sm font-semibold text-[#425B76]">
              {data.subscription.trial.active
                ? `${data.subscription.trial.daysRemaining} trial days left`
                : data.subscription.trial.expired
                  ? "Trial expired"
                  : "Trial status unavailable"}
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {data.subscription.usage.map((item) => (
              <UsageBar item={item} key={item.key} />
            ))}
          </div>
        </Card>

        <Card className="border-[#D8E8F0] bg-white p-6 shadow-sm">
          <Badge tone="light">Security signals</Badge>
          <h3 className="mt-4 text-xl font-semibold text-[#0B1F33]">
            Operational Signals
          </h3>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {data.securitySignals.map((metric) => (
              <div
                className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                key={metric.key}
              >
                <p className="text-sm font-semibold text-[#425B76]">
                  {metric.label}
                </p>
                <p className="mt-2 text-2xl font-semibold text-[#0B1F33]">
                  {metric.value}
                </p>
                <p className="mt-1 text-xs leading-5 text-[#66788F]">
                  {metric.helper}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-10">
        <h3 className="text-xl font-semibold text-[#0B1F33]">
          Alerts & Warnings
        </h3>
        <div className="mt-5">
          <AlertList alerts={data.alerts} />
        </div>
      </section>

      <section className="mt-10 grid gap-5 lg:grid-cols-4">
        <Card className="border-[#D8E8F0] bg-white p-5 shadow-sm">
          <Badge tone="light">Notifications</Badge>
          <p className="mt-4 text-3xl font-semibold text-[#0B1F33]">
            {data.communication.unreadNotifications}
          </p>
          <p className="mt-2 text-sm text-[#66788F]">Unread tenant notifications</p>
        </Card>
        <Card className="border-[#D8E8F0] bg-white p-5 shadow-sm">
          <Badge tone="light">Messages</Badge>
          <p className="mt-4 text-3xl font-semibold text-[#0B1F33]">
            {data.communication.unreadMessageThreads}
          </p>
          <p className="mt-2 text-sm text-[#66788F]">Unread threads for you</p>
        </Card>
        <Card className="border-[#D8E8F0] bg-white p-5 shadow-sm">
          <Badge tone="light">Threads</Badge>
          <p className="mt-4 text-3xl font-semibold text-[#0B1F33]">
            {data.communication.activeThreads}
          </p>
          <p className="mt-2 text-sm text-[#66788F]">Active message threads</p>
        </Card>
        <Card className="border-[#D8E8F0] bg-white p-5 shadow-sm">
          <Badge tone="light">Announcements</Badge>
          <p className="mt-4 text-3xl font-semibold text-[#0B1F33]">
            {data.communication.recentAnnouncements}
          </p>
          <p className="mt-2 text-sm text-[#66788F]">Recent announcements</p>
        </Card>
      </section>

      <section className="mt-10 grid gap-5 xl:grid-cols-3">
        <Card className="border-[#D8E8F0] bg-white p-6 shadow-sm">
          <h3 className="text-xl font-semibold text-[#0B1F33]">
            Operations Feed
          </h3>
          <div className="mt-5">
            <FeedList
              emptyText="No operational activity has been recorded yet."
              items={data.feed.latest}
            />
          </div>
        </Card>
        <Card className="border-[#D8E8F0] bg-white p-6 shadow-sm">
          <h3 className="text-xl font-semibold text-[#0B1F33]">
            Admin Actions
          </h3>
          <div className="mt-5">
            <FeedList
              emptyText="No recent admin actions found."
              items={data.feed.adminActions}
            />
          </div>
        </Card>
        <Card className="border-[#D8E8F0] bg-white p-6 shadow-sm">
          <h3 className="text-xl font-semibold text-[#0B1F33]">
            Communication Activity
          </h3>
          <div className="mt-5">
            <FeedList
              emptyText="No recent communication activity found."
              items={data.feed.communicationActivity}
            />
          </div>
        </Card>
      </section>

      <section className="mt-10">
        <Card className="border-[#D8E8F0] bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <Badge tone="dark">Quick access</Badge>
              <h3 className="mt-4 text-xl font-semibold text-[#0B1F33]">
                Operational Navigation
              </h3>
              <p className="mt-2 text-sm leading-6 text-[#66788F]">
                Shortcuts only. This console does not include destructive actions,
                impersonation, raw database tools, or tenant deletion controls.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {quickLinks.map((link) => (
                <Button
                  href={link.href}
                  key={link.href}
                  type="button"
                  variant="secondary"
                >
                  {link.label}
                </Button>
              ))}
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
