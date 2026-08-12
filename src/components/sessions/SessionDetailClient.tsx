"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import {
  createSessionFormFromSession,
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
import {
  bulkMarkAttendance,
  canCurrentUserMarkAttendance,
  getSessionAttendanceRoster,
  type AttendanceRosterItem,
  type AttendanceStatus,
} from "@/src/lib/attendance";
import {
  getChangedAttendanceRecords,
  updateAttendanceDraft,
  type AttendanceDraftState,
  type AttendanceDraftValue,
} from "@/src/lib/attendanceRoster";
import { getCohortsForTenant, type CohortWithCourse } from "@/src/lib/cohorts";
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import { getUserDelegatedPermissions } from "@/src/lib/delegatedPermissions";
import { canAccessAttendance, canManageAttendance } from "@/src/lib/permissions";
import { formatSessionDateTime } from "@/src/lib/sessionDateTime";
import {
  canCurrentUserManageSession,
  cancelSession,
  completeSession,
  updateMeetingDetails,
  updateSession,
  type SessionDeliveryMode,
  type SessionMeetingProvider,
  type TrainingSessionWithRelations,
} from "@/src/lib/sessions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import { getCurrentTrainerScope } from "@/src/lib/trainerAssignments";

type SessionDetailClientProps = { sessionId: string };
type AttendanceValue = AttendanceDraftValue;
type AttendanceDraft = AttendanceDraftState;
type LifecycleAction = "canceled" | "completed";

const attendanceStatuses: AttendanceStatus[] = ["present", "absent", "late", "excused"];
const deliveryModeLabels: Record<SessionDeliveryMode, string> = { hybrid: "Hybrid", offline: "Offline", online: "Online" };
const providerLabels: Record<SessionMeetingProvider, string> = { custom: "Custom", google_meet: "Google Meet", microsoft_teams: "Microsoft Teams", zoom: "Zoom" };

function getSafeError(caught: unknown, fallback: string) {
  const message = caught instanceof Error ? caught.message : "";
  const safeMessages = new Set([
    "Attendance is read-only for canceled live classes.",
    "Enter a valid date and time.",
    "Enter a valid IANA timezone, such as Asia/Kolkata.",
    "No attendance records selected.",
    "Only scheduled sessions can be edited or rescheduled.",
    "Session end time cannot be before start time.",
    "Session not found in this workspace.",
    "That local time does not exist in the selected timezone. Choose another time.",
    "That local time occurs twice in the selected timezone. Choose another time.",
    "This student is no longer eligible for new attendance in this live class.",
    "You do not have permission to manage this live class.",
    "You do not have permission to manage sessions.",
    "You do not have permission to mark attendance.",
    "Workspace context is not available.",
  ]);
  return safeMessages.has(message) ? message : fallback;
}

function attendanceTone(status: AttendanceStatus | null) {
  if (status === "present") return "success" as const;
  if (status === "late" || status === "excused") return "warning" as const;
  if (status === "absent") return "danger" as const;
  return "neutral" as const;
}

function SessionStatusBadge({ status }: { status: string }) {
  return <Badge tone={status === "completed" ? "success" : status === "canceled" ? "danger" : "warning"}>{status}</Badge>;
}

function DeliveryBadge({ deliveryMode }: { deliveryMode: SessionDeliveryMode }) {
  return <Badge tone={deliveryMode === "online" ? "admin" : deliveryMode === "hybrid" ? "light" : "staff"}>{deliveryModeLabels[deliveryMode]}</Badge>;
}

function baselineAttendance(item: AttendanceRosterItem): AttendanceValue {
  return { remarks: item.record?.remarks ?? "", status: item.record?.status ?? null };
}

function AttendanceRow({
  draftValue,
  editable,
  historical,
  item,
  onChange,
}: {
  draftValue?: AttendanceValue;
  editable: boolean;
  historical: boolean;
  item: AttendanceRosterItem;
  onChange: (value: AttendanceValue) => void;
}) {
  const value = draftValue ?? baselineAttendance(item);
  const canEditRemarks = editable && value.status !== null;

  return (
    <div className="grid gap-4 bg-white p-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(18rem,1.2fr)_minmax(12rem,0.8fr)] lg:items-center">
      <div className="min-w-0">
        <p className="break-words font-semibold text-[#0B1F33]">{item.student.full_name}</p>
        <p className="mt-1 break-all text-sm text-[#64748B]">{item.student.email || item.student.phone || "No contact added"}</p>
        {historical ? <div className="mt-2"><Badge tone="light">Historical attendance</Badge></div> : null}
      </div>
      <div aria-label={`Attendance status for ${item.student.full_name}`} className="flex flex-wrap gap-2" role="group">
        {!item.hasExistingAttendance ? (
          <button
            className={value.status === null ? "min-h-10 rounded-lg border border-[#64748B] bg-[#F1F5F9] px-3 text-xs font-semibold text-[#334155]" : "min-h-10 rounded-lg border border-[#D8E8F0] bg-white px-3 text-xs font-semibold text-[#526A80]"}
            disabled={!editable}
            onClick={() => onChange({ remarks: "", status: null })}
            type="button"
          >
            Unmarked
          </button>
        ) : null}
        {attendanceStatuses.map((status) => (
          <button
            className={value.status === status ? "min-h-10 rounded-lg border border-[#145DA0] bg-[#145DA0] px-3 text-xs font-semibold capitalize text-white" : "min-h-10 rounded-lg border border-[#D8E8F0] bg-[#F8FAFC] px-3 text-xs font-semibold capitalize text-[#425B76] hover:border-[#2ECBEA]"}
            disabled={!editable}
            key={status}
            onClick={() => onChange({ ...value, status })}
            type="button"
          >
            {status}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <Badge tone={attendanceTone(value.status)}>{value.status ?? "Unmarked"}</Badge>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Remarks for {item.student.full_name}</span>
          <input
            className="h-10 w-full min-w-0 rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm text-[#0B1F33] disabled:bg-[#F1F5F9]"
            disabled={!canEditRemarks}
            onChange={(event) => onChange({ ...value, remarks: event.target.value })}
            placeholder={value.status === null ? "Choose a status first" : "Remarks"}
            value={value.remarks}
          />
        </label>
      </div>
    </div>
  );
}

export function SessionDetailClient({ sessionId }: SessionDetailClientProps) {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [canManageEffective, setCanManageEffective] = useState(false);
  const [canMarkEffective, setCanMarkEffective] = useState(false);
  const [cohorts, setCohorts] = useState<CohortWithCourse[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [draft, setDraft] = useState<AttendanceDraft>({});
  const [editForm, setEditForm] = useState<SessionFormState | null>(null);
  const [error, setError] = useState("");
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState("");
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState("");
  const [roster, setRoster] = useState<AttendanceRosterItem[]>([]);
  const [selectorLoading, setSelectorLoading] = useState(false);
  const [session, setSession] = useState<TrainingSessionWithRelations | null>(null);
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [trainerCohortIds, setTrainerCohortIds] = useState<string[]>([]);
  const [trainerCourseIds, setTrainerCourseIds] = useState<string[]>([]);
  const canAccess = canAccessAttendance(currentRole);
  const canMark = canMarkEffective && session?.status !== "canceled";
  const dirtyCount = Object.keys(draft).length;

  const loadDetail = useCallback(async (currentTenant: Tenant) => {
    const data = await getSessionAttendanceRoster({ sessionId, tenantId: currentTenant.id });
    const [markAllowed, manageAllowed] = await Promise.all([
      canCurrentUserMarkAttendance({ session: data.session, sessionId, studentIds: data.roster.map((item) => item.student.id), tenantId: currentTenant.id }),
      canCurrentUserManageSession({ cohortId: data.session.cohort_id, courseId: data.session.course_id, sessionId: data.session.id, tenantId: currentTenant.id }),
    ]);
    setSession(data.session); setRoster(data.roster); setDraft({});
    setCanManageEffective(manageAllowed); setCanMarkEffective(markAllowed);
    return data.session;
  }, [sessionId]);

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
        setTenant(currentTenant); setCurrentRole(role);
        if (canAccessAttendance(role)) {
          await loadDetail(currentTenant);
          if (role === "trainer") {
            const scope = await getCurrentTrainerScope(currentTenant.id);
            setTrainerCourseIds(scope?.courseIds ?? []);
            setTrainerCohortIds(scope?.cohortIds ?? []);
          }
        }
      } catch (caught) {
        if (active) setError(getSafeError(caught, "Live class could not be loaded."));
      } finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; };
  }, [loadDetail, router]);

  useEffect(() => {
    if (dirtyCount === 0) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirtyCount]);

  const currentRows = useMemo(() => roster.filter((item) => item.isNewAttendanceEligible), [roster]);
  const historicalRows = useMemo(() => roster.filter((item) => item.hasExistingAttendance && !item.isNewAttendanceEligible), [roster]);
  const currentRecorded = currentRows.filter((item) => item.hasExistingAttendance).length;
  const currentAttended = currentRows.filter((item) => item.record?.status === "present" || item.record?.status === "late").length;
  const attendancePercent = currentRecorded > 0 ? Math.round((currentAttended / currentRecorded) * 100) : null;

  async function refresh() { if (tenant) await loadDetail(tenant); }

  function updateDraft(item: AttendanceRosterItem, value: AttendanceValue) {
    setDraft((current) =>
      updateAttendanceDraft({
        baseline: baselineAttendance(item),
        current,
        next: value,
        studentId: item.student.id,
      }),
    );
  }

  async function saveAttendance() {
    if (!tenant || !canMark || mutating || dirtyCount === 0) return;
    const { hasUnmarkedChange, records } = getChangedAttendanceRecords(draft);
    if (hasUnmarkedChange) { setActionError("Choose an attendance status for each changed row."); return; }
    setMutating("attendance"); setActionError(""); setSuccess("");
    try {
      await bulkMarkAttendance({ records, sessionId, tenantId: tenant.id });
      await refresh(); setSuccess(`${records.length} attendance ${records.length === 1 ? "change" : "changes"} saved.`);
    } catch (caught) { setActionError(getSafeError(caught, "Attendance could not be saved.")); }
    finally { setMutating(""); }
  }

  function markAllPresent() {
    setDraft((current) => {
      let next = { ...current };
      for (const item of currentRows) {
        const value = next[item.student.id] ?? baselineAttendance(item);
        const changed = { ...value, status: "present" as const };
        next = updateAttendanceDraft({
          baseline: baselineAttendance(item),
          current: next,
          next: changed,
          studentId: item.student.id,
        });
      }
      return next;
    });
  }

  async function confirmLifecycle() {
    if (!tenant || !session || !lifecycleAction || mutating) return;
    setMutating(lifecycleAction); setActionError(""); setSuccess("");
    try {
      if (lifecycleAction === "completed") { await completeSession({ sessionId, tenantId: tenant.id }); setSuccess("Live class completed."); }
      else { await cancelSession({ sessionId, tenantId: tenant.id }); setSuccess("Live class canceled."); }
      setLifecycleAction(null); await refresh();
    } catch (caught) { setActionError(getSafeError(caught, "Live class status could not be updated.")); }
    finally { setMutating(""); }
  }

  async function openEdit() {
    if (!tenant || !session || session.status !== "scheduled") return;
    setSelectorLoading(true); setActionError("");
    try {
      const [availableCourses, availableCohorts, delegated] = await Promise.all([
        getCoursesForTenant(tenant.id),
        getCohortsForTenant(tenant.id),
        getUserDelegatedPermissions(tenant.id).catch(() => []),
      ]);
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
      const hasSessionDelegation = sessionPermissions.some(
        (permission) =>
          permission.scope_type === "session" && permission.scope_id === session.id,
      );
      const roleManaged = canManageAttendance(currentRole);
      const managedCohorts = roleManaged || workspaceDelegated
        ? availableCohorts
        : availableCohorts.filter(
            (cohort) =>
              delegatedCohortIds.has(cohort.id) ||
              delegatedCourseIds.has(cohort.course_id) ||
              (hasSessionDelegation && cohort.id === session.cohort_id),
          );
      const cohortCourseIds = new Set(managedCohorts.map((cohort) => cohort.course_id));
      const managedCourses = roleManaged || workspaceDelegated
        ? availableCourses
        : availableCourses.filter(
            (course) =>
              delegatedCourseIds.has(course.id) ||
              cohortCourseIds.has(course.id) ||
              (hasSessionDelegation && course.id === session.course_id),
          );
      setCourses(managedCourses); setCohorts(managedCohorts); setEditForm(createSessionFormFromSession(session));
    } catch (caught) { setActionError(getSafeError(caught, "Edit options could not be loaded.")); }
    finally { setSelectorLoading(false); }
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant || !session || !editForm || mutating) return;
    const selectedCohort = cohorts.find((cohort) => cohort.id === editForm.cohortId);
    if (selectedCohort && selectedCohort.course_id !== editForm.courseId) { setActionError("Select a cohort that belongs to the chosen program."); return; }
    setMutating("edit"); setActionError(""); setSuccess("");
    try {
      await updateSession({
        cohortId: editForm.cohortId || null, courseId: editForm.courseId || null,
        description: editForm.description, deliveryMode: editForm.deliveryMode,
        joinAvailableFrom: editForm.joinAvailableFrom || null, meetingId: editForm.meetingId,
        meetingNotes: editForm.meetingNotes, meetingPasscode: editForm.meetingPasscode,
        meetingProvider: editForm.meetingProvider || null, meetingUrl: editForm.meetingUrl,
        recordingUrl: editForm.recordingUrl, scheduledEndAt: editForm.scheduledEndAt,
        scheduledStartAt: editForm.scheduledStartAt, sessionId, tenantId: tenant.id,
        timezone: editForm.timezone, title: editForm.title, trainerUserId: session.trainer_user_id,
      });
      setEditForm(null); await refresh(); setSuccess("Live class updated.");
    } catch (caught) { setActionError(getSafeError(caught, "Session could not be updated.")); }
    finally { setMutating(""); }
  }

  async function saveRecording(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant || !session || session.status !== "completed" || mutating) return;
    setMutating("recording"); setActionError(""); setSuccess("");
    try {
      await updateMeetingDetails({ recordingUrl, sessionId, tenantId: tenant.id });
      setRecordingOpen(false); await refresh(); setSuccess("Recording link updated.");
    } catch (caught) { setActionError(getSafeError(caught, "Recording link could not be updated.")); }
    finally { setMutating(""); }
  }

  if (loading) return <div className="mx-auto max-w-7xl"><Card className="h-72 animate-pulse border-[#D8E8F0] bg-white"><span className="sr-only">Loading live class</span></Card></div>;
  if (!currentRole || !canAccess) return <AccessDeniedCard description="You do not have permission to access live class delivery tools." />;
  if (error || !session) return <div className="mx-auto max-w-7xl"><Card className="border-[#D8E8F0] bg-white p-8"><h1 className="text-2xl font-semibold text-[#0B1F33]">{error || "Live class not found."}</h1><Button className="mt-6" href="/app/sessions">Back to live classes</Button></Card></div>;

  const lifecyclePending = mutating === "completed" || mutating === "canceled";
  const canOpenProgram = currentRole !== "trainer" || (session.course_id ? trainerCourseIds.includes(session.course_id) : false);
  const canOpenCohort = currentRole !== "trainer" || (session.cohort_id ? trainerCohortIds.includes(session.cohort_id) : false);

  return (
    <div className="mx-auto max-w-7xl">
      <Link className="text-sm font-semibold text-[#425B76] hover:text-[#0B1F33]" href="/app/sessions">Back to live classes</Link>

      <header className="mt-5 border-b border-[#D8E8F0] pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2"><SessionStatusBadge status={session.status} /><DeliveryBadge deliveryMode={session.delivery_mode} />{session.status !== "scheduled" ? <Badge tone="neutral">Terminal</Badge> : null}</div>
            <h1 className="mt-4 break-words text-3xl font-semibold text-[#0B1F33] sm:text-4xl">{session.title}</h1>
            <p className="mt-3 text-base font-semibold text-[#425B76]">{formatSessionDateTime(session.scheduled_start_at, session.timezone)}</p>
            <p className="mt-1 text-sm text-[#64748B]">{session.timezone}</p>
          </div>
          {canManageEffective ? (
            <div className="flex flex-wrap gap-2">
              {session.status === "scheduled" ? <Button disabled={selectorLoading || lifecyclePending} onClick={openEdit} variant="secondary">{selectorLoading ? "Loading..." : "Edit / reschedule"}</Button> : null}
              {session.status === "completed" ? <Button onClick={() => { setRecordingUrl(session.recording_url ?? ""); setRecordingOpen(true); }} variant="secondary">Correct recording</Button> : null}
              {session.status === "scheduled" ? <><Button disabled={lifecyclePending} onClick={() => setLifecycleAction("completed")} variant="success">Complete</Button><Button disabled={lifecyclePending} onClick={() => setLifecycleAction("canceled")} variant="destructive">Cancel class</Button></> : null}
            </div>
          ) : null}
        </div>
      </header>

      {actionError ? <div className="mt-5"><FeedbackAlert>{actionError}</FeedbackAlert></div> : null}
      {success ? <div className="mt-5"><FeedbackAlert tone="success">{success}</FeedbackAlert></div> : null}

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="border-[#D8E8F0] bg-white p-5 shadow-lg shadow-[#0B2A3D]/8 sm:p-6">
          <h2 className="text-xl font-semibold text-[#0B1F33]">Class context</h2>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2">
            <div><dt className="text-sm text-[#64748B]">Program</dt><dd className="mt-1 font-semibold text-[#0B1F33]">{session.course_id && session.course ? canOpenProgram ? <Link className="text-[#145DA0] hover:underline" href={`/app/courses/${session.course_id}`}>{session.course.title}</Link> : session.course.title : "General live class"}</dd></div>
            <div><dt className="text-sm text-[#64748B]">Cohort</dt><dd className="mt-1 font-semibold text-[#0B1F33]">{session.cohort_id && session.cohort ? canOpenCohort ? <Link className="text-[#145DA0] hover:underline" href={`/app/cohorts/${session.cohort_id}`}>{session.cohort.name}</Link> : session.cohort.name : "No cohort"}</dd></div>
            <div><dt className="text-sm text-[#64748B]">Ends</dt><dd className="mt-1 font-semibold text-[#0B1F33]">{formatSessionDateTime(session.scheduled_end_at, session.timezone)}</dd></div>
            <div><dt className="text-sm text-[#64748B]">Host</dt><dd className="mt-1 font-semibold text-[#0B1F33]">{session.trainer_user_id ? "Assigned trainer" : "Team hosted"}</dd></div>
          </dl>
          <p className="mt-6 border-t border-[#D8E8F0] pt-5 text-sm leading-6 text-[#425B76]">{session.description || "No class description added."}</p>
        </Card>
        <Card className="border-[#D8E8F0] bg-white p-5 shadow-lg shadow-[#0B2A3D]/8 sm:p-6">
          <h2 className="text-xl font-semibold text-[#0B1F33]">Delivery</h2>
          <p className="mt-3 text-sm leading-6 text-[#425B76]">{session.delivery_mode === "offline" ? "Offline class. No online meeting room is required." : session.delivery_mode === "hybrid" ? "Hybrid class with online and in-person delivery." : "Online class delivered through the configured meeting room."}</p>
          {session.status !== "canceled" && session.delivery_mode !== "offline" && session.meeting_url ? <Button className="mt-4" href={session.meeting_url} variant="secondary">Open meeting room</Button> : null}
          {session.meeting_provider ? <p className="mt-4 text-sm text-[#64748B]">Provider: <span className="font-semibold text-[#0B1F33]">{providerLabels[session.meeting_provider]}</span></p> : null}
          {session.recording_url && session.status === "completed" ? <Button className="mt-3" href={session.recording_url} variant="secondary">Open recording</Button> : null}
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[#526A80]">{session.meeting_notes || "No delivery notes added."}</p>
        </Card>
      </section>

      <section className="mt-8" aria-labelledby="attendance-heading">
        <div className="flex flex-col gap-4 border-b border-[#D8E8F0] pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div><Badge tone="light">Attendance</Badge><h2 className="mt-3 text-2xl font-semibold text-[#0B1F33]" id="attendance-heading">Current roster</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#526A80]">Eligible students start as Unmarked. Only explicit changes are saved.</p></div>
          {canMark && currentRows.length > 0 ? <div className="flex flex-wrap items-center gap-2"><Badge tone={dirtyCount > 0 ? "warning" : "neutral"}>{dirtyCount} unsaved</Badge><Button disabled={mutating === "attendance"} onClick={markAllPresent} variant="secondary">Mark current roster present</Button><Button disabled={dirtyCount === 0 || mutating === "attendance"} isLoading={mutating === "attendance"} loadingText="Saving..." onClick={saveAttendance}>Save attendance</Button></div> : null}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <Card className="border-[#D8E8F0] bg-white p-4"><p className="text-2xl font-semibold text-[#0B1F33]">{currentRows.length}</p><p className="mt-1 text-sm text-[#64748B]">Current roster</p></Card>
          <Card className="border-[#D8E8F0] bg-white p-4"><p className="text-2xl font-semibold text-[#0B1F33]">{currentRecorded}</p><p className="mt-1 text-sm text-[#64748B]">Recorded current</p></Card>
          <Card className="border-[#D8E8F0] bg-white p-4"><p className="text-2xl font-semibold text-[#0B1F33]">{attendancePercent === null ? "No data" : `${attendancePercent}%`}</p><p className="mt-1 text-sm text-[#64748B]">Current attendance</p></Card>
          <Card className="border-[#D8E8F0] bg-white p-4"><p className="text-2xl font-semibold text-[#0B1F33]">{historicalRows.length}</p><p className="mt-1 text-sm text-[#64748B]">Historical records</p></Card>
        </div>
        {currentRows.length === 0 ? <EmptyState description={session.status === "canceled" ? "Canceled classes do not accept new attendance." : "No students currently meet the active roster rules for this class."} icon="AT" title="No current roster" /> : <div className="mt-5 divide-y divide-[#D8E8F0] overflow-hidden rounded-lg border border-[#D8E8F0]">{currentRows.map((item) => <AttendanceRow draftValue={draft[item.student.id]} editable={Boolean(canMark)} historical={false} item={item} key={item.student.id} onChange={(value) => updateDraft(item, value)} />)}</div>}
      </section>

      <section className="mt-8" aria-labelledby="history-heading">
        <h2 className="text-xl font-semibold text-[#0B1F33]" id="history-heading">Historical attendance</h2>
        <p className="mt-2 text-sm leading-6 text-[#526A80]">Persisted records remain visible when a student is no longer eligible. Completed classes allow authorized correction; canceled classes are read-only.</p>
        {historicalRows.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-5 text-sm text-[#64748B]">No historical attendance records.</p> : <div className="mt-4 divide-y divide-[#D8E8F0] overflow-hidden rounded-lg border border-[#D8E8F0]">{historicalRows.map((item) => <AttendanceRow draftValue={draft[item.student.id]} editable={Boolean(canMark)} historical item={item} key={item.student.id} onChange={(value) => updateDraft(item, value)} />)}</div>}
      </section>

      {canMark && dirtyCount > 0 ? <div className="sticky bottom-3 z-20 mt-5 flex flex-col gap-3 rounded-lg border border-[#9ADDEA] bg-white/95 p-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between"><p aria-live="polite" className="text-sm font-semibold text-[#0B1F33]">{dirtyCount} unsaved attendance {dirtyCount === 1 ? "change" : "changes"}</p><Button disabled={mutating === "attendance"} isLoading={mutating === "attendance"} loadingText="Saving..." onClick={saveAttendance}>Save attendance</Button></div> : null}

      {editForm ? <SessionDialog description="Full edits and rescheduling are available only while this class is scheduled." disabled={mutating === "edit"} onClose={() => setEditForm(null)} title="Edit / reschedule live class"><form className="mt-6" onSubmit={saveEdit}><SessionFormFields cohorts={cohorts} courses={courses} form={editForm} onChange={setEditForm} showRecording /><SessionFormActions onCancel={() => setEditForm(null)} saving={mutating === "edit"} submitLabel="Save changes" /></form></SessionDialog> : null}

      {lifecycleAction ? <SessionDialog description={lifecycleAction === "completed" ? "This moves the class to a terminal completed state. Attendance remains correctable for authorized users under the current backend contract." : "This makes attendance read-only. Students may retain a cancellation entry in their portal history where access remains valid."} disabled={lifecyclePending} onClose={() => setLifecycleAction(null)} title={`${lifecycleAction === "completed" ? "Complete" : "Cancel"} ${session.title}?`}><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button disabled={lifecyclePending} onClick={() => setLifecycleAction(null)} variant="secondary">Keep scheduled</Button><Button disabled={lifecyclePending} isLoading={lifecyclePending} loadingText="Updating..." onClick={confirmLifecycle} variant={lifecycleAction === "canceled" ? "destructive" : "success"}>Confirm {lifecycleAction === "completed" ? "completion" : "cancellation"}</Button></div></SessionDialog> : null}

      {recordingOpen ? <SessionDialog description="Completed classes permit recording-link correction only. Other class details remain terminal." disabled={mutating === "recording"} onClose={() => setRecordingOpen(false)} title="Correct recording link"><form className="mt-6" onSubmit={saveRecording}><label className="block"><span className="text-sm font-medium text-[#425B76]">Recording link</span><input className="mt-2 h-12 w-full rounded-lg border border-[#CBD5E1] px-4 text-sm" onChange={(event) => setRecordingUrl(event.target.value)} type="url" value={recordingUrl} /></label><SessionFormActions onCancel={() => setRecordingOpen(false)} saving={mutating === "recording"} submitLabel="Update recording" /></form></SessionDialog> : null}
    </div>
  );
}
