import { logActivity } from "@/src/lib/auditLogger";
import type { Course } from "@/src/lib/courses";
import type { CohortWithCourse } from "@/src/lib/cohorts";
import {
  getMemberRoleForTenant,
  type MemberRole,
} from "@/src/lib/permissions";
import type { Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentTrainerScope } from "@/src/lib/trainerAssignments";

export type ConversationThreadType =
  | "announcement"
  | "cohort_discussion"
  | "course_discussion"
  | "direct_message"
  | "staff_note";

export type ConversationThreadStatus = "active" | "archived" | "locked";
export type ConversationParticipantRole =
  | "admin"
  | "owner"
  | "staff"
  | "student"
  | "trainer";

export type ConversationThread = {
  cohort_id: string | null;
  course_id: string | null;
  created_at: string;
  created_by: string | null;
  description: string | null;
  entity_id: string | null;
  entity_type: string | null;
  id: string;
  status: ConversationThreadStatus;
  student_id: string | null;
  tenant_id: string;
  thread_type: ConversationThreadType;
  title: string | null;
  updated_at: string;
};

export type ConversationParticipant = {
  created_at: string;
  id: string;
  last_read_at: string | null;
  role: ConversationParticipantRole | null;
  student_id: string | null;
  tenant_id: string;
  thread_id: string;
  user_id: string | null;
};

export type ConversationMessagePreview = {
  created_at: string;
  id: string;
  message: string;
  sender_user_id: string | null;
  status: string;
};

export type ConversationThreadWithMeta = ConversationThread & {
  cohort: Pick<CohortWithCourse, "id" | "name"> | null;
  course: Pick<Course, "id" | "title"> | null;
  participantCount: number;
  recentMessage: ConversationMessagePreview | null;
  student: Pick<Student, "full_name" | "id"> | null;
  unreadCount: number;
};

export type CreateConversationThreadInput = {
  cohortId?: string | null;
  courseId?: string | null;
  description?: string;
  entityId?: string | null;
  entityType?: string | null;
  participantStudentIds?: string[];
  participantUserIds?: string[];
  studentId?: string | null;
  tenantId: string;
  threadType: ConversationThreadType;
  title: string;
};

const threadSelect =
  "id,tenant_id,thread_type,title,description,entity_type,entity_id,course_id,cohort_id,student_id,created_by,status,created_at,updated_at";
const participantSelect =
  "id,tenant_id,thread_id,user_id,student_id,role,last_read_at,created_at";

export function isRecoverableConversationError(error: {
  code?: string;
  message?: string;
} | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "PGRST204" ||
    error?.code === "42703" ||
    error?.code === "42501" ||
    message.includes("column") ||
    message.includes("permission denied") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

function isMissingTableError(error: { code?: string; message?: string } | null) {
  return isRecoverableConversationError(error);
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
    throw new Error("You must be logged in to access messages.");
  }

  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (!role) {
    throw new Error("You do not have access to this workspace.");
  }

  return { role, user };
}

function canCreateThreadType(
  role: MemberRole | null,
  threadType: ConversationThreadType,
) {
  if (role === "owner" || role === "admin") {
    return true;
  }

  if (role === "staff") {
    return ["direct_message", "staff_note"].includes(threadType);
  }

  if (role === "trainer") {
    return ["cohort_discussion", "course_discussion", "direct_message"].includes(
      threadType,
    );
  }

  return false;
}

async function getUserParticipantThreadIds(tenantId: string, userId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("conversation_participants")
    .select("thread_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }

    throw error;
  }

  return ((data ?? []) as { thread_id: string }[]).map((row) => row.thread_id);
}

async function getTrainerScopedStudentIds(params: {
  cohortIds: string[];
  courseIds: string[];
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const [enrollmentsResult, cohortMembersResult] = await Promise.all([
    params.courseIds.length
      ? supabase
          .from("enrollments")
          .select("student_id")
          .eq("tenant_id", params.tenantId)
          .in("course_id", params.courseIds)
      : Promise.resolve({ data: [], error: null }),
    params.cohortIds.length
      ? supabase
          .from("cohort_members")
          .select("student_id")
          .eq("tenant_id", params.tenantId)
          .in("cohort_id", params.cohortIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (enrollmentsResult.error) {
    throw enrollmentsResult.error;
  }

  if (cohortMembersResult.error) {
    throw cohortMembersResult.error;
  }

  return Array.from(
    new Set([
      ...((enrollmentsResult.data ?? []) as { student_id: string }[]).map(
        (row) => row.student_id,
      ),
      ...((cohortMembersResult.data ?? []) as { student_id: string }[]).map(
        (row) => row.student_id,
      ),
    ]),
  );
}

async function ensureThreadScope(input: CreateConversationThreadInput) {
  const { role, user } = await getCurrentUserAndRole(input.tenantId);

  if (!canCreateThreadType(role, input.threadType)) {
    throw new Error("You do not have permission to create this conversation.");
  }

  if (role === "trainer") {
    const scope = await getCurrentTrainerScope(input.tenantId);
    const studentIds = scope
      ? await getTrainerScopedStudentIds({
          cohortIds: scope.cohortIds,
          courseIds: scope.courseIds,
          tenantId: input.tenantId,
        })
      : [];
    const courseAllowed =
      input.threadType === "course_discussion" &&
      Boolean(input.courseId) &&
      Boolean(scope?.courseIds.includes(input.courseId ?? ""));
    const cohortAllowed =
      input.threadType === "cohort_discussion" &&
      Boolean(input.cohortId) &&
      Boolean(scope?.cohortIds.includes(input.cohortId ?? ""));
    const studentAllowed =
      input.threadType === "direct_message" &&
      Boolean(input.studentId) &&
      studentIds.includes(input.studentId ?? "");

    if (!courseAllowed && !cohortAllowed && !studentAllowed) {
      await logActivity({
        action: "access_denied",
        description: "Blocked trainer conversation outside assignment scope.",
        entityName: "Conversation scope",
        entityType: "security",
        metadata: {
          cohortId: input.cohortId ?? null,
          courseId: input.courseId ?? null,
          threadType: input.threadType,
        },
        severity: "warning",
        tenantId: input.tenantId,
      });
      throw new Error(
        "Trainers can only create conversations for assigned courses, cohorts, or scoped students.",
      );
    }
  }

  return { role, user };
}

function buildTrainerThreadFilter(params: {
  cohortIds: string[];
  courseIds: string[];
  participantThreadIds: string[];
  studentIds: string[];
}) {
  const filters: string[] = [];

  if (params.courseIds.length > 0) {
    filters.push(`course_id.in.(${params.courseIds.join(",")})`);
  }

  if (params.cohortIds.length > 0) {
    filters.push(`cohort_id.in.(${params.cohortIds.join(",")})`);
  }

  if (params.studentIds.length > 0) {
    filters.push(`student_id.in.(${params.studentIds.join(",")})`);
  }

  if (params.participantThreadIds.length > 0) {
    filters.push(`id.in.(${params.participantThreadIds.join(",")})`);
  }

  return filters.join(",");
}

async function attachThreadMeta(
  threads: ConversationThread[],
  tenantId: string,
  currentUserId: string,
) {
  if (threads.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const threadIds = threads.map((thread) => thread.id);
  const courseIds = Array.from(
    new Set(threads.map((thread) => thread.course_id).filter(Boolean)),
  ) as string[];
  const cohortIds = Array.from(
    new Set(threads.map((thread) => thread.cohort_id).filter(Boolean)),
  ) as string[];
  const studentIds = Array.from(
    new Set(threads.map((thread) => thread.student_id).filter(Boolean)),
  ) as string[];

  const [
    coursesResult,
    cohortsResult,
    studentsResult,
    participantsResult,
    messagesResult,
    ownParticipantsResult,
  ] = await Promise.all([
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
    studentIds.length
      ? supabase
          .from("students")
          .select("id,full_name")
          .eq("tenant_id", tenantId)
          .in("id", studentIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("conversation_participants")
      .select("thread_id")
      .eq("tenant_id", tenantId)
      .in("thread_id", threadIds),
    supabase
      .from("conversation_messages")
      .select("id,thread_id,sender_user_id,message,status,created_at")
      .eq("tenant_id", tenantId)
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("conversation_participants")
      .select("thread_id,last_read_at")
      .eq("tenant_id", tenantId)
      .eq("user_id", currentUserId)
      .in("thread_id", threadIds),
  ]);

  for (const result of [coursesResult, cohortsResult, studentsResult]) {
    if (result.error) {
      if (!isRecoverableConversationError(result.error)) {
        throw result.error;
      }
    }
  }

  const courseById = new Map(
    (coursesResult.error
      ? []
      : ((coursesResult.data ?? []) as Pick<Course, "id" | "title">[])
    ).map((course) => [course.id, course]),
  );
  const cohortById = new Map(
    (cohortsResult.error
      ? []
      : ((cohortsResult.data ?? []) as Pick<CohortWithCourse, "id" | "name">[])
    ).map((cohort) => [cohort.id, cohort]),
  );
  const studentById = new Map(
    (studentsResult.error
      ? []
      : ((studentsResult.data ?? []) as Pick<Student, "full_name" | "id">[])
    ).map((student) => [student.id, student]),
  );
  const participantCounts = new Map<string, number>();

  const participantRows = participantsResult.error
    ? []
    : ((participantsResult.data ?? []) as { thread_id: string }[]);

  if (participantsResult.error && !isRecoverableConversationError(participantsResult.error)) {
    throw participantsResult.error;
  }

  for (const row of participantRows) {
    participantCounts.set(row.thread_id, (participantCounts.get(row.thread_id) ?? 0) + 1);
  }

  const recentMessageByThread = new Map<string, ConversationMessagePreview>();
  const messageRows = messagesResult.error
    ? []
    : ((messagesResult.data ?? []) as (ConversationMessagePreview & {
        thread_id: string;
      })[]);

  if (messagesResult.error && !isRecoverableConversationError(messagesResult.error)) {
    throw messagesResult.error;
  }

  for (const message of messageRows) {
    if (!recentMessageByThread.has(message.thread_id)) {
      recentMessageByThread.set(message.thread_id, {
        created_at: message.created_at,
        id: message.id,
        message: message.message,
        sender_user_id: message.sender_user_id,
        status: message.status,
      });
    }
  }

  if (
    ownParticipantsResult.error &&
    !isRecoverableConversationError(ownParticipantsResult.error)
  ) {
    throw ownParticipantsResult.error;
  }

  const ownParticipantRows = ownParticipantsResult.error
    ? []
    : ((ownParticipantsResult.data ?? []) as {
      last_read_at: string | null;
      thread_id: string;
    }[]);
  const lastReadByThread = new Map(
    ownParticipantRows.map((row) => [row.thread_id, row.last_read_at]),
  );
  const unreadByThread = new Map<string, number>();

  for (const message of messageRows as {
    created_at: string;
    sender_user_id: string | null;
    thread_id: string;
  }[]) {
    const lastRead = lastReadByThread.get(message.thread_id);

    if (
      message.sender_user_id !== currentUserId &&
      (!lastRead || new Date(message.created_at) > new Date(lastRead))
    ) {
      unreadByThread.set(
        message.thread_id,
        (unreadByThread.get(message.thread_id) ?? 0) + 1,
      );
    }
  }

  return threads.map((thread) => ({
    ...thread,
    cohort: thread.cohort_id ? cohortById.get(thread.cohort_id) ?? null : null,
    course: thread.course_id ? courseById.get(thread.course_id) ?? null : null,
    participantCount: participantCounts.get(thread.id) ?? 0,
    recentMessage: recentMessageByThread.get(thread.id) ?? null,
    student: thread.student_id ? studentById.get(thread.student_id) ?? null : null,
    unreadCount: unreadByThread.get(thread.id) ?? 0,
  })) satisfies ConversationThreadWithMeta[];
}

export async function getConversationThreads(
  tenantId: string,
  filters: { threadType?: ConversationThreadType | "all" } = {},
) {
  const { role, user } = await getCurrentUserAndRole(tenantId);
  const supabase = getSupabaseClient();
  let query = supabase
    .from("conversation_threads")
    .select(threadSelect)
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });

  if (filters.threadType && filters.threadType !== "all") {
    query = query.eq("thread_type", filters.threadType);
  }

  if (role === "staff") {
    const participantThreadIds = await getUserParticipantThreadIds(
      tenantId,
      user.id,
    );
    const staffFilters = [
      "thread_type.in.(announcement,course_discussion,cohort_discussion,staff_note)",
    ];

    if (participantThreadIds.length > 0) {
      staffFilters.push(`id.in.(${participantThreadIds.join(",")})`);
    }

    query = query.or(staffFilters.join(","));
  }

  if (role === "trainer") {
    const scope = await getCurrentTrainerScope(tenantId);
    const participantThreadIds = await getUserParticipantThreadIds(
      tenantId,
      user.id,
    );
    const studentIds = scope
      ? await getTrainerScopedStudentIds({
          cohortIds: scope.cohortIds,
          courseIds: scope.courseIds,
          tenantId,
        })
      : [];
    const scopedFilter = buildTrainerThreadFilter({
      cohortIds: scope?.cohortIds ?? [],
      courseIds: scope?.courseIds ?? [],
      participantThreadIds,
      studentIds,
    });
    const trainerFilters = ["thread_type.eq.announcement"];

    if (scopedFilter) {
      trainerFilters.push(scopedFilter);
    }

    query = query.or(trainerFilters.join(","));
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }

    throw error;
  }

  return attachThreadMeta((data ?? []) as ConversationThread[], tenantId, user.id);
}

export async function isConversationSystemAvailable(tenantId: string) {
  try {
    await getCurrentUserAndRole(tenantId);
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("conversation_threads")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .limit(1);

    return !error || !isRecoverableConversationError(error);
  } catch (caught) {
    if (
      caught &&
      typeof caught === "object" &&
      isRecoverableConversationError(caught as { code?: string; message?: string })
    ) {
      return false;
    }

    throw caught;
  }
}

export async function safeGetConversationThreads(
  tenantId: string,
  filters: { threadType?: ConversationThreadType | "all" } = {},
) {
  try {
    return await getConversationThreads(tenantId, filters);
  } catch (caught) {
    if (
      caught &&
      typeof caught === "object" &&
      isRecoverableConversationError(caught as { code?: string; message?: string })
    ) {
      return [];
    }

    throw caught;
  }
}

export async function getConversationThreadById(params: {
  tenantId: string;
  threadId: string;
}) {
  const threads = await getConversationThreads(params.tenantId);

  return threads.find((thread) => thread.id === params.threadId) ?? null;
}

export async function createConversationThread(
  input: CreateConversationThreadInput,
) {
  const title = input.title.trim();

  if (!title) {
    throw new Error("Conversation title is required.");
  }

  const { role, user } = await ensureThreadScope(input);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("conversation_threads")
    .insert({
      cohort_id: input.cohortId || null,
      course_id: input.courseId || null,
      created_by: user.id,
      description: input.description?.trim() || null,
      entity_id: input.entityId ?? null,
      entity_type: input.entityType ?? null,
      status: "active",
      student_id: input.studentId || null,
      tenant_id: input.tenantId,
      thread_type: input.threadType,
      title,
    })
    .select(threadSelect)
    .single();

  if (error) {
    throw error;
  }

  const thread = data as ConversationThread;

  await ensureDefaultParticipantsForThread({
    participantStudentIds: Array.from(
      new Set([
        ...(input.participantStudentIds ?? []),
        ...(input.studentId ? [input.studentId] : []),
      ]),
    ),
    participantUserIds: input.participantUserIds ?? [],
    role,
    tenantId: input.tenantId,
    threadId: thread.id,
    userId: user.id,
  });

  await logActivity({
    action: "conversation_created",
    description: `Created ${input.threadType.replaceAll("_", " ")} conversation`,
    entityId: thread.id,
    entityName: thread.title ?? "Conversation",
    entityType: "conversation",
    metadata: {
      cohortId: thread.cohort_id,
      courseId: thread.course_id,
      studentId: thread.student_id,
      threadType: thread.thread_type,
    },
    tenantId: thread.tenant_id,
  });

  return thread;
}

export async function addConversationParticipant(input: {
  role?: ConversationParticipantRole | null;
  studentId?: string | null;
  tenantId: string;
  threadId: string;
  userId?: string | null;
}) {
  if (!input.userId && !input.studentId) {
    throw new Error("A participant must include a user or student.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("conversation_participants")
    .insert({
      role: input.role ?? null,
      student_id: input.studentId ?? null,
      tenant_id: input.tenantId,
      thread_id: input.threadId,
      user_id: input.userId ?? null,
    })
    .select(participantSelect)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return null;
    }

    throw error;
  }

  return (data as ConversationParticipant | null) ?? null;
}

export async function ensureDefaultParticipantsForThread(input: {
  participantStudentIds?: string[];
  participantUserIds?: string[];
  role: MemberRole;
  tenantId: string;
  threadId: string;
  userId: string;
}) {
  const canManageParticipants = input.role === "owner" || input.role === "admin";
  const supabase = getSupabaseClient();
  const { data, error } = canManageParticipants
    ? await supabase
        .from("tenant_members")
        .select("user_id,role")
        .eq("tenant_id", input.tenantId)
        .in("role", ["owner", "admin"])
    : { data: [], error: null };

  if (error) {
    throw error;
  }

  const defaultUsers = [
    ...((data ?? []) as { role: ConversationParticipantRole; user_id: string }[]),
    { role: input.role as ConversationParticipantRole, user_id: input.userId },
    ...(canManageParticipants
      ? (input.participantUserIds ?? []).map((userId) => ({
          role: null,
          user_id: userId,
        }))
      : []),
  ];
  const uniqueUsers = new Map(defaultUsers.map((item) => [item.user_id, item.role]));
  const studentParticipantIds =
    canManageParticipants || input.role === "trainer"
      ? (input.participantStudentIds ?? [])
      : [];

  await Promise.all([
    ...Array.from(uniqueUsers.entries()).map(([userId, participantRole]) =>
      addConversationParticipant({
        role: participantRole,
        tenantId: input.tenantId,
        threadId: input.threadId,
        userId,
      }),
    ),
    ...studentParticipantIds.map((studentId) =>
      addConversationParticipant({
        role: "student",
        studentId,
        tenantId: input.tenantId,
        threadId: input.threadId,
      }),
    ),
  ]);
}

async function updateThreadStatus(input: {
  action: "conversation_archived" | "conversation_locked";
  status: Extract<ConversationThreadStatus, "archived" | "locked">;
  tenantId: string;
  threadId: string;
}) {
  const { role } = await getCurrentUserAndRole(input.tenantId);

  if (role !== "owner" && role !== "admin") {
    throw new Error("Only owner/admin users can archive or lock conversations.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("conversation_threads")
    .update({ status: input.status })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.threadId)
    .select(threadSelect)
    .single();

  if (error) {
    throw error;
  }

  const thread = data as ConversationThread;

  await logActivity({
    action: input.action,
    description: `${input.status === "locked" ? "Locked" : "Archived"} conversation`,
    entityId: thread.id,
    entityName: thread.title ?? "Conversation",
    entityType: "conversation",
    metadata: { status: thread.status, threadType: thread.thread_type },
    severity: input.status === "locked" ? "warning" : "info",
    tenantId: thread.tenant_id,
  });

  return thread;
}

export async function archiveConversationThread(tenantId: string, threadId: string) {
  return updateThreadStatus({
    action: "conversation_archived",
    status: "archived",
    tenantId,
    threadId,
  });
}

export async function lockConversationThread(tenantId: string, threadId: string) {
  return updateThreadStatus({
    action: "conversation_locked",
    status: "locked",
    tenantId,
    threadId,
  });
}

export async function getConversationParticipants(params: {
  tenantId: string;
  threadId: string;
}) {
  await getConversationThreadById(params);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("conversation_participants")
    .select(participantSelect)
    .eq("tenant_id", params.tenantId)
    .eq("thread_id", params.threadId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as ConversationParticipant[];
}
