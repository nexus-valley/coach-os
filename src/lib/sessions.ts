import { logActivity } from "@/src/lib/auditLogger";
import type { Course } from "@/src/lib/courses";
import type { CohortWithCourse } from "@/src/lib/cohorts";
import {
  canAccessAttendance,
  canManageAttendance,
  getMemberRoleForTenant,
  type MemberRole,
} from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  getCurrentTrainerScope,
  isTrainerAssignedToCohort,
  isTrainerAssignedToCourse,
} from "@/src/lib/trainerAssignments";

export type SessionStatus = "scheduled" | "completed" | "canceled";

export type TrainingSession = {
  cohort_id: string | null;
  course_id: string | null;
  created_at: string;
  created_by: string | null;
  description: string | null;
  id: string;
  scheduled_end_at: string | null;
  scheduled_start_at: string;
  status: SessionStatus;
  tenant_id: string;
  title: string;
  trainer_user_id: string | null;
  updated_at: string;
};

export type TrainingSessionWithRelations = TrainingSession & {
  attendanceCounts: Record<"absent" | "excused" | "late" | "present", number>;
  cohort: Pick<CohortWithCourse, "id" | "name"> | null;
  course: Pick<Course, "id" | "title"> | null;
};

export type SessionInput = {
  cohortId?: string | null;
  courseId?: string | null;
  description: string;
  scheduledEndAt: string;
  scheduledStartAt: string;
  tenantId: string;
  title: string;
  trainerUserId?: string | null;
};

export type UpdateSessionInput = SessionInput & {
  sessionId: string;
};

const sessionColumns =
  "id,tenant_id,course_id,cohort_id,trainer_user_id,title,description,scheduled_start_at,scheduled_end_at,status,created_by,created_at,updated_at";

async function getCurrentUserAndRole(tenantId: string) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("You must be logged in to access sessions.");
  }

  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (!canAccessAttendance(role)) {
    await logActivity({
      action: "access_denied",
      description: "Blocked attendance access attempt.",
      entityName: "Sessions",
      entityType: "security",
      metadata: { role, route: "/app/sessions" },
      severity: "warning",
      tenantId,
    });
    throw new Error("You do not have permission to access sessions.");
  }

  return { role, user };
}

async function ensureCanManageSession(params: {
  cohortId?: string | null;
  courseId?: string | null;
  tenantId: string;
}) {
  const { role, user } = await getCurrentUserAndRole(params.tenantId);

  if (!canManageAttendance(role)) {
    throw new Error("You do not have permission to manage sessions.");
  }

  if (role === "trainer") {
    const [courseAssigned, cohortAssigned] = await Promise.all([
      params.courseId
        ? isTrainerAssignedToCourse(params.tenantId, user.id, params.courseId)
        : Promise.resolve(false),
      params.cohortId
        ? isTrainerAssignedToCohort(params.tenantId, user.id, params.cohortId)
        : Promise.resolve(false),
    ]);

    if (!courseAssigned && !cohortAssigned) {
      await logActivity({
        action: "access_denied",
        description: "Blocked trainer session change outside assignment scope.",
        entityName: "Session assignment scope",
        entityType: "security",
        metadata: {
          cohortId: params.cohortId ?? null,
          courseId: params.courseId ?? null,
          role,
        },
        severity: "warning",
        tenantId: params.tenantId,
      });
      throw new Error("Trainers can only manage sessions for assigned courses or cohorts.");
    }
  }

  return { role, user };
}

function normalizeDateTimeInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function validateSessionInput(input: SessionInput) {
  const title = input.title.trim();
  const scheduledStartAt = normalizeDateTimeInput(input.scheduledStartAt);
  const scheduledEndAt = normalizeDateTimeInput(input.scheduledEndAt);

  if (!title) {
    throw new Error("Session title is required.");
  }

  if (!scheduledStartAt) {
    throw new Error("Scheduled start time is required.");
  }

  if (!input.courseId && !input.cohortId) {
    throw new Error("Select a course or cohort for this session.");
  }

  if (scheduledEndAt && new Date(scheduledEndAt) < new Date(scheduledStartAt)) {
    throw new Error("Session end time cannot be before start time.");
  }

  return { scheduledEndAt, scheduledStartAt, title };
}

function applyTrainerSessionScope<T extends { or: (filters: string) => T }>(
  query: T,
  courseIds: string[],
  cohortIds: string[],
) {
  const filters: string[] = [];

  if (courseIds.length > 0) {
    filters.push(`course_id.in.(${courseIds.join(",")})`);
  }

  if (cohortIds.length > 0) {
    filters.push(`cohort_id.in.(${cohortIds.join(",")})`);
  }

  return filters.length > 0 ? query.or(filters.join(",")) : query;
}

async function attachSessionRelations(
  sessions: TrainingSession[],
  tenantId: string,
) {
  if (sessions.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const courseIds = Array.from(
    new Set(sessions.map((session) => session.course_id).filter(Boolean)),
  ) as string[];
  const cohortIds = Array.from(
    new Set(sessions.map((session) => session.cohort_id).filter(Boolean)),
  ) as string[];
  const sessionIds = sessions.map((session) => session.id);

  const [coursesResult, cohortsResult, attendanceResult] = await Promise.all([
    courseIds.length
      ? supabase
          .from("courses")
          .select("id,title")
          .eq("tenant_id", tenantId)
          .in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    cohortIds.length
      ? supabase
          .from("cohorts")
          .select("id,name")
          .eq("tenant_id", tenantId)
          .in("id", cohortIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("attendance_records")
      .select("session_id,status")
      .eq("tenant_id", tenantId)
      .in("session_id", sessionIds),
  ]);

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  if (cohortsResult.error) {
    throw cohortsResult.error;
  }

  if (attendanceResult.error) {
    throw attendanceResult.error;
  }

  const courseById = new Map(
    ((coursesResult.data ?? []) as Pick<Course, "id" | "title">[]).map(
      (course) => [course.id, course],
    ),
  );
  const cohortById = new Map(
    ((cohortsResult.data ?? []) as Pick<CohortWithCourse, "id" | "name">[]).map(
      (cohort) => [cohort.id, cohort],
    ),
  );
  const countsBySession = new Map<
    string,
    Record<"absent" | "excused" | "late" | "present", number>
  >();

  for (const row of (attendanceResult.data ?? []) as {
    session_id: string;
    status: "absent" | "excused" | "late" | "present";
  }[]) {
    const counts =
      countsBySession.get(row.session_id) ?? {
        absent: 0,
        excused: 0,
        late: 0,
        present: 0,
      };
    counts[row.status] += 1;
    countsBySession.set(row.session_id, counts);
  }

  return sessions.map((session) => ({
    ...session,
    attendanceCounts:
      countsBySession.get(session.id) ?? {
        absent: 0,
        excused: 0,
        late: 0,
        present: 0,
      },
    cohort: session.cohort_id
      ? cohortById.get(session.cohort_id) ?? null
      : null,
    course: session.course_id
      ? courseById.get(session.course_id) ?? null
      : null,
  })) satisfies TrainingSessionWithRelations[];
}

export async function getSessionsForTenant(tenantId: string) {
  await getCurrentUserAndRole(tenantId);
  const supabase = getSupabaseClient();
  const trainerScope = await getCurrentTrainerScope(tenantId);

  if (
    trainerScope &&
    trainerScope.courseIds.length === 0 &&
    trainerScope.cohortIds.length === 0
  ) {
    return [];
  }

  let query = supabase.from("sessions").select(sessionColumns).eq("tenant_id", tenantId);

  if (trainerScope) {
    query = applyTrainerSessionScope(
      query,
      trainerScope.courseIds,
      trainerScope.cohortIds,
    );
  }

  const { data, error } = await query.order("scheduled_start_at", {
    ascending: false,
  });

  if (error) {
    throw error;
  }

  return attachSessionRelations((data ?? []) as TrainingSession[], tenantId);
}

export async function getSessionById(params: {
  sessionId: string;
  tenantId: string;
}) {
  await getCurrentUserAndRole(params.tenantId);
  const trainerScope = await getCurrentTrainerScope(params.tenantId);

  if (trainerScope) {
    const visibleSessions = await getSessionsForTenant(params.tenantId);

    if (!visibleSessions.some((session) => session.id === params.sessionId)) {
      return null;
    }
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("sessions")
    .select(sessionColumns)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.sessionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const [session] = await attachSessionRelations(
    [data as TrainingSession],
    params.tenantId,
  );
  return session ?? null;
}

export async function createSession(input: SessionInput) {
  const validated = validateSessionInput(input);
  const { role, user } = await ensureCanManageSession({
    cohortId: input.cohortId,
    courseId: input.courseId,
    tenantId: input.tenantId,
  });
  const trainerUserId =
    role === "trainer" ? user.id : input.trainerUserId?.trim() || null;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      cohort_id: input.cohortId || null,
      course_id: input.courseId || null,
      created_by: user.id,
      description: input.description.trim() || null,
      scheduled_end_at: validated.scheduledEndAt,
      scheduled_start_at: validated.scheduledStartAt,
      tenant_id: input.tenantId,
      title: validated.title,
      trainer_user_id: trainerUserId,
    })
    .select(sessionColumns)
    .single();

  if (error) {
    throw error;
  }

  const session = data as TrainingSession;

  await logActivity({
    action: "session_created",
    description: "Created class session",
    entityId: session.id,
    entityName: session.title,
    entityType: "session",
    metadata: {
      cohortId: session.cohort_id,
      courseId: session.course_id,
      scheduledStartAt: session.scheduled_start_at,
      trainerUserId: session.trainer_user_id,
    },
    tenantId: session.tenant_id,
  });

  return session;
}

export async function updateSession(input: UpdateSessionInput) {
  const validated = validateSessionInput(input);
  await ensureCanManageSession({
    cohortId: input.cohortId,
    courseId: input.courseId,
    tenantId: input.tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("sessions")
    .update({
      cohort_id: input.cohortId || null,
      course_id: input.courseId || null,
      description: input.description.trim() || null,
      scheduled_end_at: validated.scheduledEndAt,
      scheduled_start_at: validated.scheduledStartAt,
      title: validated.title,
      trainer_user_id: input.trainerUserId?.trim() || null,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.sessionId)
    .select(sessionColumns)
    .single();

  if (error) {
    throw error;
  }

  const session = data as TrainingSession;

  await logActivity({
    action: "session_updated",
    description: "Updated class session",
    entityId: session.id,
    entityName: session.title,
    entityType: "session",
    metadata: {
      cohortId: session.cohort_id,
      courseId: session.course_id,
      scheduledStartAt: session.scheduled_start_at,
      status: session.status,
    },
    tenantId: session.tenant_id,
  });

  return session;
}

async function updateSessionStatus(params: {
  action: "session_canceled" | "session_completed";
  description: string;
  sessionId: string;
  status: Extract<SessionStatus, "canceled" | "completed">;
  tenantId: string;
}) {
  const existing = await getSessionById({
    sessionId: params.sessionId,
    tenantId: params.tenantId,
  });

  if (!existing) {
    throw new Error("Session not found in this workspace.");
  }

  await ensureCanManageSession({
    cohortId: existing.cohort_id,
    courseId: existing.course_id,
    tenantId: params.tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("sessions")
    .update({ status: params.status })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.sessionId)
    .select(sessionColumns)
    .single();

  if (error) {
    throw error;
  }

  const session = data as TrainingSession;

  await logActivity({
    action: params.action,
    description: params.description,
    entityId: session.id,
    entityName: session.title,
    entityType: "session",
    metadata: {
      cohortId: session.cohort_id,
      courseId: session.course_id,
      status: session.status,
    },
    severity: params.action === "session_canceled" ? "warning" : "info",
    tenantId: session.tenant_id,
  });

  return session;
}

export async function cancelSession(params: {
  sessionId: string;
  tenantId: string;
}) {
  return updateSessionStatus({
    action: "session_canceled",
    description: "Canceled class session",
    sessionId: params.sessionId,
    status: "canceled",
    tenantId: params.tenantId,
  });
}

export async function completeSession(params: {
  sessionId: string;
  tenantId: string;
}) {
  return updateSessionStatus({
    action: "session_completed",
    description: "Completed class session",
    sessionId: params.sessionId,
    status: "completed",
    tenantId: params.tenantId,
  });
}

export function canRoleManageSessions(role: MemberRole | null | undefined) {
  return canManageAttendance(role);
}
