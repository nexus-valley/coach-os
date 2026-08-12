import { logActivity } from "@/src/lib/auditLogger";
import { runAutomationTrigger } from "@/src/lib/automationTriggers";
import type { Course } from "@/src/lib/courses";
import type { CohortWithCourse } from "@/src/lib/cohorts";
import {
  explainPermissionSource,
  logDelegatedPermissionUsage,
  type DelegatedPermission,
  type DelegatedPermissionScopeType,
} from "@/src/lib/delegatedPermissions";
import {
  canAccessAttendance,
  canManageAttendance,
  getMemberRoleForTenant,
  type MemberRole,
} from "@/src/lib/permissions";
import {
  createNotificationForTenantRoles,
  createNotificationsForUsers,
  getTenantMemberUserIds,
} from "@/src/lib/notifications";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  getCurrentTrainerScope,
  isTrainerAssignedToCohort,
  isTrainerAssignedToCourse,
} from "@/src/lib/trainerAssignments";
import {
  normalizeSessionTimezone,
  sessionWallClockToIso,
} from "@/src/lib/sessionDateTime";

export type SessionStatus = "scheduled" | "completed" | "canceled";
export type SessionDeliveryMode = "hybrid" | "offline" | "online";
export type SessionMeetingProvider =
  | "custom"
  | "google_meet"
  | "microsoft_teams"
  | "zoom";

export type TrainingSession = {
  cohort_id: string | null;
  course_id: string | null;
  created_at: string;
  created_by: string | null;
  description: string | null;
  delivery_mode: SessionDeliveryMode;
  id: string;
  join_available_from: string | null;
  meeting_id: string | null;
  meeting_notes: string | null;
  meeting_passcode: string | null;
  meeting_provider: SessionMeetingProvider | null;
  meeting_url: string | null;
  recording_url: string | null;
  scheduled_end_at: string | null;
  scheduled_start_at: string;
  status: SessionStatus;
  tenant_id: string;
  timezone: string;
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
  deliveryMode?: SessionDeliveryMode;
  joinAvailableFrom?: string | null;
  meetingId?: string | null;
  meetingNotes?: string | null;
  meetingPasscode?: string | null;
  meetingProvider?: SessionMeetingProvider | null;
  meetingUrl?: string | null;
  recordingUrl?: string | null;
  scheduledEndAt: string;
  scheduledStartAt: string;
  tenantId: string;
  timezone?: string | null;
  title: string;
  trainerUserId?: string | null;
};

export type UpdateSessionInput = SessionInput & {
  sessionId: string;
};

const sessionColumns =
  "id,tenant_id,course_id,cohort_id,trainer_user_id,title,description,delivery_mode,meeting_provider,meeting_url,meeting_id,meeting_passcode,meeting_notes,timezone,join_available_from,recording_url,scheduled_start_at,scheduled_end_at,status,created_by,created_at,updated_at";

type DelegatedSessionDecision =
  | { source: "role" }
  | {
      delegatedPermission: DelegatedPermission;
      scopeId: string | null;
      scopeType: DelegatedPermissionScopeType;
      source: "delegated";
    };

type SessionManagementDenial = "access" | "permission" | "trainer_scope";

type SessionManagementEvaluation =
  | {
      allowed: true;
      decision: DelegatedSessionDecision;
      role: MemberRole | null;
      user: Awaited<ReturnType<typeof getCurrentUserAndRole>>["user"];
    }
  | {
      allowed: false;
      denial: SessionManagementDenial;
      role: MemberRole | null;
      user: Awaited<ReturnType<typeof getCurrentUserAndRole>>["user"];
    };

const deliveryModeLabels: Record<SessionDeliveryMode, string> = {
  hybrid: "Hybrid",
  offline: "Offline",
  online: "Online",
};

async function notifySessionCreated(session: TrainingSession) {
  try {
    const adminUserIds = await getTenantMemberUserIds(session.tenant_id, [
      "owner",
      "admin",
    ]);
    const userIds = Array.from(
      new Set([
        ...adminUserIds,
        ...(session.trainer_user_id ? [session.trainer_user_id] : []),
      ]),
    );

    await createNotificationsForUsers({
      actionUrl: `/app/sessions/${session.id}`,
      entityId: session.id,
      entityType: "session",
      message: `${deliveryModeLabels[session.delivery_mode]} class scheduled for ${new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(session.scheduled_start_at))}.`,
      metadata: {
        cohortId: session.cohort_id,
        courseId: session.course_id,
        deliveryMode: session.delivery_mode,
        event:
          session.delivery_mode === "offline"
            ? "session_created"
            : "live_session_scheduled",
        meetingProvider: session.meeting_provider,
        scheduledStartAt: session.scheduled_start_at,
        trainerUserId: session.trainer_user_id,
      },
      severity: "info",
      tenantId: session.tenant_id,
      title: `${deliveryModeLabels[session.delivery_mode]} class scheduled: ${session.title}`,
      type:
        session.delivery_mode === "offline"
          ? "session_reminder"
          : "live_session_notice",
      userIds,
    });
  } catch {
    // Notifications are non-blocking for session creation.
  }
}

async function notifySessionStatusChange(session: TrainingSession) {
  try {
    await createNotificationForTenantRoles({
      actionUrl: `/app/sessions/${session.id}`,
      entityId: session.id,
      entityType: "session",
      message: `${deliveryModeLabels[session.delivery_mode]} class status changed to ${session.status}.`,
      metadata: {
        cohortId: session.cohort_id,
        courseId: session.course_id,
        deliveryMode: session.delivery_mode,
        event:
          session.status === "canceled" && session.delivery_mode !== "offline"
            ? "live_session_canceled"
            : "session_status_updated",
        meetingProvider: session.meeting_provider,
        status: session.status,
      },
      roles: ["owner", "admin"],
      severity: session.status === "canceled" ? "warning" : "info",
      tenantId: session.tenant_id,
      title: `${deliveryModeLabels[session.delivery_mode]} class ${session.status}: ${session.title}`,
      type:
        session.delivery_mode === "offline"
          ? "session_reminder"
          : "live_session_notice",
    });
  } catch {
    // Notifications are non-blocking for session updates.
  }
}

async function notifySessionUpdated(session: TrainingSession) {
  try {
    await createNotificationForTenantRoles({
      actionUrl: `/app/sessions/${session.id}`,
      entityId: session.id,
      entityType: "session",
      message: `${deliveryModeLabels[session.delivery_mode]} class updated for ${new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(session.scheduled_start_at))}.`,
      metadata: {
        cohortId: session.cohort_id,
        courseId: session.course_id,
        deliveryMode: session.delivery_mode,
        event:
          session.delivery_mode === "offline"
            ? "session_updated"
            : "live_session_updated",
        meetingProvider: session.meeting_provider,
        scheduledStartAt: session.scheduled_start_at,
      },
      roles: ["owner", "admin"],
      severity: "info",
      tenantId: session.tenant_id,
      title: `${deliveryModeLabels[session.delivery_mode]} class updated: ${session.title}`,
      type:
        session.delivery_mode === "offline"
          ? "session_reminder"
          : "live_session_notice",
    });
  } catch {
    // Notifications are non-blocking for session updates.
  }
}

async function notifyMeetingDetailsUpdated(session: TrainingSession) {
  try {
    await createNotificationForTenantRoles({
      actionUrl: `/app/sessions/${session.id}`,
      entityId: session.id,
      entityType: "session",
      message: `Meeting details were updated for ${session.title}.`,
      metadata: {
        deliveryMode: session.delivery_mode,
        meetingProvider: session.meeting_provider,
        scheduledStartAt: session.scheduled_start_at,
      },
      roles: ["owner", "admin"],
      severity: "info",
      tenantId: session.tenant_id,
      title: `Meeting details updated: ${session.title}`,
      type: "live_session_notice",
    });
  } catch {
    // Notifications are non-blocking for session updates.
  }
}

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

  return { role, user };
}

async function ensureCanAccessSessions(tenantId: string) {
  const { role, user } = await getCurrentUserAndRole(tenantId);

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

async function evaluateSessionManagement(params: {
  cohortId?: string | null;
  courseId?: string | null;
  sessionId?: string | null;
  tenantId: string;
}): Promise<SessionManagementEvaluation> {
  const { role, user } = await getCurrentUserAndRole(params.tenantId);

  if (!canAccessAttendance(role)) {
    return { allowed: false, denial: "access", role, user };
  }

  const baseRoleAllowed = canManageAttendance(role);
  const delegatedDecision =
    !baseRoleAllowed || role === "trainer"
      ? await getDelegatedSessionDecision({
        cohortId: params.cohortId,
        courseId: params.courseId,
        sessionId: params.sessionId,
        tenantId: params.tenantId,
        userId: user.id,
      })
      : null;

  if (!baseRoleAllowed && !delegatedDecision) {
    return { allowed: false, denial: "permission", role, user };
  }

  if (role === "trainer" && baseRoleAllowed) {
    const [courseAssigned, cohortAssigned] = await Promise.all([
      params.courseId
        ? isTrainerAssignedToCourse(params.tenantId, user.id, params.courseId)
        : Promise.resolve(false),
      params.cohortId
        ? isTrainerAssignedToCohort(params.tenantId, user.id, params.cohortId)
        : Promise.resolve(false),
    ]);

    if (!courseAssigned && !cohortAssigned && !delegatedDecision) {
      return { allowed: false, denial: "trainer_scope", role, user };
    }

    if (!courseAssigned && !cohortAssigned && delegatedDecision) {
      return { allowed: true, decision: delegatedDecision, role, user };
    }
  }

  return {
    allowed: true,
    decision:
      delegatedDecision ??
      ({ source: "role" } satisfies DelegatedSessionDecision),
    role,
    user,
  };
}

async function ensureCanManageSession(params: {
  cohortId?: string | null;
  courseId?: string | null;
  sessionId?: string | null;
  tenantId: string;
}) {
  const evaluation = await evaluateSessionManagement(params);

  if (evaluation.allowed) {
    return evaluation;
  }

  if (evaluation.denial === "access") {
    await logActivity({
      action: "access_denied",
      description: "Blocked attendance access attempt.",
      entityName: "Sessions",
      entityType: "security",
      metadata: { role: evaluation.role, route: "/app/sessions" },
      severity: "warning",
      tenantId: params.tenantId,
    });
    throw new Error("You do not have permission to access sessions.");
  }

  if (evaluation.denial === "trainer_scope") {
    await logActivity({
      action: "access_denied",
      description: "Blocked trainer session change outside assignment scope.",
      entityName: "Session assignment scope",
      entityType: "security",
      metadata: {
        cohortId: params.cohortId ?? null,
        courseId: params.courseId ?? null,
        role: evaluation.role,
      },
      severity: "warning",
      tenantId: params.tenantId,
    });
    throw new Error(
      "Trainers can only manage sessions for assigned courses or cohorts.",
    );
  }

  throw new Error("You do not have permission to manage sessions.");
}

async function createDelegatedSessionWithRpc(
  input: SessionInput,
  validated: ReturnType<typeof validateSessionInput>,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("create_delegated_session", {
      p_cohort_id: input.cohortId || null,
      p_course_id: input.courseId || null,
      p_delivery_mode: validated.deliveryMode,
      p_description: input.description.trim() || null,
      p_join_available_from: validated.joinAvailableFrom,
      p_meeting_id: validated.meetingId,
      p_meeting_notes: validated.meetingNotes,
      p_meeting_passcode: validated.meetingPasscode,
      p_meeting_provider: validated.meetingProvider,
      p_meeting_url: validated.meetingUrl,
      p_recording_url: validated.recordingUrl,
      p_scheduled_end_at: validated.scheduledEndAt,
      p_scheduled_start_at: validated.scheduledStartAt,
      p_tenant_id: input.tenantId,
      p_timezone: validated.timezone,
      p_title: validated.title,
      p_trainer_user_id: input.trainerUserId?.trim() || null,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as TrainingSession;
}

async function updateDelegatedSessionWithRpc(
  input: UpdateSessionInput,
  validated: ReturnType<typeof validateSessionInput>,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_delegated_session", {
      p_cohort_id: input.cohortId || null,
      p_course_id: input.courseId || null,
      p_delivery_mode: validated.deliveryMode,
      p_description: input.description.trim() || null,
      p_join_available_from: validated.joinAvailableFrom,
      p_meeting_id: validated.meetingId,
      p_meeting_notes: validated.meetingNotes,
      p_meeting_passcode: validated.meetingPasscode,
      p_meeting_provider: validated.meetingProvider,
      p_meeting_url: validated.meetingUrl,
      p_recording_url: validated.recordingUrl,
      p_scheduled_end_at: validated.scheduledEndAt,
      p_scheduled_start_at: validated.scheduledStartAt,
      p_session_id: input.sessionId,
      p_tenant_id: input.tenantId,
      p_timezone: validated.timezone,
      p_title: validated.title,
      p_trainer_user_id: input.trainerUserId?.trim() || null,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as TrainingSession;
}

async function updateDelegatedSessionStatusWithRpc(params: {
  sessionId: string;
  status: Extract<SessionStatus, "canceled" | "completed">;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_delegated_session_status", {
      p_session_id: params.sessionId,
      p_status: params.status,
      p_tenant_id: params.tenantId,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as TrainingSession;
}

async function createSessionWithRpc(
  input: SessionInput,
  validated: ReturnType<typeof validateSessionInput>,
  trainerUserId: string | null,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("create_session_secure", {
      p_cohort_id: input.cohortId || null,
      p_course_id: input.courseId || null,
      p_delivery_mode: validated.deliveryMode,
      p_description: input.description.trim() || null,
      p_join_available_from: validated.joinAvailableFrom,
      p_meeting_id: validated.meetingId,
      p_meeting_notes: validated.meetingNotes,
      p_meeting_passcode: validated.meetingPasscode,
      p_meeting_provider: validated.meetingProvider,
      p_meeting_url: validated.meetingUrl,
      p_recording_url: validated.recordingUrl,
      p_scheduled_end_at: validated.scheduledEndAt,
      p_scheduled_start_at: validated.scheduledStartAt,
      p_tenant_id: input.tenantId,
      p_timezone: validated.timezone,
      p_title: validated.title,
      p_trainer_user_id: trainerUserId,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as TrainingSession;
}

async function updateSessionWithRpc(
  input: UpdateSessionInput,
  validated: ReturnType<typeof validateSessionInput>,
  trainerUserId: string | null,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_session_secure", {
      p_cohort_id: input.cohortId || null,
      p_course_id: input.courseId || null,
      p_delivery_mode: validated.deliveryMode,
      p_description: input.description.trim() || null,
      p_join_available_from: validated.joinAvailableFrom,
      p_meeting_id: validated.meetingId,
      p_meeting_notes: validated.meetingNotes,
      p_meeting_passcode: validated.meetingPasscode,
      p_meeting_provider: validated.meetingProvider,
      p_meeting_url: validated.meetingUrl,
      p_recording_url: validated.recordingUrl,
      p_scheduled_end_at: validated.scheduledEndAt,
      p_scheduled_start_at: validated.scheduledStartAt,
      p_session_id: input.sessionId,
      p_tenant_id: input.tenantId,
      p_timezone: validated.timezone,
      p_title: validated.title,
      p_trainer_user_id: trainerUserId,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as TrainingSession;
}

async function updateSessionStatusWithRpc(params: {
  sessionId: string;
  status: Extract<SessionStatus, "canceled" | "completed">;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_session_status_secure", {
      p_session_id: params.sessionId,
      p_status: params.status,
      p_tenant_id: params.tenantId,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as TrainingSession;
}

async function updateSessionMeetingDetailsWithRpc(params: {
  deliveryMode: SessionDeliveryMode;
  joinAvailableFrom: string | null;
  meetingId: string | null;
  meetingNotes: string | null;
  meetingPasscode: string | null;
  meetingProvider: SessionMeetingProvider | null;
  meetingUrl: string | null;
  recordingUrl: string | null;
  sessionId: string;
  tenantId: string;
  timezone: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_session_meeting_details_secure", {
      p_delivery_mode: params.deliveryMode,
      p_join_available_from: params.joinAvailableFrom,
      p_meeting_id: params.meetingId,
      p_meeting_notes: params.meetingNotes,
      p_meeting_passcode: params.meetingPasscode,
      p_meeting_provider: params.meetingProvider,
      p_meeting_url: params.meetingUrl,
      p_recording_url: params.recordingUrl,
      p_session_id: params.sessionId,
      p_tenant_id: params.tenantId,
      p_timezone: params.timezone,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as TrainingSession;
}

async function updateDelegatedSessionMeetingDetailsWithRpc(params: {
  deliveryMode: SessionDeliveryMode;
  joinAvailableFrom: string | null;
  meetingId: string | null;
  meetingNotes: string | null;
  meetingPasscode: string | null;
  meetingProvider: SessionMeetingProvider | null;
  meetingUrl: string | null;
  recordingUrl: string | null;
  sessionId: string;
  tenantId: string;
  timezone: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_delegated_session_meeting_details", {
      p_delivery_mode: params.deliveryMode,
      p_join_available_from: params.joinAvailableFrom,
      p_meeting_id: params.meetingId,
      p_meeting_notes: params.meetingNotes,
      p_meeting_passcode: params.meetingPasscode,
      p_meeting_provider: params.meetingProvider,
      p_meeting_url: params.meetingUrl,
      p_recording_url: params.recordingUrl,
      p_session_id: params.sessionId,
      p_tenant_id: params.tenantId,
      p_timezone: params.timezone,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as TrainingSession;
}

async function getDelegatedSessionDecision(params: {
  cohortId?: string | null;
  courseId?: string | null;
  sessionId?: string | null;
  tenantId: string;
  userId: string;
}): Promise<DelegatedSessionDecision | null> {
  const scopes: {
    scopeId: string | null;
    scopeType: DelegatedPermissionScopeType;
  }[] = [{ scopeId: null, scopeType: "workspace" }];

  if (params.courseId) {
    scopes.push({ scopeId: params.courseId, scopeType: "course" });
  }

  if (params.cohortId) {
    scopes.push({ scopeId: params.cohortId, scopeType: "cohort" });
  }

  if (params.sessionId) {
    scopes.push({ scopeId: params.sessionId, scopeType: "session" });
  }

  for (const scope of scopes) {
    const source = await explainPermissionSource({
      permission: "manage_sessions",
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      tenantId: params.tenantId,
      userId: params.userId,
    });

    if (source.source === "delegated") {
      return {
        delegatedPermission: source.delegatedPermission,
        scopeId: scope.scopeId,
        scopeType: scope.scopeType,
        source: "delegated",
      };
    }
  }

  return null;
}

async function logSessionDelegatedUse(params: {
  action: string;
  decision: DelegatedSessionDecision;
  entityId: string;
  tenantId: string;
  userId: string;
}) {
  if (params.decision.source !== "delegated") {
    return;
  }

  await logDelegatedPermissionUsage({
    action: params.action,
    delegatedPermission: params.decision.delegatedPermission,
    entityId: params.entityId,
    entityType: "session",
    scopeId: params.decision.scopeId,
    scopeType: params.decision.scopeType,
    tenantId: params.tenantId,
    userId: params.userId,
  });
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}

function normalizeOptionalUrl(value: string | null | undefined, label: string) {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }

    return url.toString();
  } catch {
    throw new Error(`${label} must be a valid http or https URL.`);
  }
}

function validateSessionInput(input: SessionInput) {
  const title = input.title.trim();
  const timezone = normalizeSessionTimezone(input.timezone);
  const scheduledStartAt = sessionWallClockToIso(
    input.scheduledStartAt,
    timezone,
  );
  const scheduledEndAt = sessionWallClockToIso(input.scheduledEndAt, timezone);
  const deliveryMode = input.deliveryMode ?? "offline";
  const meetingProvider = input.meetingProvider ?? null;
  const meetingUrl = normalizeOptionalUrl(input.meetingUrl, "Meeting URL");
  const recordingUrl = normalizeOptionalUrl(input.recordingUrl, "Recording URL");
  const joinAvailableFrom = sessionWallClockToIso(
    input.joinAvailableFrom,
    timezone,
  );

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

  return {
    deliveryMode,
    joinAvailableFrom,
    meetingId: normalizeOptionalText(input.meetingId),
    meetingNotes: normalizeOptionalText(input.meetingNotes),
    meetingPasscode: normalizeOptionalText(input.meetingPasscode),
    meetingProvider,
    meetingUrl,
    recordingUrl,
    scheduledEndAt,
    scheduledStartAt,
    timezone,
    title,
  };
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

export async function getSessionsForTenant(tenantId: string, limit = 200) {
  await ensureCanAccessSessions(tenantId);
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
  }).limit(Math.max(1, Math.min(limit, 500)));

  if (error) {
    throw error;
  }

  return attachSessionRelations((data ?? []) as TrainingSession[], tenantId);
}

export async function getOperationalSessionsForTenant(
  tenantId: string,
  limit = 200,
) {
  await ensureCanAccessSessions(tenantId);
  const supabase = getSupabaseClient();
  const trainerScope = await getCurrentTrainerScope(tenantId);

  if (
    trainerScope &&
    trainerScope.courseIds.length === 0 &&
    trainerScope.cohortIds.length === 0
  ) {
    return [] satisfies TrainingSessionWithRelations[];
  }

  const boundedLimit = Math.max(4, Math.min(limit, 500));
  const upcomingLimit = Math.ceil(boundedLimit * 0.4);
  const groupLimit = Math.floor((boundedLimit - upcomingLimit) / 3);
  const canceledLimit = boundedLimit - upcomingLimit - groupLimit * 2;
  const now = new Date().toISOString();
  const scopedQuery = () => {
    let query = supabase
      .from("sessions")
      .select(sessionColumns)
      .eq("tenant_id", tenantId);

    if (trainerScope) {
      query = applyTrainerSessionScope(
        query,
        trainerScope.courseIds,
        trainerScope.cohortIds,
      );
    }

    return query;
  };
  const [upcoming, pastDue, completed, canceled] = await Promise.all([
    scopedQuery()
      .eq("status", "scheduled")
      .gte("scheduled_start_at", now)
      .order("scheduled_start_at", { ascending: true })
      .limit(upcomingLimit),
    scopedQuery()
      .eq("status", "scheduled")
      .lt("scheduled_start_at", now)
      .order("scheduled_start_at", { ascending: false })
      .limit(groupLimit),
    scopedQuery()
      .eq("status", "completed")
      .order("scheduled_start_at", { ascending: false })
      .limit(groupLimit),
    scopedQuery()
      .eq("status", "canceled")
      .order("scheduled_start_at", { ascending: false })
      .limit(canceledLimit),
  ]);

  for (const result of [upcoming, pastDue, completed, canceled]) {
    if (result.error) {
      throw result.error;
    }
  }

  return attachSessionRelations(
    [
      ...(upcoming.data ?? []),
      ...(pastDue.data ?? []),
      ...(completed.data ?? []),
      ...(canceled.data ?? []),
    ] as TrainingSession[],
    tenantId,
  );
}

export async function getSessionById(params: {
  sessionId: string;
  tenantId: string;
}) {
  await ensureCanAccessSessions(params.tenantId);

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
  const { decision, role, user } = await ensureCanManageSession({
    cohortId: input.cohortId,
    courseId: input.courseId,
    tenantId: input.tenantId,
  });
  const trainerUserId =
    role === "trainer" ? user.id : input.trainerUserId?.trim() || null;

  if (decision.source === "delegated") {
    const session = await createDelegatedSessionWithRpc(
      {
        ...input,
        trainerUserId,
      },
      validated,
    );

    await logActivity({
      action:
        session.delivery_mode === "offline"
          ? "session_created"
          : "live_session_scheduled",
      description: `Created ${deliveryModeLabels[session.delivery_mode].toLowerCase()} class session`,
      entityId: session.id,
      entityName: session.title,
      entityType: "session",
      metadata: {
        cohortId: session.cohort_id,
        courseId: session.course_id,
        deliveryMode: session.delivery_mode,
        meetingProvider: session.meeting_provider,
        scheduledStartAt: session.scheduled_start_at,
        trainerUserId: session.trainer_user_id,
      },
      tenantId: session.tenant_id,
    });
    await notifySessionUpdated(session);
    await runAutomationTrigger("session_scheduled", {
      entityId: session.id,
      entityType: "session",
      metadata: {
        cohort_id: session.cohort_id,
        course_id: session.course_id,
        delivery_mode: session.delivery_mode,
        scheduled_at: session.scheduled_start_at,
        session_title: session.title,
      },
      tenantId: session.tenant_id,
    });

    return session;
  }

  const session = await createSessionWithRpc(input, validated, trainerUserId);

  await logActivity({
    action:
      session.delivery_mode === "offline"
        ? "session_created"
        : "live_session_scheduled",
    description: `Created ${deliveryModeLabels[session.delivery_mode].toLowerCase()} class session`,
    entityId: session.id,
    entityName: session.title,
    entityType: "session",
    metadata: {
      cohortId: session.cohort_id,
      courseId: session.course_id,
      deliveryMode: session.delivery_mode,
      meetingProvider: session.meeting_provider,
      scheduledStartAt: session.scheduled_start_at,
      trainerUserId: session.trainer_user_id,
    },
    tenantId: session.tenant_id,
  });
  await logSessionDelegatedUse({
    action: "create_session",
    decision,
    entityId: session.id,
    tenantId: session.tenant_id,
    userId: user.id,
  });
  await notifySessionUpdated(session);
  await runAutomationTrigger("session_scheduled", {
    entityId: session.id,
    entityType: "session",
    metadata: {
      cohort_id: session.cohort_id,
      course_id: session.course_id,
      delivery_mode: session.delivery_mode,
      scheduled_at: session.scheduled_start_at,
      session_title: session.title,
    },
    tenantId: session.tenant_id,
  });

  return session;
}

export async function updateSession(input: UpdateSessionInput) {
  const validated = validateSessionInput(input);
  const { decision, role, user } = await ensureCanManageSession({
    cohortId: input.cohortId,
    courseId: input.courseId,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
  });
  const trainerUserId =
    role === "trainer" ? user.id : input.trainerUserId?.trim() || null;

  if (decision.source === "delegated") {
    const session = await updateDelegatedSessionWithRpc(
      {
        ...input,
        trainerUserId,
      },
      validated,
    );

    await logActivity({
      action:
        session.delivery_mode === "offline"
          ? "session_updated"
          : "live_session_updated",
      description: `Updated ${deliveryModeLabels[session.delivery_mode].toLowerCase()} class session`,
      entityId: session.id,
      entityName: session.title,
      entityType: "session",
      metadata: {
        cohortId: session.cohort_id,
        courseId: session.course_id,
        deliveryMode: session.delivery_mode,
        meetingProvider: session.meeting_provider,
        scheduledStartAt: session.scheduled_start_at,
        status: session.status,
      },
      tenantId: session.tenant_id,
    });
    await notifySessionCreated(session);

    return session;
  }

  const session = await updateSessionWithRpc(input, validated, trainerUserId);

  await logActivity({
    action:
      session.delivery_mode === "offline"
        ? "session_updated"
        : "live_session_updated",
    description: `Updated ${deliveryModeLabels[session.delivery_mode].toLowerCase()} class session`,
    entityId: session.id,
    entityName: session.title,
    entityType: "session",
    metadata: {
      cohortId: session.cohort_id,
      courseId: session.course_id,
      deliveryMode: session.delivery_mode,
      meetingProvider: session.meeting_provider,
      scheduledStartAt: session.scheduled_start_at,
      status: session.status,
    },
    tenantId: session.tenant_id,
  });
  await logSessionDelegatedUse({
    action: "update_session",
    decision,
    entityId: session.id,
    tenantId: session.tenant_id,
    userId: user.id,
  });
  await notifySessionCreated(session);

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

  const { decision, user } = await ensureCanManageSession({
    cohortId: existing.cohort_id,
    courseId: existing.course_id,
    sessionId: existing.id,
    tenantId: params.tenantId,
  });

  if (decision.source === "delegated") {
    const session = await updateDelegatedSessionStatusWithRpc({
      sessionId: params.sessionId,
      status: params.status,
      tenantId: params.tenantId,
    });

    await logActivity({
      action: params.action,
      description: params.description,
      entityId: session.id,
      entityName: session.title,
      entityType: "session",
      metadata: {
        cohortId: session.cohort_id,
        courseId: session.course_id,
        deliveryMode: session.delivery_mode,
        meetingProvider: session.meeting_provider,
        status: session.status,
      },
      severity: params.action === "session_canceled" ? "warning" : "info",
      tenantId: session.tenant_id,
    });
    await notifySessionStatusChange(session);

    return session;
  }

  const session = await updateSessionStatusWithRpc({
    sessionId: params.sessionId,
    status: params.status,
    tenantId: params.tenantId,
  });

  await logActivity({
    action: params.action,
    description: params.description,
    entityId: session.id,
    entityName: session.title,
    entityType: "session",
    metadata: {
      cohortId: session.cohort_id,
      courseId: session.course_id,
      deliveryMode: session.delivery_mode,
      meetingProvider: session.meeting_provider,
      status: session.status,
    },
    severity: params.action === "session_canceled" ? "warning" : "info",
    tenantId: session.tenant_id,
  });
  await logSessionDelegatedUse({
    action: params.action,
    decision,
    entityId: session.id,
    tenantId: session.tenant_id,
    userId: user.id,
  });
  await notifySessionStatusChange(session);

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

export async function createLiveSession(input: SessionInput) {
  return createSession({
    ...input,
    deliveryMode: input.deliveryMode ?? "online",
  });
}

export async function updateMeetingDetails(input: {
  deliveryMode?: SessionDeliveryMode;
  joinAvailableFrom?: string | null;
  meetingId?: string | null;
  meetingNotes?: string | null;
  meetingPasscode?: string | null;
  meetingProvider?: SessionMeetingProvider | null;
  meetingUrl?: string | null;
  recordingUrl?: string | null;
  sessionId: string;
  tenantId: string;
  timezone?: string | null;
}) {
  const existing = await getSessionById({
    sessionId: input.sessionId,
    tenantId: input.tenantId,
  });

  if (!existing) {
    throw new Error("Session not found in this workspace.");
  }

  const { decision, user } = await ensureCanManageSession({
    cohortId: existing.cohort_id,
    courseId: existing.course_id,
    sessionId: existing.id,
    tenantId: input.tenantId,
  });

  const validated = validateSessionInput({
    cohortId: existing.cohort_id,
    courseId: existing.course_id,
    description: existing.description ?? "",
    deliveryMode: input.deliveryMode ?? existing.delivery_mode,
    joinAvailableFrom:
      input.joinAvailableFrom === undefined
        ? existing.join_available_from
        : input.joinAvailableFrom,
    meetingId: input.meetingId === undefined ? existing.meeting_id : input.meetingId,
    meetingNotes:
      input.meetingNotes === undefined ? existing.meeting_notes : input.meetingNotes,
    meetingPasscode:
      input.meetingPasscode === undefined
        ? existing.meeting_passcode
        : input.meetingPasscode,
    meetingProvider:
      input.meetingProvider === undefined
        ? existing.meeting_provider
        : input.meetingProvider,
    meetingUrl:
      input.meetingUrl === undefined ? existing.meeting_url : input.meetingUrl,
    recordingUrl:
      input.recordingUrl === undefined ? existing.recording_url : input.recordingUrl,
    scheduledEndAt: existing.scheduled_end_at ?? "",
    scheduledStartAt: existing.scheduled_start_at,
    tenantId: input.tenantId,
    timezone: input.timezone ?? existing.timezone,
    title: existing.title,
    trainerUserId: existing.trainer_user_id,
  });

  if (decision.source === "delegated") {
    const session = await updateDelegatedSessionMeetingDetailsWithRpc({
      deliveryMode: validated.deliveryMode,
      joinAvailableFrom: validated.joinAvailableFrom,
      meetingId: validated.meetingId,
      meetingNotes: validated.meetingNotes,
      meetingPasscode: validated.meetingPasscode,
      meetingProvider: validated.meetingProvider,
      meetingUrl: validated.meetingUrl,
      recordingUrl: validated.recordingUrl,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      timezone: validated.timezone,
    });

    await logActivity({
      action: "meeting_details_updated",
      description: "Updated class meeting details",
      entityId: session.id,
      entityName: session.title,
      entityType: "session",
      metadata: {
        deliveryMode: session.delivery_mode,
        meetingProvider: session.meeting_provider,
        scheduledStartAt: session.scheduled_start_at,
      },
      tenantId: session.tenant_id,
    });
    await notifyMeetingDetailsUpdated(session);

    return session;
  }

  const session = await updateSessionMeetingDetailsWithRpc({
    deliveryMode: validated.deliveryMode,
    joinAvailableFrom: validated.joinAvailableFrom,
    meetingId: validated.meetingId,
    meetingNotes: validated.meetingNotes,
    meetingPasscode: validated.meetingPasscode,
    meetingProvider: validated.meetingProvider,
    meetingUrl: validated.meetingUrl,
    recordingUrl: validated.recordingUrl,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    timezone: validated.timezone,
  });

  await logActivity({
    action: "meeting_details_updated",
    description: "Updated class meeting details",
    entityId: session.id,
    entityName: session.title,
    entityType: "session",
    metadata: {
      deliveryMode: session.delivery_mode,
      meetingProvider: session.meeting_provider,
      scheduledStartAt: session.scheduled_start_at,
    },
    tenantId: session.tenant_id,
  });
  await logSessionDelegatedUse({
    action: "update_meeting_details",
    decision,
    entityId: session.id,
    tenantId: session.tenant_id,
    userId: user.id,
  });
  await notifyMeetingDetailsUpdated(session);

  return session;
}

export async function getUpcomingLiveSessions(tenantId: string, limit = 8) {
  const sessions = await getSessionsForTenant(tenantId);
  const now = Date.now();

  return sessions
    .filter(
      (session) =>
        session.status === "scheduled" &&
        new Date(session.scheduled_start_at).getTime() >= now,
    )
    .sort(
      (left, right) =>
        new Date(left.scheduled_start_at).getTime() -
        new Date(right.scheduled_start_at).getTime(),
    )
    .slice(0, limit);
}

export async function getTrainerUpcomingLiveClasses(tenantId: string) {
  return getUpcomingLiveSessions(tenantId);
}

export function canRoleManageSessions(role: MemberRole | null | undefined) {
  return canManageAttendance(role);
}

export async function canCurrentUserManageSession(params: {
  cohortId?: string | null;
  courseId?: string | null;
  sessionId?: string | null;
  tenantId: string;
}) {
  try {
    const evaluation = await evaluateSessionManagement(params);
    return evaluation.allowed;
  } catch {
    return false;
  }
}
