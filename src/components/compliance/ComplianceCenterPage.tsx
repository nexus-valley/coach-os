"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  activityActionOptions,
  activityEntityOptions,
  activitySeverityOptions,
  formatActivityAction,
  formatActivityEntity,
  formatActivityTimestamp,
  formatRelativeActivityTime,
  getActivityActor,
  getEntityIconClass,
  getEntityIconLabel,
  getSeverityBadgeClass,
} from "@/src/lib/activityFormatter";
import type { AuditLog, AuditLogSeverity } from "@/src/lib/auditLogger";
import {
  complianceCategoryOptions,
  exportComplianceEventsCsv,
  getComplianceCenterData,
  getComplianceMetadataSummary,
  type ComplianceCategory,
  type ComplianceData,
  type ComplianceFilters,
} from "@/src/lib/compliance";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

const pageSize = 50;

function getErrorMessage(caught: unknown) {
  if (caught instanceof Error) {
    return caught.message;
  }

  if (
    caught &&
    typeof caught === "object" &&
    "message" in caught &&
    typeof caught.message === "string"
  ) {
    return caught.message;
  }

  return "Unable to load compliance data.";
}

function SummaryCard({
  helper,
  label,
  tone = "light",
  value,
}: {
  helper: string;
  label: string;
  tone?: "danger" | "light" | "success" | "warning";
  value: number;
}) {
  return (
    <Card className="p-5 shadow-sm">
      <Badge tone={tone}>{label}</Badge>
      <p className="mt-4 text-3xl font-semibold tracking-normal text-[#0B1F33]">
        {value.toLocaleString()}
      </p>
      <p className="mt-2 text-sm leading-6 text-[#66788F]">{helper}</p>
    </Card>
  );
}

function EventList({
  emptyText,
  events,
}: {
  emptyText: string;
  events: AuditLog[];
}) {
  if (events.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-4 text-sm leading-6 text-[#425B76]">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div
          className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
          key={event.id}
        >
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={[
                    "flex h-9 w-9 items-center justify-center rounded-xl border text-xs font-semibold",
                    getEntityIconClass(event.entity_type),
                  ].join(" ")}
                >
                  {getEntityIconLabel(event.entity_type)}
                </span>
                <p className="font-semibold text-[#0B1F33]">
                  {formatActivityAction(event.action)}
                </p>
                <Badge>{formatActivityEntity(event.entity_type)}</Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#66788F]">
                {event.description ||
                  event.entity_name ||
                  "Compliance event recorded."}
              </p>
              <p className="mt-2 text-xs leading-5 text-[#66788F]">
                Metadata: {getComplianceMetadataSummary(event)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <span
                className={[
                  "rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                  getSeverityBadgeClass(event.severity),
                ].join(" ")}
              >
                {event.severity}
              </span>
              <Badge tone="dark">
                {formatRelativeActivityTime(event.created_at)}
              </Badge>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Timeline({ events }: { events: AuditLog[] }) {
  if (events.length === 0) {
    return (
      <Card className="p-10 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-[#9ADDEA] bg-[#EAF8FC] text-lg font-semibold text-[#145DA0] shadow-sm">
          AC
        </div>
        <h2 className="mt-5 text-xl font-semibold text-[#0B1F33]">
          No audit events found
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#425B76]">
          Adjust filters or perform audited workspace actions to populate the
          compliance timeline.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-[#D8E8F0]">
        {events.map((event) => (
          <div
            className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto]"
            key={event.id}
          >
            <div
              className={[
                "flex h-12 w-12 items-center justify-center rounded-2xl border text-xs font-semibold shadow-sm",
                getEntityIconClass(event.entity_type),
              ].join(" ")}
            >
              {getEntityIconLabel(event.entity_type)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-[#0B1F33]">
                  {formatActivityAction(event.action)}
                </h3>
                <Badge>{formatActivityEntity(event.entity_type)}</Badge>
                <span
                  className={[
                    "rounded-full border px-2.5 py-1 text-xs font-semibold capitalize",
                    getSeverityBadgeClass(event.severity),
                  ].join(" ")}
                >
                  {event.severity}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                {event.description || event.entity_name || "Audit event recorded."}
              </p>
              <div className="mt-3 grid gap-2 text-xs font-medium text-[#66788F] sm:grid-cols-2 xl:grid-cols-4">
                <span>Actor: {getActivityActor(event)}</span>
                <span>Email: {event.user_email ?? "Not available"}</span>
                <span>Entity ID: {event.entity_id ?? "Not available"}</span>
                <span>Status: recorded</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#66788F]">
                Metadata: {getComplianceMetadataSummary(event)}
              </p>
            </div>
            <div className="text-sm font-semibold text-[#66788F] sm:text-right">
              <p>{formatRelativeActivityTime(event.created_at)}</p>
              <p className="mt-1 text-xs font-medium">
                {formatActivityTimestamp(event.created_at)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AutomationRuns({ data }: { data: ComplianceData }) {
  const hasFailedRun = data.automationRuns.some((run) => run.status === "failed");

  return (
    <Card className="p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <Badge tone="light">Automation & delegation</Badge>
          <h3 className="mt-4 text-xl font-semibold text-[#0B1F33]">
            Workflow accountability
          </h3>
          <p className="mt-2 text-sm leading-6 text-[#66788F]">
            Recent rule changes, execution signals, and delegated permission usage.
          </p>
        </div>
        <Badge tone={hasFailedRun ? "danger" : "success"}>
          {data.automationRuns.length} recent run
          {data.automationRuns.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <EventList
          emptyText="No automation or delegated permission audit events found."
          events={data.automationDelegationEvents}
        />
        <div className="space-y-3">
          {data.automationRuns.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-4 text-sm leading-6 text-[#425B76]">
              No automation runs are visible for this tenant yet.
            </p>
          ) : (
            data.automationRuns.map((run) => (
              <div
                className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                key={run.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-[#0B1F33]">
                    {run.triggerSource ?? "automation trigger"}
                  </p>
                  <Badge
                    tone={
                      run.status === "failed"
                        ? "danger"
                        : run.status === "skipped"
                          ? "warning"
                          : "success"
                    }
                  >
                    {run.status}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-[#66788F]">
                  {run.entityType ?? "entity"} {run.entityId ?? "not available"}
                </p>
                {run.errorMessage ? (
                  <p className="mt-2 text-sm text-red-700">{run.errorMessage}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}

export function ComplianceCenterPage() {
  const [action, setAction] = useState("all");
  const [category, setCategory] = useState<ComplianceCategory>("all");
  const [data, setData] = useState<ComplianceData | null>(null);
  const [dateRange, setDateRange] =
    useState<NonNullable<ComplianceFilters["dateRange"]>>("month");
  const [entityType, setEntityType] = useState("all");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<AuditLogSeverity | "all">("all");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const denied = useMemo(
    () => error.toLowerCase().includes("owners and admins"),
    [error],
  );

  const loadCompliance = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const currentTenant = await getCurrentTenant();

      if (!currentTenant) {
        setData(null);
        setTenant(null);
        setError("Select or create a workspace before opening compliance.");
        return;
      }

      const complianceData = await getComplianceCenterData(currentTenant.id, {
        action,
        category,
        dateRange,
        entityType,
        limit: pageSize,
        page,
        search,
        severity,
      });

      setTenant(currentTenant);
      setData(complianceData);
    } catch (caught) {
      setData(null);
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [action, category, dateRange, entityType, page, search, severity]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadCompliance();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadCompliance]);

  function resetFilters() {
    setAction("all");
    setCategory("all");
    setDateRange("month");
    setEntityType("all");
    setPage(1);
    setSearch("");
    setSeverity("all");
  }

  function exportFiltered() {
    if (!data?.events.length) {
      return;
    }

    setExporting(true);
    try {
      exportComplianceEventsCsv(data.events);
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse">
          <span className="sr-only">Loading compliance center</span>
        </Card>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="mx-auto max-w-7xl">
        <AccessDeniedCard description="Audit and compliance visibility is available to workspace owners and admins only." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-red-200 bg-red-50 p-5 text-red-800">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Unable to load compliance center.</p>
              <p className="mt-2 text-sm leading-6">{error}</p>
            </div>
            <Button onClick={loadCompliance} type="button" variant="secondary">
              Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <Badge tone="owner">Owner/admin only</Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Audit & Compliance Center
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#425B76]">
            Investigate sensitive changes, automation activity, delegated access,
            and finance events for {tenant?.name ?? "this workspace"}.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-full border border-[#D8E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#425B76] shadow-sm">
            Generated {formatActivityTimestamp(data.generatedAt)}
          </div>
          <Button
            disabled={data.events.length === 0 || exporting}
            onClick={exportFiltered}
            type="button"
            variant="secondary"
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </div>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          helper="All audit records visible to this tenant."
          label="Total events"
          value={data.summary.totalAuditEvents}
        />
        <SummaryCard
          helper="Critical, warning, permission, billing, and security-sensitive changes in this view."
          label="Sensitive"
          tone={data.summary.sensitiveEvents > 0 ? "warning" : "success"}
          value={data.summary.sensitiveEvents}
        />
        <SummaryCard
          helper="Failed, blocked, or critical actions in this view."
          label="Failed/blocked"
          tone={data.summary.failedOrBlockedActions > 0 ? "danger" : "success"}
          value={data.summary.failedOrBlockedActions}
        />
        <SummaryCard
          helper="Delegated permission usage events in this view."
          label="Delegation usage"
          tone={data.summary.delegatedPermissionUsage > 0 ? "warning" : "light"}
          value={data.summary.delegatedPermissionUsage}
        />
        <SummaryCard
          helper="Recent automation run records visible to owners/admins."
          label="Automation runs"
          value={data.summary.automationRuns}
        />
        <SummaryCard
          helper="Payment, receipt, invoice, and subscription events in this view."
          label="Payment events"
          value={data.summary.paymentEvents}
        />
        <SummaryCard
          helper="Role, invitation, and team membership events in this view."
          label="User/role changes"
          tone={data.summary.userRoleChanges > 0 ? "warning" : "light"}
          value={data.summary.userRoleChanges}
        />
        <SummaryCard
          helper="Access denials and security events in this view."
          label="Security events"
          tone={data.summary.recentSecurityEvents > 0 ? "warning" : "success"}
          value={data.summary.recentSecurityEvents}
        />
      </section>

      <Card className="mt-8 p-5 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1.2fr_0.9fr_0.9fr_0.8fr_0.8fr_auto]">
          <label className="block">
            <span className="text-xs font-semibold text-[#66788F]">
              Search
            </span>
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/15"
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="Search actor, action, entity, or description"
              value={search}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[#66788F]">
              Category
            </span>
            <select
              className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/15"
              onChange={(event) => {
                setPage(1);
                setCategory(event.target.value as ComplianceCategory);
              }}
              value={category}
            >
              {complianceCategoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[#66788F]">
              Action
            </span>
            <select
              className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/15"
              onChange={(event) => {
                setPage(1);
                setAction(event.target.value);
              }}
              value={action}
            >
              {activityActionOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[#66788F]">
              Entity
            </span>
            <select
              className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/15"
              onChange={(event) => {
                setPage(1);
                setEntityType(event.target.value);
              }}
              value={entityType}
            >
              {activityEntityOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[#66788F]">Date</span>
            <select
              className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/15"
              onChange={(event) => {
                setPage(1);
                setDateRange(event.target.value as typeof dateRange);
              }}
              value={dateRange}
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button
              className="w-full"
              onClick={resetFilters}
              type="button"
              variant="secondary"
            >
              Reset
            </Button>
          </div>
        </div>
        <div className="mt-3 max-w-xs">
          <label className="block">
            <span className="text-xs font-semibold text-[#66788F]">
              Severity
            </span>
            <select
              className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/15"
              onChange={(event) => {
                setPage(1);
                setSeverity(event.target.value as typeof severity);
              }}
              value={severity}
            >
              {activitySeverityOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <section className="mt-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-[#0B1F33]">
              Audit Timeline
            </h2>
            <p className="mt-2 text-sm text-[#66788F]">
              Latest matching events, newest first. CSV export uses the current
              filtered page.
            </p>
          </div>
          <Badge tone="dark">
            {data.total.toLocaleString()} matching event
            {data.total === 1 ? "" : "s"}
          </Badge>
        </div>
        <div className="mt-5">
          <Timeline events={data.events} />
        </div>
        <div className="mt-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-sm text-[#66788F]">
            Page {page} - {pageSize} records per page
          </p>
          <div className="flex gap-3">
            <Button
              disabled={page === 1 || loading}
              onClick={() => setPage((current) => Math.max(current - 1, 1))}
              type="button"
              variant="secondary"
            >
              Previous
            </Button>
            <Button
              disabled={!data.hasMore || loading}
              onClick={() => setPage((current) => current + 1)}
              type="button"
              variant="secondary"
            >
              Next
            </Button>
          </div>
        </div>
      </section>

      <section className="mt-10 grid gap-5 xl:grid-cols-2">
        <Card className="p-6 shadow-sm">
          <Badge tone="warning">Sensitive events</Badge>
          <h3 className="mt-4 text-xl font-semibold text-[#0B1F33]">
            High-attention changes
          </h3>
          <p className="mt-2 text-sm leading-6 text-[#66788F]">
            Role, permission, billing, settings, deletion, and security-related
            audit records in the current result set.
          </p>
          <div className="mt-5">
            <EventList
              emptyText="No sensitive events found for the current filters."
              events={data.sensitiveEvents}
            />
          </div>
        </Card>
        <Card className="p-6 shadow-sm">
          <Badge tone="success">Payment & finance</Badge>
          <h3 className="mt-4 text-xl font-semibold text-[#0B1F33]">
            Finance audit
          </h3>
          <p className="mt-2 text-sm leading-6 text-[#66788F]">
            Payment, receipt, payment link, invoice, and subscription events
            visible to this tenant.
          </p>
          <div className="mt-5">
            <EventList
              emptyText="No payment or finance events found for the current filters."
              events={data.paymentEvents}
            />
          </div>
        </Card>
      </section>

      <section className="mt-10">
        <AutomationRuns data={data} />
      </section>
    </div>
  );
}
