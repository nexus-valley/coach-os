"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import { getCohortsForTenant, type CohortWithCourse } from "@/src/lib/cohorts";
import { canAccessAttendance, canManageAttendance } from "@/src/lib/permissions";
import {
  createSession,
  getSessionsForTenant,
  type SessionStatus,
  type TrainingSessionWithRelations,
} from "@/src/lib/sessions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type SessionFormState = {
  cohortId: string;
  courseId: string;
  description: string;
  scheduledEndAt: string;
  scheduledStartAt: string;
  title: string;
};

const emptyForm: SessionFormState = {
  cohortId: "",
  courseId: "",
  description: "",
  scheduledEndAt: "",
  scheduledStartAt: "",
  title: "",
};

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

function getStatusTone(status: SessionStatus): "danger" | "success" | "warning" {
  if (status === "completed") {
    return "success";
  }

  if (status === "canceled") {
    return "danger";
  }

  return "warning";
}

function toDateTimeLocalValue(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function defaultStartTime() {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return toDateTimeLocalValue(date);
}

function defaultEndTime(startValue: string) {
  const date = new Date(startValue);
  date.setHours(date.getHours() + 1);
  return toDateTimeLocalValue(date);
}

export function SessionsPageClient() {
  const router = useRouter();
  const [cohorts, setCohorts] = useState<CohortWithCourse[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<SessionFormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState<TrainingSessionWithRelations[]>([]);
  const [statusFilter, setStatusFilter] = useState<SessionStatus | "all">("all");
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const canAccess = canAccessAttendance(currentRole);
  const canManage = canManageAttendance(currentRole);

  async function loadSessionContext(currentTenant: Tenant) {
    const [tenantSessions, tenantCourses, tenantCohorts] = await Promise.all([
      getSessionsForTenant(currentTenant.id),
      getCoursesForTenant(currentTenant.id),
      getCohortsForTenant(currentTenant.id),
    ]);

    setSessions(tenantSessions);
    setCourses(tenantCourses);
    setCohorts(tenantCohorts);
  }

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
          await loadSessionContext(currentTenant);
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load sessions."));
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
  }, [router]);

  const filteredSessions = useMemo(
    () =>
      sessions.filter(
        (session) => statusFilter === "all" || session.status === statusFilter,
      ),
    [sessions, statusFilter],
  );

  function openCreateForm() {
    const start = defaultStartTime();
    setForm({
      ...emptyForm,
      cohortId: cohorts[0]?.id ?? "",
      courseId: cohorts[0]?.course_id ?? courses[0]?.id ?? "",
      scheduledEndAt: defaultEndTime(start),
      scheduledStartAt: start,
    });
    setError("");
    setSuccess("");
    setFormOpen(true);
  }

  async function refreshSessions() {
    if (!tenant) {
      return;
    }

    await loadSessionContext(tenant);
  }

  async function handleCreateSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await createSession({
        cohortId: form.cohortId || null,
        courseId: form.courseId || null,
        description: form.description,
        scheduledEndAt: form.scheduledEndAt,
        scheduledStartAt: form.scheduledStartAt,
        tenantId: tenant.id,
        title: form.title,
      });
      setFormOpen(false);
      setForm(emptyForm);
      await refreshSessions();
      setSuccess("Session created.");
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to create session."));
    } finally {
      setSaving(false);
    }
  }

  if (!loading && currentRole && !canAccess) {
    return (
      <AccessDeniedCard description="You do not have permission to access attendance sessions." />
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge tone="light">Attendance operations</Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Sessions
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#425B76]">
            Schedule cohort classes, mark attendance, and prepare attendance
            analytics for coaching operations.
          </p>
        </div>
        {canManage ? (
          <Button onClick={openCreateForm} size="lg" type="button">
            Create Session
          </Button>
        ) : null}
      </div>

      <Card className="mt-8 border-[#D8E8F0] bg-white p-5 shadow-2xl shadow-[#0B2A3D]/10 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <div>
            <p className="text-sm font-medium text-[#425B76]">
              Current workspace
            </p>
            <p className="mt-1 text-xl font-semibold text-[#0B1F33]">
              {tenant?.name ?? "Loading workspace..."}
            </p>
          </div>
          <div className="rounded-full border border-[#9ADDEA] bg-[#EAF8FC] px-4 py-2 text-sm font-semibold text-[#0B6F87]">
            {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
          </div>
          <label className="block">
            <span className="text-sm font-medium text-[#425B76]">Status</span>
            <select
              className="mt-2 h-11 rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
              onChange={(event) =>
                setStatusFilter(event.target.value as SessionStatus | "all")
              }
              value={statusFilter}
            >
              <option value="all">All sessions</option>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="canceled">Canceled</option>
            </select>
          </label>
        </div>
      </Card>

      {error ? (
        <div className="mt-6">
          <FeedbackAlert onRetry={() => window.location.reload()}>
            {error}
          </FeedbackAlert>
        </div>
      ) : null}

      {success ? (
        <div className="mt-6">
          <FeedbackAlert tone="success">{success}</FeedbackAlert>
        </div>
      ) : null}

      {loading ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Card
              className="h-64 animate-pulse border-[#D8E8F0] bg-white"
              key={item}
            >
              <span className="sr-only">Loading sessions</span>
            </Card>
          ))}
        </section>
      ) : filteredSessions.length === 0 ? (
        <EmptyState
          action={
            canManage
              ? {
                  disabled: courses.length === 0 && cohorts.length === 0,
                  label: "Create Session",
                  onClick: openCreateForm,
                }
              : undefined
          }
          description="Schedule a class for a course or cohort to start marking attendance."
          icon="SE"
          title="No sessions found"
        />
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredSessions.map((session) => {
            const marked =
              session.attendanceCounts.present +
              session.attendanceCounts.absent +
              session.attendanceCounts.late +
              session.attendanceCounts.excused;

            return (
              <Card
                className="flex min-h-72 flex-col justify-between border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10 transition hover:-translate-y-1 hover:shadow-[#0B2A3D]/15"
                key={session.id}
              >
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <Badge tone={getStatusTone(session.status)}>
                      {session.status}
                    </Badge>
                    <span className="text-xs font-medium text-[#66788F]">
                      {formatDateTime(session.scheduled_start_at)}
                    </span>
                  </div>
                  <h3 className="mt-5 text-2xl font-semibold leading-tight text-[#0B1F33]">
                    {session.title}
                  </h3>
                  <p className="mt-3 text-sm font-semibold text-[#0E7490]">
                    {session.cohort?.name ??
                      session.course?.title ??
                      "General session"}
                  </p>
                  <p className="mt-4 line-clamp-3 text-sm leading-6 text-[#425B76]">
                    {session.description || "No session notes added yet."}
                  </p>
                </div>
                <div className="mt-8 border-t border-[#D8E8F0] pt-5">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-2xl bg-[#F6FBFE] p-3">
                      <p className="font-semibold text-[#0B1F33]">
                        {marked}
                      </p>
                      <p className="mt-1 text-xs text-[#66788F]">Marked</p>
                    </div>
                    <div className="rounded-2xl bg-[#F6FBFE] p-3">
                      <p className="font-semibold text-[#0B1F33]">
                        {session.attendanceCounts.present +
                          session.attendanceCounts.late}
                      </p>
                      <p className="mt-1 text-xs text-[#66788F]">Attended</p>
                    </div>
                  </div>
                  <div className="mt-5">
                    <Button href={`/app/sessions/${session.id}`} size="sm">
                      Open Attendance
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </section>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#0B2A3D]/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-2xl border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/30 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#66788F]">
                  Attendance setup
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-[#0B1F33]">
                  Create Session
                </h3>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#D8E8F0] text-sm font-semibold text-[#66788F] transition hover:bg-[#F3FAFD] hover:text-[#0B1F33]"
                onClick={() => setFormOpen(false)}
                type="button"
              >
                X
              </button>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleCreateSession}>
              <label className="block">
                <span className="text-sm font-medium text-[#425B76]">
                  Session title
                </span>
                <input
                  className="mt-2 h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition placeholder:text-[#66788F] focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Weekly live class"
                  required
                  type="text"
                  value={form.title}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-[#425B76]">
                    Course
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        courseId: event.target.value,
                      }))
                    }
                    value={form.courseId}
                  >
                    <option value="">Select course</option>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#425B76]">
                    Cohort
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    onChange={(event) => {
                      const cohort = cohorts.find(
                        (item) => item.id === event.target.value,
                      );
                      setForm((current) => ({
                        ...current,
                        cohortId: event.target.value,
                        courseId: cohort?.course_id ?? current.courseId,
                      }));
                    }}
                    value={form.cohortId}
                  >
                    <option value="">No cohort</option>
                    {cohorts.map((cohort) => (
                      <option key={cohort.id} value={cohort.id}>
                        {cohort.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-[#425B76]">
                    Start
                  </span>
                  <input
                    className="mt-2 h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        scheduledStartAt: event.target.value,
                      }))
                    }
                    required
                    type="datetime-local"
                    value={form.scheduledStartAt}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#425B76]">End</span>
                  <input
                    className="mt-2 h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        scheduledEndAt: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={form.scheduledEndAt}
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-[#425B76]">
                  Description
                </span>
                <textarea
                  className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition placeholder:text-[#66788F] focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Agenda, delivery notes, or class context."
                  value={form.description}
                />
              </label>

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setFormOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={saving} type="submit">
                  {saving ? "Creating..." : "Create Session"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
