import type { Course } from "@/src/lib/courses";
import type { CohortWithCourse } from "@/src/lib/cohorts";
import {
  getMemberRoleForTenant,
  type MemberRole,
} from "@/src/lib/permissions";
import { logOptionalQueryFailure } from "@/src/lib/optionalQuery";
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

export type ConversationAvailabilityErrorType = "infrastructure" | null;

export type ConversationThreadListResult = {
  available: boolean;
  errorType: ConversationAvailabilityErrorType;
  threads: ConversationThreadWithMeta[];
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

function legacyConversationWriteRetired(): never {
  throw new Error(
    "Legacy conversation writes are retired. Use the Academy Chat module.",
  );
}

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

export function isConversationInfrastructureError(error: {
  code?: string;
  message?: string;
} | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST200" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("relation") ||
    message.includes("table") ||
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

function isMissingTableError(error: { code?: string; message?: string } | null) {
  return isConversationInfrastructureError(error);
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

      logOptionalQueryFailure(
        {
          area: "conversations.attachThreadMeta",
          helper: "relatedEntityPreload",
          table:
            result === coursesResult
              ? "courses"
              : result === cohortsResult
                ? "cohorts"
                : "students",
        },
        result.error,
      );
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

  if (participantsResult.error) {
    if (!isRecoverableConversationError(participantsResult.error)) {
      throw participantsResult.error;
    }

    logOptionalQueryFailure(
      {
        area: "conversations.attachThreadMeta",
        helper: "participantCounts",
        table: "conversation_participants",
      },
      participantsResult.error,
    );
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

  if (messagesResult.error) {
    if (!isRecoverableConversationError(messagesResult.error)) {
      throw messagesResult.error;
    }

    logOptionalQueryFailure(
      {
        area: "conversations.attachThreadMeta",
        helper: "recentMessages",
        table: "conversation_messages",
      },
      messagesResult.error,
    );
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

  if (ownParticipantsResult.error) {
    logOptionalQueryFailure(
      {
        area: "conversations.attachThreadMeta",
        helper: "ownParticipantReadState",
        table: "conversation_participants",
      },
      ownParticipantsResult.error,
    );
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
    if (isConversationInfrastructureError(error)) {
      logOptionalQueryFailure(
        {
          area: "conversations.getConversationThreads",
          helper: "conversationThreadSelect",
          table: "conversation_threads",
        },
        error,
      );
      throw error;
    }

    if (isRecoverableConversationError(error)) {
      logOptionalQueryFailure(
        {
          area: "conversations.getConversationThreads",
          helper: "conversationThreadSelect",
          table: "conversation_threads",
        },
        error,
      );
      return [];
    }

    throw error;
  }

  return attachThreadMeta((data ?? []) as ConversationThread[], tenantId, user.id);
}

export async function isConversationSystemAvailable(tenantId: string) {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("conversation_threads")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(1);

    if (error) {
      if (isConversationInfrastructureError(error)) {
        logOptionalQueryFailure(
          {
            area: "conversations.isConversationSystemAvailable",
            helper: "conversationThreadHead",
            table: "conversation_threads",
          },
          error,
        );
        return false;
      }

      throw error;
    }

    return true;
  } catch (caught) {
    if (
      caught &&
      typeof caught === "object" &&
      isConversationInfrastructureError(caught as { code?: string; message?: string })
    ) {
      logOptionalQueryFailure(
        {
          area: "conversations.isConversationSystemAvailable",
          helper: "conversationThreadHead",
          table: "conversation_threads",
        },
        caught,
      );
      return false;
    }

    throw caught;
  }
}

export async function safeGetConversationThreads(
  tenantId: string,
  filters: { threadType?: ConversationThreadType | "all" } = {},
): Promise<ConversationThreadListResult> {
  try {
    const threads = await getConversationThreads(tenantId, filters);

    return {
      available: true,
      errorType: null,
      threads,
    };
  } catch (caught) {
    if (
      caught &&
      typeof caught === "object" &&
      isConversationInfrastructureError(
        caught as { code?: string; message?: string },
      )
    ) {
      logOptionalQueryFailure(
        {
          area: "conversations.safeGetConversationThreads",
          helper: "getConversationThreads",
          table: "conversation_threads",
        },
        caught,
      );

      return {
        available: false,
        errorType: "infrastructure",
        threads: [],
      };
    }

    if (
      caught &&
      typeof caught === "object" &&
      isRecoverableConversationError(caught as { code?: string; message?: string })
    ) {
      logOptionalQueryFailure(
        {
          area: "conversations.safeGetConversationThreads",
          helper: "getConversationThreads",
          table: "conversation_threads",
        },
        caught,
      );

      return {
        available: true,
        errorType: null,
        threads: [],
      };
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
  void input;
  legacyConversationWriteRetired();
}

export async function addConversationParticipant(input: {
  role?: ConversationParticipantRole | null;
  studentId?: string | null;
  tenantId: string;
  threadId: string;
  userId?: string | null;
}) {
  void input;
  legacyConversationWriteRetired();
}

export async function ensureDefaultParticipantsForThread(input: {
  participantStudentIds?: string[];
  participantUserIds?: string[];
  role: MemberRole;
  tenantId: string;
  threadId: string;
  userId: string;
}) {
  void input;
  legacyConversationWriteRetired();
}

export async function archiveConversationThread(tenantId: string, threadId: string) {
  void tenantId;
  void threadId;
  legacyConversationWriteRetired();
}

export async function lockConversationThread(tenantId: string, threadId: string) {
  void tenantId;
  void threadId;
  legacyConversationWriteRetired();
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
