"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  activityActionOptions,
  activityEntityOptions,
  activitySeverityOptions,
  exportActivityLogsCsv,
  formatActivityAction,
  formatActivityEntity,
  formatActivityTimestamp,
  formatRelativeActivityTime,
  getActivityActor,
  getActivityDateGroup,
  getActivityInitial,
  getActivitySentence,
  getEntityIconClass,
  getEntityIconLabel,
  getSeverityBadgeClass,
  normalizeSeverity,
} from "@/src/lib/activityFormatter";
import {
  getAuditLogById,
  getAuditLogsForTenant,
  type AuditLog,
  type AuditLogFilters,
  type AuditLogSeverity,
} from "@/src/lib/auditLogger";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

const pageSize = 25;

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#66788F]">
        {label}
      </p>
      <p className="mt-1 wrap-break-word text-sm font-medium text-[#0B1F33]">
        {value || "Not available"}
      </p>
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-4 p-5">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          className="grid animate-pulse gap-4 rounded-3xl border border-[#D8E8F0] bg-white p-4 sm:grid-cols-[auto_1fr_auto]"
          key={index}
        >
          <div className="h-12 w-12 rounded-2xl bg-[#EAF7FC]" />
          <div className="space-y-3">
            <div className="h-4 w-2/3 rounded-full bg-[#EAF7FC]" />
            <div className="h-3 w-4/5 rounded-full bg-[#EAF7FC]" />
            <div className="h-3 w-1/3 rounded-full bg-[#EAF7FC]" />
          </div>
          <div className="h-4 w-20 rounded-full bg-[#EAF7FC]" />
        </div>
      ))}
    </div>
  );
}

export function ActivityPageClient() {
  const [action, setAction] = useState("all");
  const [dateRange, setDateRange] =
    useState<NonNullable<AuditLogFilters["dateRange"]>>("all");
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [entityType, setEntityType] = useState("all");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [page, setPage] = useState(1);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [search, setSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [severity, setSeverity] = useState<AuditLogSeverity | "all">("all");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [total, setTotal] = useState(0);

  const canViewActivity = role === "owner" || role === "admin";

  useEffect(() => {
    let active = true;

    async function loadAccess() {
      try {
        const currentTenant = await getCurrentTenant();
        const supabase = getSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!active) {
          return;
        }

        setTenant(currentTenant);

        if (!currentTenant || !user) {
          setRole(null);
          return;
        }

        const currentRole = await getCurrentMemberRole(currentTenant.id, user.id);

        if (active) {
          setRole(currentRole);
        }
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to verify activity access.",
          );
        }
      }
    }

    loadAccess();

    return () => {
      active = false;
    };
  }, []);

  const loadLogs = useCallback(async () => {
    if (!tenant || !canViewActivity) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result = await getAuditLogsForTenant(tenant.id, {
        action,
        dateRange,
        entityType,
        limit: pageSize,
        page,
        search,
        severity,
      });

      setLogs(result.logs);
      setTotal(result.total);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load activity logs.",
      );
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [
    action,
    canViewActivity,
    dateRange,
    entityType,
    page,
    search,
    severity,
    tenant,
  ]);

  useEffect(() => {
    let active = true;

    async function run() {
      await loadLogs();

      if (!active) {
        return;
      }
    }

    run();

    return () => {
      active = false;
    };
  }, [loadLogs]);

  const groupedLogs = useMemo(() => {
    return logs.reduce<Record<string, AuditLog[]>>((groups, log) => {
      const group = getActivityDateGroup(log.created_at);
      groups[group] = groups[group] ?? [];
      groups[group].push(log);
      return groups;
    }, {});
  }, [logs]);

  function resetFilters() {
    setAction("all");
    setDateRange("all");
    setEntityType("all");
    setPage(1);
    setSearch("");
    setSeverity("all");
  }

  async function openActivityDetail(log: AuditLog) {
    setSelectedLog(log);
    setDetailError("");

    if (!tenant) {
      return;
    }

    setDetailLoading(true);

    try {
      const detail = await getAuditLogById(tenant.id, log.id);
      setSelectedLog(detail ?? log);
    } catch (caught) {
      setDetailError(
        caught instanceof Error
          ? caught.message
          : "Unable to load activity details.",
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function exportFilteredLogs() {
    if (!tenant || logs.length === 0) {
      return;
    }

    setExporting(true);
    setError("");

    try {
      const exportedLogs: AuditLog[] = [];
      let exportPage = 1;
      let hasMore = true;

      while (hasMore && exportedLogs.length < 1000) {
        const result = await getAuditLogsForTenant(tenant.id, {
          action,
          dateRange,
          entityType,
          limit: 100,
          page: exportPage,
          search,
          severity,
        });

        exportedLogs.push(...result.logs);
        hasMore = result.hasMore;
        exportPage += 1;
      }

      exportActivityLogsCsv(exportedLogs);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to export logs.",
      );
    } finally {
      setExporting(false);
    }
  }

  if (role === "staff") {
    return (
      <Card className="p-8">
        <Badge tone="warning">Restricted</Badge>
        <h1 className="mt-4 text-2xl font-semibold text-[#0B1F33]">
          Activity logs are available to owners and admins.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#425B76]">
          Staff accounts can continue using workspace tools, but audit logs are
          limited to administrative roles.
        </p>
      </Card>
    );
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <Badge>Enterprise Audit Center</Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-[#0B1F33]">
            Activity Timeline
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#425B76]">
            Review tenant-scoped business events, critical changes, payment
            actions, team updates, and workspace settings activity.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-full border border-[#D8E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#425B76] shadow-sm">
            {total} logged event{total === 1 ? "" : "s"}
          </div>
          <Button
            disabled={logs.length === 0 || exporting}
            onClick={exportFilteredLogs}
            type="button"
            variant="secondary"
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </div>

      <Card className="mt-8 p-5">
        <div className="grid gap-3 xl:grid-cols-[1.25fr_0.85fr_0.85fr_0.7fr_0.7fr_auto]">
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
              placeholder="Search user, entity, or description"
              value={search}
            />
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
      </Card>

      {error ? (
        <Card className="mt-6 border-red-200 bg-red-50 p-5 text-red-800">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Unable to load activity logs.</p>
              <p className="mt-2 text-sm leading-6">
                {error.includes("audit_logs") || error.includes("severity")
                  ? "Run the latest audit log SQL migrations in Supabase, then refresh this page."
                  : error}
              </p>
            </div>
            <Button onClick={loadLogs} type="button" variant="secondary">
              Retry
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="mt-6 overflow-hidden">
        {loading ? (
          <ActivitySkeleton />
        ) : logs.length === 0 ? (
          <div className="p-10 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-[#9ADDEA] bg-[#EAF8FC] text-lg font-semibold text-[#145DA0] shadow-sm">
              AC
            </div>
            <h2 className="mt-5 text-xl font-semibold text-[#0B1F33]">
              No activity yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#425B76]">
              Your workspace activity will appear here after audited actions are
              performed. Try adjusting filters if you expected to see events.
            </p>
            <div className="mt-5">
              <Button onClick={resetFilters} type="button" variant="secondary">
                Clear filters
              </Button>
            </div>
          </div>
        ) : (
          <div>
            {["Today", "Yesterday", "Earlier"].map((group) =>
              groupedLogs[group]?.length ? (
                <div key={group}>
                  <div className="border-y border-[#D8E8F0] bg-[#F6FBFE] px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#66788F] first:border-t-0">
                    {group}
                  </div>
                  <div className="divide-y divide-[#D8E8F0]">
                    {groupedLogs[group].map((log) => {
                      const severityValue = normalizeSeverity(log.severity);

                      return (
                        <button
                          className="grid w-full gap-4 p-5 text-left transition hover:bg-[#F6FBFE] focus:bg-[#F6FBFE] focus:outline-none focus:ring-4 focus:ring-[#2ECBEA]/15 sm:grid-cols-[auto_1fr_auto]"
                          key={log.id}
                          onClick={() => openActivityDetail(log)}
                          type="button"
                        >
                          <div
                            className={[
                              "flex h-12 w-12 items-center justify-center rounded-2xl border text-xs font-semibold shadow-sm",
                              getEntityIconClass(log.entity_type),
                            ].join(" ")}
                          >
                            {getEntityIconLabel(log.entity_type)}
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold text-[#0B1F33]">
                                {getActivitySentence(log)}
                              </h3>
                              <span
                                className={[
                                  "rounded-full border px-2.5 py-1 text-xs font-semibold capitalize",
                                  getSeverityBadgeClass(severityValue),
                                ].join(" ")}
                              >
                                {severityValue}
                              </span>
                              <Badge>{formatActivityAction(log.action)}</Badge>
                            </div>
                            {log.description ? (
                              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                                {log.description}
                              </p>
                            ) : null}
                            <p className="mt-2 text-xs font-medium text-[#66788F]">
                              {formatActivityEntity(log.entity_type)}
                              {log.user_email ? ` - ${log.user_email}` : ""}
                            </p>
                          </div>
                          <div className="text-sm font-semibold text-[#66788F] sm:text-right">
                            {formatRelativeActivityTime(log.created_at)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null,
            )}
          </div>
        )}
      </Card>

      <div className="mt-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-[#66788F]">
          Page {page} - latest first - {pageSize} per page
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={page === 1 || loading}
            onClick={() => setPage((currentPage) => Math.max(currentPage - 1, 1))}
            type="button"
            variant="secondary"
          >
            Previous
          </Button>
          <Button
            disabled={loading || page * pageSize >= total}
            onClick={() => setPage((currentPage) => currentPage + 1)}
            type="button"
            variant="secondary"
          >
            Next
          </Button>
        </div>
      </div>

      {selectedLog ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#0B1F33]/35 backdrop-blur-sm">
          <button
            aria-label="Close activity detail"
            className="absolute inset-0 cursor-default"
            onClick={() => setSelectedLog(null)}
            type="button"
          />
          <aside className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-[#D8E8F0] bg-white shadow-2xl shadow-[#0B1F33]/20">
            <div className="sticky top-0 z-10 border-b border-[#D8E8F0] bg-white/95 px-6 py-5 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Badge>Activity detail</Badge>
                  <h2 className="mt-3 text-2xl font-semibold text-[#0B1F33]">
                    {formatActivityAction(selectedLog.action)}
                  </h2>
                  <p className="mt-2 text-sm text-[#425B76]">
                    {formatActivityTimestamp(selectedLog.created_at)}
                  </p>
                </div>
                <Button
                  onClick={() => setSelectedLog(null)}
                  type="button"
                  variant="secondary"
                >
                  Close
                </Button>
              </div>
            </div>

            <div className="space-y-5 p-6">
              <Card className="p-5">
                <div className="flex items-start gap-4">
                  <div
                    className={[
                      "flex h-14 w-14 items-center justify-center rounded-2xl border text-sm font-semibold shadow-sm",
                      getEntityIconClass(selectedLog.entity_type),
                    ].join(" ")}
                  >
                    {getActivityInitial(selectedLog)}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-[#0B1F33]">
                      {getActivitySentence(selectedLog)}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[#425B76]">
                      {selectedLog.description || "No description provided."}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span
                        className={[
                          "rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                          getSeverityBadgeClass(selectedLog.severity),
                        ].join(" ")}
                      >
                        {normalizeSeverity(selectedLog.severity)}
                      </span>
                      <Badge>{formatActivityEntity(selectedLog.entity_type)}</Badge>
                    </div>
                  </div>
                </div>
              </Card>

              {detailError ? (
                <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  {detailError}
                </Card>
              ) : null}

              <Card className="p-5">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#66788F]">
                  Event properties
                </h3>
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <DetailRow label="User" value={getActivityActor(selectedLog)} />
                  <DetailRow label="Email" value={selectedLog.user_email} />
                  <DetailRow
                    label="Entity"
                    value={formatActivityEntity(selectedLog.entity_type)}
                  />
                  <DetailRow label="Entity ID" value={selectedLog.entity_id} />
                  <DetailRow label="Entity name" value={selectedLog.entity_name} />
                  <DetailRow label="Tenant" value={tenant?.name ?? selectedLog.tenant_id} />
                </div>
              </Card>

              <Card className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#66788F]">
                    Metadata JSON
                  </h3>
                  {detailLoading ? (
                    <span className="text-xs font-semibold text-[#66788F]">
                      Loading detail...
                    </span>
                  ) : null}
                </div>
                <pre className="mt-4 max-h-80 overflow-auto rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4 text-xs leading-6 text-[#0B1F33]">
                  {JSON.stringify(selectedLog.metadata ?? {}, null, 2)}
                </pre>
              </Card>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
