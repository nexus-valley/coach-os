"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import {
  createDefaultSessionForm,
  emptySessionForm,
  SessionDialog,
  SessionFormActions,
  SessionFormFields,
  type SessionFormState,
} from "@/src/components/sessions/SessionForm";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { getCohortsForTenant, type CohortWithCourse } from "@/src/lib/cohorts";
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import { getUserDelegatedPermissions } from "@/src/lib/delegatedPermissions";
import { canAccessAttendance, canManageAttendance } from "@/src/lib/permissions";
import {
  classifyOperationalSessions,
  formatSessionDateTime,
} from "@/src/lib/sessionDateTime";
import {
  createSession,
  getOperationalSessionsForTenant,
  type SessionDeliveryMode,
  type SessionStatus,
  type TrainingSessionWithRelations,
} from "@/src/lib/sessions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type SessionGroup = {
  description: string;
  key: "upcoming" | "past-due" | "completed" | "canceled";
  sessions: TrainingSessionWithRelations[];
  title: string;
};

const deliveryModeLabels: Record<SessionDeliveryMode, string> = {
  hybrid: "Hybrid",
  offline: "Offline",
  online: "Online",
};

function getSafeError(caught: unknown, fallback: string) {
  const message = caught instanceof Error ? caught.message : "";
  const allowed = [
    "Enter a valid date and time.",
    "Enter a valid IANA timezone, such as Asia/Kolkata.",
    "Session end time cannot be before start time.",
    "Session title is required.",
    "Select a course or cohort for this session.",
    "That local time does not exist in the selected timezone. Choose another time.",
    "That local time occurs twice in the selected timezone. Choose another time.",
    "You do not have permission to manage sessions.",
  ];

  return allowed.includes(message) ? message : fallback;
}

function statusTone(status: SessionStatus): "danger" | "success" | "warning" {
  return status === "completed" ? "success" : status === "canceled" ? "danger" : "warning";
}

function deliveryTone(mode: SessionDeliveryMode): "admin" | "light" | "staff" {
  return mode === "online" ? "admin" : mode === "hybrid" ? "light" : "staff";
}

function groupSessions(
  sessions: TrainingSessionWithRelations[],
  now = Date.now(),
): SessionGroup[] {
  const groups = classifyOperationalSessions(sessions, now);

  return [
    {
      description: "Scheduled classes ahead, nearest first.",
      key: "upcoming",
      sessions: groups.upcoming,
      title: "Upcoming",
    },
    {
      description: "Scheduled time has passed. Review attendance, then complete or cancel the class.",
      key: "past-due",
      sessions: groups.pastDue,
      title: "Past due / needs attention",
    },
    {
      description: "Completed class history, newest first.",
      key: "completed",
      sessions: groups.completed,
      title: "Completed",
    },
    {
      description: "Canceled class history, newest first.",
      key: "canceled",
      sessions: groups.canceled,
      title: "Canceled",
    },
  ];
}

function SessionCard({ session }: { session: TrainingSessionWithRelations }) {
  const marked = Object.values(session.attendanceCounts).reduce((sum, count) => sum + count, 0);

  return (
    <Card className="border-[#D8E8F0] bg-white p-5 shadow-lg shadow-[#0B2A3D]/8 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge tone={statusTone(session.status)}>{session.status}</Badge>
            <Badge tone={deliveryTone(session.delivery_mode)}>{deliveryModeLabels[session.delivery_mode]}</Badge>
          </div>
          <h4 className="mt-4 break-words text-xl font-semibold text-[#0B1F33]">{session.title}</h4>
          <p className="mt-2 text-sm font-semibold text-[#425B76]">
            {formatSessionDateTime(session.scheduled_start_at, session.timezone)}
          </p>
          <p className="mt-1 text-xs text-[#64748B]">Session timezone: {session.timezone}</p>
        </div>
        <Button href={`/app/sessions/${session.id}`} size="sm" variant="secondary">View session</Button>
      </div>
      <dl className="mt-5 grid gap-3 border-t border-[#D8E8F0] pt-4 text-sm sm:grid-cols-3">
        <div><dt className="text-[#64748B]">Program</dt><dd className="mt-1 font-semibold text-[#0B1F33]">{session.course?.title ?? "General live class"}</dd></div>
        <div><dt className="text-[#64748B]">Cohort</dt><dd className="mt-1 font-semibold text-[#0B1F33]">{session.cohort?.name ?? "No cohort"}</dd></div>
        <div><dt className="text-[#64748B]">Attendance recorded</dt><dd className="mt-1 font-semibold text-[#0B1F33]">{marked}</dd></div>
      </dl>
    </Card>
  );
}

export function SessionsPageClient() {
  const router = useRouter();
  const [cohorts, setCohorts] = useState<CohortWithCourse[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [cohortFilter, setCohortFilter] = useState("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [error, setError] = useState("");
  const [form, setForm] = useState<SessionFormState>(emptySessionForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [managementCohorts, setManagementCohorts] = useState<CohortWithCourse[]>([]);
  const [managementCourses, setManagementCourses] = useState<Course[]>([]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [sessions, setSessions] = useState<TrainingSessionWithRelations[]>([]);
  const [statusFilter, setStatusFilter] = useState<SessionStatus | "all">("all");
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const canAccess = canAccessAttendance(currentRole);
  const canSchedule =
    canManage && (managementCourses.length > 0 || managementCohorts.length > 0);

  async function loadSessionContext(currentTenant: Tenant) {
    const [tenantSessions, tenantCourses, tenantCohorts] = await Promise.all([
      getOperationalSessionsForTenant(currentTenant.id, 200),
      getCoursesForTenant(currentTenant.id),
      getCohortsForTenant(currentTenant.id),
    ]);
    setSessions(tenantSessions);
    setCourses(tenantCourses);
    setCohorts(tenantCohorts);
    return { tenantCohorts, tenantCourses };
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const currentTenant = await getCurrentTenant();
        if (!active) return;
        if (!currentTenant) { router.replace("/onboarding"); return; }
        const supabase = getSupabaseClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        const role = user ? await getCurrentMemberRole(currentTenant.id, user.id) : null;
        setTenant(currentTenant);
        setCurrentRole(role);
        if (canAccessAttendance(role)) {
          const loaded = await loadSessionContext(currentTenant);
          const delegated = user ? await getUserDelegatedPermissions(currentTenant.id, user.id).catch(() => []) : [];
          const hasScope = loaded.tenantCourses.length > 0 || loaded.tenantCohorts.length > 0;
          const sessionPermissions = delegated.filter(
            (permission) => permission.permission_key === "manage_sessions",
          );
          const workspaceDelegated = sessionPermissions.some(
            (permission) => !permission.scope_type || permission.scope_type === "workspace",
          );
          const delegatedCourseIds = new Set(
            sessionPermissions
              .filter((permission) => permission.scope_type === "course")
              .map((permission) => permission.scope_id)
              .filter((id): id is string => Boolean(id)),
          );
          const delegatedCohortIds = new Set(
            sessionPermissions
              .filter((permission) => permission.scope_type === "cohort")
              .map((permission) => permission.scope_id)
              .filter((id): id is string => Boolean(id)),
          );
          const roleManaged = canManageAttendance(role);
          const managedCohorts = roleManaged || workspaceDelegated
            ? loaded.tenantCohorts
            : loaded.tenantCohorts.filter(
                (cohort) =>
                  delegatedCohortIds.has(cohort.id) ||
                  delegatedCourseIds.has(cohort.course_id),
              );
          const cohortCourseIds = new Set(managedCohorts.map((cohort) => cohort.course_id));
          const managedCourses = roleManaged || workspaceDelegated
            ? loaded.tenantCourses
            : loaded.tenantCourses.filter(
                (course) =>
                  delegatedCourseIds.has(course.id) || cohortCourseIds.has(course.id),
              );
          setManagementCourses(managedCourses);
          setManagementCohorts(managedCohorts);
          setCanManage(
            (roleManaged && (role !== "trainer" || hasScope)) ||
              workspaceDelegated ||
              managedCourses.length > 0 ||
              managedCohorts.length > 0,
          );
        }
      } catch (caught) {
        if (active) setError(getSafeError(caught, "Live classes could not be loaded."));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [router]);

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return sessions.filter((session) => {
      if (statusFilter !== "all" && session.status !== statusFilter) return false;
      if (courseFilter !== "all" && session.course_id !== courseFilter) return false;
      if (cohortFilter !== "all" && session.cohort_id !== cohortFilter) return false;
      return !query || session.title.toLocaleLowerCase().includes(query);
    });
  }, [cohortFilter, courseFilter, search, sessions, statusFilter]);
  const programOptions = useMemo(() => {
    const options = new Map(courses.map((course) => [course.id, course.title]));
    for (const cohort of cohorts) {
      if (cohort.course) options.set(cohort.course.id, cohort.course.title);
    }
    for (const session of sessions) {
      if (session.course_id && session.course) {
        options.set(session.course_id, session.course.title);
      }
    }
    return [...options].sort((left, right) => left[1].localeCompare(right[1]));
  }, [cohorts, courses, sessions]);
  const groups = useMemo(() => groupSessions(filteredSessions), [filteredSessions]);
  const filtersActive = Boolean(search.trim()) || statusFilter !== "all" || courseFilter !== "all" || cohortFilter !== "all";

  function resetFilters() {
    setSearch(""); setStatusFilter("all"); setCourseFilter("all"); setCohortFilter("all");
  }

  function openCreateForm() {
    setForm(createDefaultSessionForm(managementCourses, managementCohorts));
    setError(""); setSuccess(""); setFormOpen(true);
  }

  async function refreshSessions() {
    if (tenant) await loadSessionContext(tenant);
  }

  async function handleCreateSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant || saving) return;
    const selectedCohort = managementCohorts.find((cohort) => cohort.id === form.cohortId);
    if (selectedCohort && selectedCohort.course_id !== form.courseId) {
      setError("Select a cohort that belongs to the chosen program.");
      return;
    }
    setSaving(true); setError(""); setSuccess("");
    try {
      await createSession({
        cohortId: form.cohortId || null, courseId: form.courseId || null,
        description: form.description, deliveryMode: form.deliveryMode,
        joinAvailableFrom: form.joinAvailableFrom || null, meetingId: form.meetingId,
        meetingNotes: form.meetingNotes, meetingPasscode: form.meetingPasscode,
        meetingProvider: form.meetingProvider || null, meetingUrl: form.meetingUrl,
        recordingUrl: form.recordingUrl, scheduledEndAt: form.scheduledEndAt,
        scheduledStartAt: form.scheduledStartAt, tenantId: tenant.id,
        timezone: form.timezone, title: form.title,
      });
      setFormOpen(false); setForm(emptySessionForm); await refreshSessions(); setSuccess("Live class created.");
    } catch (caught) {
      setError(getSafeError(caught, "Live class could not be created."));
    } finally { setSaving(false); }
  }

  if (!loading && currentRole && !canAccess) return <AccessDeniedCard description="You do not have permission to access live class scheduling." />;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge tone="light">Live class operations</Badge>
          <h1 className="mt-4 text-3xl font-semibold text-[#0B1F33] sm:text-4xl">Live Classes</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#425B76]">Review upcoming delivery, resolve past-due classes, and keep attendance history organized.</p>
        </div>
        {canSchedule ? <Button onClick={openCreateForm} size="lg">Schedule live class</Button> : null}
      </div>

      <Card className="mt-7 border-[#D8E8F0] bg-white p-5 shadow-lg shadow-[#0B2A3D]/8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_repeat(3,minmax(10rem,0.55fr))_auto] xl:items-end">
          <label className="block"><span className="text-sm font-medium text-[#425B76]">Search title</span><input className="mt-2 h-11 w-full rounded-lg border border-[#CBD5E1] px-3 text-sm" onChange={(event) => setSearch(event.target.value)} type="search" value={search} /></label>
          <label className="block"><span className="text-sm font-medium text-[#425B76]">Status</span><select className="mt-2 h-11 w-full rounded-lg border border-[#CBD5E1] px-3 text-sm" onChange={(event) => setStatusFilter(event.target.value as SessionStatus | "all")} value={statusFilter}><option value="all">All statuses</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="canceled">Canceled</option></select></label>
          <label className="block"><span className="text-sm font-medium text-[#425B76]">Program</span><select className="mt-2 h-11 w-full rounded-lg border border-[#CBD5E1] px-3 text-sm" onChange={(event) => { setCourseFilter(event.target.value); if (event.target.value !== "all") { const cohort = cohorts.find((item) => item.id === cohortFilter); if (cohort?.course_id !== event.target.value) setCohortFilter("all"); } }} value={courseFilter}><option value="all">All programs</option>{programOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
          <label className="block"><span className="text-sm font-medium text-[#425B76]">Cohort</span><select className="mt-2 h-11 w-full rounded-lg border border-[#CBD5E1] px-3 text-sm" onChange={(event) => setCohortFilter(event.target.value)} value={cohortFilter}><option value="all">All cohorts</option>{cohorts.filter((cohort) => courseFilter === "all" || cohort.course_id === courseFilter).map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</select></label>
          <Button disabled={!filtersActive} onClick={resetFilters} variant="secondary">Reset</Button>
        </div>
        <p aria-live="polite" className="mt-4 text-sm text-[#64748B]">Showing {filteredSessions.length} of {sessions.length} bounded live classes.</p>
      </Card>

      {error ? <div className="mt-5"><FeedbackAlert onRetry={() => window.location.reload()}>{error}</FeedbackAlert></div> : null}
      {success ? <div className="mt-5"><FeedbackAlert tone="success">{success}</FeedbackAlert></div> : null}

      {loading ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((item) => <Card className="h-52 animate-pulse border-[#D8E8F0] bg-white" key={item}><span className="sr-only">Loading live classes</span></Card>)}</div>
      ) : filteredSessions.length === 0 ? (
        <EmptyState
          action={filtersActive ? { label: "Reset filters", onClick: resetFilters } : canSchedule ? { label: "Schedule live class", onClick: openCreateForm } : undefined}
          description={filtersActive ? "No live classes match the current search and filters." : "Schedule the first program-linked live class for this workspace."}
          icon="SE"
          title={filtersActive ? "No matching live classes" : "No live classes yet"}
        />
      ) : (
        <div className="mt-7 space-y-9">
          {groups.filter((group) => group.sessions.length > 0).map((group) => (
            <section aria-labelledby={`session-group-${group.key}`} key={group.key}>
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#D8E8F0] pb-3">
                <div><h2 className="text-xl font-semibold text-[#0B1F33]" id={`session-group-${group.key}`}>{group.title}</h2><p className="mt-1 text-sm text-[#64748B]">{group.description}</p></div>
                <Badge tone={group.key === "past-due" ? "warning" : "neutral"}>{group.sessions.length}</Badge>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">{group.sessions.map((session) => <SessionCard key={session.id} session={session} />)}</div>
            </section>
          ))}
        </div>
      )}

      {formOpen ? (
        <SessionDialog description="Times are entered in the selected session timezone. Program and cohort choices stay correlated." disabled={saving} onClose={() => setFormOpen(false)} title="Schedule live class">
          <form className="mt-6" onSubmit={handleCreateSession}>
            <SessionFormFields cohorts={managementCohorts} courses={managementCourses} form={form} onChange={setForm} />
            <SessionFormActions onCancel={() => setFormOpen(false)} saving={saving} submitLabel="Schedule live class" />
          </form>
        </SessionDialog>
      ) : null}
    </div>
  );
}
