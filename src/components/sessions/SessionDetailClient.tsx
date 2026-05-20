"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  bulkMarkAttendance,
  canRoleMarkAttendance,
  getSessionAttendanceRoster,
  type AttendanceRosterItem,
  type AttendanceStatus,
  type AttendanceSummary,
} from "@/src/lib/attendance";
import {
  cancelSession,
  completeSession,
  getSessionById,
  type TrainingSessionWithRelations,
} from "@/src/lib/sessions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { canAccessAttendance } from "@/src/lib/permissions";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type SessionDetailClientProps = {
  sessionId: string;
};

type AttendanceDraft = Record<
  string,
  {
    remarks: string;
    status: AttendanceStatus;
  }
>;

const statuses: AttendanceStatus[] = ["present", "absent", "late", "excused"];

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusTone(status: AttendanceStatus) {
  if (status === "present") {
    return "success";
  }

  if (status === "late" || status === "excused") {
    return "warning";
  }

  return "danger";
}

function SessionStatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return <Badge tone="success">completed</Badge>;
  }

  if (status === "canceled") {
    return <Badge tone="danger">canceled</Badge>;
  }

  return <Badge tone="warning">scheduled</Badge>;
}

function buildDraft(roster: AttendanceRosterItem[]) {
  return roster.reduce<AttendanceDraft>((draft, item) => {
    draft[item.student.id] = {
      remarks: item.record?.remarks ?? "",
      status: item.record?.status ?? "present",
    };
    return draft;
  }, {});
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
      <p className="text-2xl font-semibold text-[#0B1F33]">{value}</p>
      <p className="mt-1 text-sm text-[#66788F]">{label}</p>
    </div>
  );
}

export function SessionDetailClient({ sessionId }: SessionDetailClientProps) {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [draft, setDraft] = useState<AttendanceDraft>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState("");
  const [roster, setRoster] = useState<AttendanceRosterItem[]>([]);
  const [session, setSession] = useState<TrainingSessionWithRelations | null>(
    null,
  );
  const [success, setSuccess] = useState("");
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const canAccess = canAccessAttendance(currentRole);
  const canMark = canRoleMarkAttendance(currentRole) && session?.status !== "canceled";

  const loadDetail = useCallback(async (currentTenant: Tenant) => {
    const data = await getSessionAttendanceRoster({
      sessionId,
      tenantId: currentTenant.id,
    });
    setSession(data.session);
    setRoster(data.roster);
    setSummary(data.summary);
    setDraft(buildDraft(data.roster));
  }, [sessionId]);

  useEffect(() => {
    let active = true;

    async function load() {
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

        const role = user
          ? await getCurrentMemberRole(currentTenant.id, user.id)
          : null;

        setTenant(currentTenant);
        setCurrentRole(role);

        if (canAccessAttendance(role)) {
          const currentSession = await getSessionById({
            sessionId,
            tenantId: currentTenant.id,
          });

          if (!currentSession) {
            setError("Session not found in this workspace.");
            return;
          }

          await loadDetail(currentTenant);
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load session."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [loadDetail, router, sessionId]);

  const percentLabel = useMemo(() => {
    if (!summary || summary.percent === null) {
      return "No data";
    }

    return `${summary.percent}%`;
  }, [summary]);

  async function refresh() {
    if (!tenant) {
      return;
    }

    await loadDetail(tenant);
  }

  async function saveAttendance() {
    if (!tenant || !canMark) {
      setActionError("You do not have permission to mark attendance.");
      return;
    }

    setMutating("attendance");
    setActionError("");
    setSuccess("");

    try {
      await bulkMarkAttendance({
        records: roster.map((item) => ({
          remarks: draft[item.student.id]?.remarks ?? "",
          status: draft[item.student.id]?.status ?? "present",
          studentId: item.student.id,
        })),
        sessionId,
        tenantId: tenant.id,
      });
      await refresh();
      setSuccess("Attendance saved.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to save attendance."));
    } finally {
      setMutating("");
    }
  }

  async function updateStatus(nextStatus: "canceled" | "completed") {
    if (!tenant) {
      setActionError("Workspace context is not available.");
      return;
    }

    setMutating(nextStatus);
    setActionError("");
    setSuccess("");

    try {
      if (nextStatus === "completed") {
        await completeSession({ sessionId, tenantId: tenant.id });
        setSuccess("Session completed.");
      } else {
        await cancelSession({ sessionId, tenantId: tenant.id });
        setSuccess("Session canceled.");
      }

      await refresh();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to update session."));
    } finally {
      setMutating("");
    }
  }

  function markAllPresent() {
    setDraft((current) => {
      const next = { ...current };

      for (const item of roster) {
        next[item.student.id] = {
          remarks: next[item.student.id]?.remarks ?? "",
          status: "present",
        };
      }

      return next;
    });
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-[#D8E8F0] bg-white">
          <span className="sr-only">Loading session</span>
        </Card>
      </div>
    );
  }

  if (!currentRole || !canAccess) {
    return (
      <AccessDeniedCard description="You do not have permission to access attendance sessions." />
    );
  }

  if (error || !session) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-[#D8E8F0] bg-white p-8 shadow-2xl shadow-[#0B2A3D]/10">
          <p className="text-sm font-semibold text-[#66788F]">Session detail</p>
          <h2 className="mt-3 text-2xl font-semibold text-[#0B1F33]">
            {error || "Session not found."}
          </h2>
          <Button className="mt-6" href="/app/sessions">
            Back to sessions
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-[#425B76] transition hover:text-[#0B1F33]"
        href="/app/sessions"
      >
        Back to sessions
      </Link>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.38fr]">
        <Card className="border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <SessionStatusBadge status={session.status} />
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-normal text-[#0B1F33]">
                {session.title}
              </h2>
              <p className="mt-3 text-sm font-semibold text-[#0E7490]">
                {session.cohort?.name ??
                  session.course?.title ??
                  "General session"}
              </p>
            </div>
            {canMark ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={mutating === "completed"}
                  onClick={() => updateStatus("completed")}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Complete
                </Button>
                <Button
                  className="text-red-700!"
                  disabled={mutating === "canceled"}
                  onClick={() => updateStatus("canceled")}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            ) : null}
          </div>

          <p className="mt-7 max-w-3xl text-sm leading-6 text-[#425B76]">
            {session.description || "No session notes added yet."}
          </p>

          <div className="mt-8 grid gap-4 border-t border-[#D8E8F0] pt-6 sm:grid-cols-2">
            <div>
              <p className="text-sm text-[#66788F]">Starts</p>
              <p className="mt-2 font-semibold text-[#0B1F33]">
                {formatDateTime(session.scheduled_start_at)}
              </p>
            </div>
            <div>
              <p className="text-sm text-[#66788F]">Ends</p>
              <p className="mt-2 font-semibold text-[#0B1F33]">
                {formatDateTime(session.scheduled_end_at)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10">
          <p className="text-sm font-semibold text-[#66788F]">
            Attendance summary
          </p>
          <h3 className="mt-3 text-3xl font-semibold text-[#0B1F33]">
            {percentLabel}
          </h3>
          <p className="mt-3 text-sm leading-6 text-[#425B76]">
            Present and late students count as attended for this foundation
            metric.
          </p>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Roster" value={summary?.total ?? 0} />
        <SummaryCard label="Present" value={summary?.present ?? 0} />
        <SummaryCard label="Late" value={summary?.late ?? 0} />
        <SummaryCard label="Absent" value={summary?.absent ?? 0} />
        <SummaryCard label="Excused" value={summary?.excused ?? 0} />
      </section>

      {actionError ? (
        <div className="mt-6">
          <FeedbackAlert>{actionError}</FeedbackAlert>
        </div>
      ) : null}

      {success ? (
        <div className="mt-6">
          <FeedbackAlert tone="success">{success}</FeedbackAlert>
        </div>
      ) : null}

      <Card className="mt-6 border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10 sm:p-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <Badge tone="light">Attendance marking</Badge>
            <h3 className="mt-4 text-2xl font-semibold text-[#0B1F33]">
              Student roster
            </h3>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#425B76]">
              Mark attendance for students from the linked cohort or course
              enrollment list.
            </p>
          </div>
          {canMark && roster.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={markAllPresent} type="button" variant="secondary">
                Mark All Present
              </Button>
              <Button
                disabled={mutating === "attendance"}
                onClick={saveAttendance}
                type="button"
              >
                {mutating === "attendance" ? "Saving..." : "Save Attendance"}
              </Button>
            </div>
          ) : null}
        </div>

        {roster.length === 0 ? (
          <EmptyState
            description="Add students to the linked cohort or enroll them in the linked course before marking attendance."
            icon="AT"
            title="No students available for this session"
          />
        ) : (
          <div className="mt-8 divide-y divide-[#D8E8F0] overflow-hidden rounded-3xl border border-[#D8E8F0]">
            {roster.map((item) => {
              const current = draft[item.student.id] ?? {
                remarks: "",
                status: item.record?.status ?? "present",
              };

              return (
                <div
                  className="grid gap-4 bg-white p-4 lg:grid-cols-[1fr_1.3fr_1fr] lg:items-center"
                  key={item.student.id}
                >
                  <div>
                    <p className="font-semibold text-[#0B1F33]">
                      {item.student.full_name}
                    </p>
                    <p className="mt-1 text-sm text-[#66788F]">
                      {item.student.email || item.student.phone || "No contact added"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {statuses.map((status) => (
                      <button
                        className={[
                          "rounded-full border px-3 py-2 text-xs font-semibold transition",
                          current.status === status
                            ? "border-[#145DA0] bg-[#145DA0] text-white"
                            : "border-[#D8E8F0] bg-[#F6FBFE] text-[#425B76] hover:border-[#2ECBEA]",
                        ].join(" ")}
                        disabled={!canMark}
                        key={status}
                        onClick={() =>
                          setDraft((existing) => ({
                            ...existing,
                            [item.student.id]: {
                              ...current,
                              status,
                            },
                          }))
                        }
                        type="button"
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={statusTone(current.status)}>
                      {current.status}
                    </Badge>
                    <input
                      className="h-10 min-w-0 flex-1 rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm text-[#0B1F33] outline-none transition placeholder:text-[#66788F] focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                      disabled={!canMark}
                      onChange={(event) =>
                        setDraft((existing) => ({
                          ...existing,
                          [item.student.id]: {
                            ...current,
                            remarks: event.target.value,
                          },
                        }))
                      }
                      placeholder="Remarks"
                      value={current.remarks}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
