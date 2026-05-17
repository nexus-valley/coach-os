"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  getAuditLogsForTenant,
  type AuditLog,
  type AuditLogFilters,
} from "@/src/lib/auditLogger";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

const actionOptions = [
  ["all", "All actions"],
  ["student_created", "Student created"],
  ["student_updated", "Student updated"],
  ["course_created", "Course created"],
  ["lesson_updated", "Lesson updated"],
  ["enrollment_created", "Enrollment added"],
  ["payment_created", "Payment recorded"],
  ["payment_link_sent", "Payment link sent"],
  ["receipt_generated", "Receipt generated"],
  ["certificate_generated", "Certificate generated"],
  ["reminder_created", "Reminder created"],
  ["reminder_completed", "Reminder completed"],
  ["role_changed", "Role changed"],
  ["settings_updated", "Settings updated"],
  ["demo_data_loaded", "Demo data loaded"],
] as const;

const entityOptions = [
  ["all", "All entities"],
  ["student", "Students"],
  ["course", "Courses"],
  ["lesson", "Lessons"],
  ["enrollment", "Enrollments"],
  ["payment", "Payments"],
  ["payment_link", "Payment links"],
  ["receipt", "Receipts"],
  ["certificate", "Certificates"],
  ["reminder", "Reminders"],
  ["team_member", "Team"],
  ["workspace_settings", "Settings"],
  ["demo_data", "Demo data"],
] as const;

const actionLabels: Record<string, string> = Object.fromEntries(actionOptions);

const actionStyles: Record<string, string> = {
  certificate_generated: "border-amber-200 bg-amber-50 text-amber-700",
  course_created: "border-blue-200 bg-blue-50 text-blue-700",
  demo_data_loaded: "border-cyan-200 bg-cyan-50 text-cyan-700",
  enrollment_created: "border-violet-200 bg-violet-50 text-violet-700",
  lesson_created: "border-blue-200 bg-blue-50 text-blue-700",
  lesson_updated: "border-blue-200 bg-blue-50 text-blue-700",
  payment_created: "border-emerald-200 bg-emerald-50 text-emerald-700",
  payment_link_converted: "border-emerald-200 bg-emerald-50 text-emerald-700",
  payment_link_sent: "border-teal-200 bg-teal-50 text-teal-700",
  receipt_generated: "border-emerald-200 bg-emerald-50 text-emerald-700",
  reminder_completed: "border-slate-200 bg-slate-50 text-slate-700",
  reminder_created: "border-orange-200 bg-orange-50 text-orange-700",
  role_changed: "border-indigo-200 bg-indigo-50 text-indigo-700",
  settings_updated: "border-cyan-200 bg-cyan-50 text-cyan-700",
  student_created: "border-sky-200 bg-sky-50 text-sky-700",
  student_updated: "border-sky-200 bg-sky-50 text-sky-700",
};

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  const seconds = Math.max(Math.floor((Date.now() - timestamp) / 1000), 0);

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(hours / 24);

  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function getDateGroup(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return "Today";
  }

  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  return "Earlier";
}

function formatActionLabel(action: string) {
  return (
    actionLabels[action] ??
    action
      .split("_")
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function getInitial(log: AuditLog) {
  return (log.user_name || log.user_email || "U").trim().charAt(0).toUpperCase();
}

function getActor(log: AuditLog) {
  return log.user_name || log.user_email || "Workspace user";
}

function getLogSentence(log: AuditLog) {
  const entity = log.entity_name ? ` "${log.entity_name}"` : "";
  return `${getActor(log)} ${formatActionLabel(log.action).toLowerCase()}${entity}`;
}

export function ActivityPageClient() {
  const [action, setAction] = useState("all");
  const [dateRange, setDateRange] =
    useState<NonNullable<AuditLogFilters["dateRange"]>>("all");
  const [entityType, setEntityType] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [page, setPage] = useState(1);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [search, setSearch] = useState("");
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

  useEffect(() => {
    let active = true;

    async function loadLogs() {
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
          limit: 25,
          page,
          search,
        });

        if (!active) {
          return;
        }

        setLogs(result.logs);
        setTotal(result.total);
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load activity logs.",
          );
          setLogs([]);
          setTotal(0);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadLogs();

    return () => {
      active = false;
    };
  }, [action, canViewActivity, dateRange, entityType, page, search, tenant]);

  const groupedLogs = useMemo(() => {
    return logs.reduce<Record<string, AuditLog[]>>((groups, log) => {
      const group = getDateGroup(log.created_at);
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
          <Badge>Admin Audit Log</Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-[#0B1F33]">
            Activity Timeline
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#425B76]">
            Review important tenant-scoped actions across students, courses,
            payments, reminders, team settings, certificates, and demo data.
          </p>
        </div>
        <div className="rounded-full border border-[#D8E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#425B76] shadow-sm">
          {total} logged event{total === 1 ? "" : "s"}
        </div>
      </div>

      <Card className="mt-8 p-5">
        <div className="grid gap-3 lg:grid-cols-[1.3fr_0.85fr_0.85fr_0.75fr_auto]">
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
              {actionOptions.map(([value, label]) => (
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
              {entityOptions.map(([value, label]) => (
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
          <p className="font-semibold">Unable to load activity logs.</p>
          <p className="mt-2 text-sm leading-6">
            {error.includes("audit_logs")
              ? "Run the audit log SQL migration in Supabase, then refresh this page."
              : error}
          </p>
        </Card>
      ) : null}

      <Card className="mt-6 overflow-hidden">
        {loading ? (
          <div className="space-y-4 p-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                className="h-20 animate-pulse rounded-2xl bg-[#EAF7FC]"
                key={index}
              />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EAF8FC] text-lg font-semibold text-[#145DA0]">
              A
            </div>
            <h2 className="mt-5 text-xl font-semibold text-[#0B1F33]">
              No activity found
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#425B76]">
              Activity logs will appear here after audited actions are performed
              and the Supabase audit table is available.
            </p>
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
                    {groupedLogs[group].map((log) => (
                      <article
                        className="grid gap-4 p-5 transition hover:bg-[#F6FBFE] sm:grid-cols-[auto_1fr_auto]"
                        key={log.id}
                      >
                        <div
                          className={[
                            "flex h-11 w-11 items-center justify-center rounded-2xl border text-sm font-semibold",
                            actionStyles[log.action] ??
                              "border-[#D8E8F0] bg-white text-[#145DA0]",
                          ].join(" ")}
                        >
                          {getInitial(log)}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-[#0B1F33]">
                              {getLogSentence(log)}
                            </h3>
                            <Badge>{formatActionLabel(log.action)}</Badge>
                          </div>
                          {log.description ? (
                            <p className="mt-2 text-sm leading-6 text-[#425B76]">
                              {log.description}
                            </p>
                          ) : null}
                          <p className="mt-2 text-xs font-medium text-[#66788F]">
                            {log.entity_type}
                            {log.user_email ? ` - ${log.user_email}` : ""}
                          </p>
                        </div>
                        <div className="text-sm font-semibold text-[#66788F] sm:text-right">
                          {formatRelativeTime(log.created_at)}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null,
            )}
          </div>
        )}
      </Card>

      <div className="mt-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-[#66788F]">
          Page {page} - latest first - 25 per page
        </p>
        <div className="flex gap-3">
          <Button
            disabled={page === 1 || loading}
            onClick={() => setPage((currentPage) => Math.max(currentPage - 1, 1))}
            type="button"
            variant="secondary"
          >
            Previous
          </Button>
          <Button
            disabled={loading || page * 25 >= total}
            onClick={() => setPage((currentPage) => currentPage + 1)}
            type="button"
            variant="secondary"
          >
            Next
          </Button>
          <Button disabled type="button" variant="secondary">
            Export logs
          </Button>
        </div>
      </div>
    </div>
  );
}
