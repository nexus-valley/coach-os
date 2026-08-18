import { logActivity } from "@/src/lib/auditLogger";
import type { CohortWithCourse } from "@/src/lib/cohorts";
import type { Course } from "@/src/lib/courses";
import {
  explainPermissionSource,
  logDelegatedPermissionUsage,
  type DelegatedPermission,
  type DelegatedPermissionKey,
  type DelegatedPermissionScopeType,
} from "@/src/lib/delegatedPermissions";
import {
  createNotificationForTenantRoles,
  createNotificationsForUsers,
} from "@/src/lib/notifications";
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

export type AssignmentStatus = "closed" | "draft" | "published";

export type Assignment = {
  attachment_urls_json: string[];
  cohort_id: string | null;
  course_id: string | null;
  created_at: string;
  created_by: string | null;
  description: string | null;
  due_at: string | null;
  id: string;
  instructions: string | null;
  max_score: number | null;
  status: AssignmentStatus;
  tenant_id: string;
  title: string;
  trainer_user_id: string | null;
  updated_at: string;
};

export type AssignmentWithRelations = Assignment & {
  awaitingReviewCount: number;
  cohort: Pick<CohortWithCourse, "id" | "name"> | null;
  course: Pick<Course, "id" | "title"> | null;
  submissionCounts: Record<"late" | "pending" | "reviewed" | "submitted", number>;
};

export type AssignmentListSort = "due_soon" | "newest" | "title";

export type AssignmentListOptions = {
  courseId?: string | null;
  needsReview?: boolean;
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: AssignmentListSort;
  status?: AssignmentStatus | null;
};

export type AssignmentListPage = {
  hasNext: boolean;
  hasPrevious: boolean;
  items: AssignmentWithRelations[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AssignmentProgramOption = Pick<Course, "id" | "title">;

export const assignmentListDefaultPageSize = 24;
export const assignmentListMaximumPageSize = 50;
const assignmentListMaximumPage = 10_000;

export type AssignmentInput = {
  attachmentUrls?: string[];
  cohortId?: string | null;
  courseId?: string | null;
  description: string;
  dueAt: string;
  instructions: string;
  maxScore?: string | number | null;
  tenantId: string;
  title: string;
  trainerUserId?: string | null;
};

export type UpdateAssignmentInput = AssignmentInput & {
  assignmentId: string;
};

const assignmentColumns =
  "id,tenant_id,course_id,cohort_id,trainer_user_id,title,description,instructions,attachment_urls_json,max_score,due_at,status,created_by,created_at,updated_at";
const assignmentNeedsReviewColumns =
  "id,tenant_id,course_id,cohort_id,trainer_user_id,title,description,instructions,attachment_urls_json,max_score,due_at,status,created_by,created_at,updated_at,assignment_submissions!inner(status)";

type DelegatedAssignmentDecision =
  | { source: "role" }
  | {
      delegatedPermission: DelegatedPermission;
      permissionKey: DelegatedPermissionKey;
      scopeId: string | null;
      scopeType: DelegatedPermissionScopeType;
      source: "delegated";
    };

function normalizeAssignment(row: Assignment) {
  return {
    ...row,
    attachment_urls_json: Array.isArray(row.attachment_urls_json)
      ? row.attachment_urls_json
      : [],
    max_score:
      row.max_score === null || typeof row.max_score === "undefined"
        ? null
        : Number(row.max_score),
  } satisfies Assignment;
}

function normalizeAttachmentUrls(urls: string[] | undefined) {
  return (urls ?? []).map((url) => url.trim()).filter(Boolean);
}

function normalizeAssignmentSearch(search: string | undefined) {
  return (search ?? "").trim().slice(0, 120);
}

function escapeIlikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function normalizePage(value: number | undefined) {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Math.min(Number(value), assignmentListMaximumPage)
    : 1;
}

function normalizePageSize(value: number | undefined) {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    return assignmentListDefaultPageSize;
  }

  return Math.min(Number(value), assignmentListMaximumPageSize);
}

function normalizeDateTimeInput(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Due date must be a valid date and time.");
  }

  return date.toISOString();
}

function normalizeMaxScore(value: string | number | null | undefined) {
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }

  const score = Number(value);

  if (!Number.isFinite(score) || score < 0) {
    throw new Error("Max score must be a non-negative number.");
  }

  return score;
}

function validateAssignmentInput(input: AssignmentInput) {
  const title = input.title.trim();

  if (!title) {
    throw new Error("Assignment title is required.");
  }

  if (!input.courseId && !input.cohortId) {
    throw new Error("Select a course or cohort for this assignment.");
  }

  return {
    attachmentUrls: normalizeAttachmentUrls(input.attachmentUrls),
    dueAt: normalizeDateTimeInput(input.dueAt),
    maxScore: normalizeMaxScore(input.maxScore),
    title,
  };
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
    throw new Error("You must be logged in to access assignments.");
  }

  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (!canAccessAttendance(role)) {
    await logActivity({
      action: "access_denied",
      description: "Blocked assignments access attempt.",
      entityName: "Assignments",
      entityType: "security",
      metadata: { role, route: "/app/assignments" },
      severity: "warning",
      tenantId,
    });
    throw new Error("You do not have permission to access assignments.");
  }

  return { role, user };
}

export async function ensureCanManageAssignment(params: {
  assignmentId?: string | null;
  assignmentTrainerUserId?: string | null;
  cohortId?: string | null;
  courseId?: string | null;
  tenantId: string;
}) {
  return ensureCanUseAssignmentPermission({
    ...params,
    action: "manage_assignment",
    permissionKey: "manage_assignments",
  });
}

export async function ensureCanReviewAssignment(params: {
  assignmentId?: string | null;
  assignmentTrainerUserId?: string | null;
  cohortId?: string | null;
  courseId?: string | null;
  studentId?: string | null;
  tenantId: string;
}) {
  return ensureCanUseAssignmentPermission({
    ...params,
    action: "review_assignment",
    permissionKey: "review_assignments",
  });
}

async function ensureCanUseAssignmentPermission(params: {
  action: string;
  assignmentId?: string | null;
  assignmentTrainerUserId?: string | null;
  cohortId?: string | null;
  courseId?: string | null;
  permissionKey: "manage_assignments" | "review_assignments";
  studentId?: string | null;
  tenantId: string;
}) {
  const { role, user } = await getCurrentUserAndRole(params.tenantId);
  const baseRoleAllowed = canManageAttendance(role);
  const delegatedDecision = baseRoleAllowed
    ? null
    : await getDelegatedAssignmentDecision({
        assignmentId: params.assignmentId,
        cohortId: params.cohortId,
        courseId: params.courseId,
        permissionKey: params.permissionKey,
        studentId: params.studentId,
        tenantId: params.tenantId,
        userId: user.id,
      });

  if (!baseRoleAllowed && !delegatedDecision) {
    throw new Error("You do not have permission to manage assignments.");
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

    const directlyAssigned = params.assignmentTrainerUserId === user.id;

    if (!directlyAssigned && !courseAssigned && !cohortAssigned) {
      await logActivity({
        action: "access_denied",
        description: "Blocked trainer assignment change outside assignment scope.",
        entityName: "Assignment scope",
        entityType: "security",
        metadata: {
          cohortId: params.cohortId ?? null,
          courseId: params.courseId ?? null,
          role,
        },
        severity: "warning",
        tenantId: params.tenantId,
      });
      throw new Error("Trainers can only manage assignments for assigned courses or cohorts.");
    }
  }

  return {
    decision:
      delegatedDecision ??
      ({ source: "role" } satisfies DelegatedAssignmentDecision),
    role,
    user,
  };
}

async function getDelegatedAssignmentDecision(params: {
  assignmentId?: string | null;
  cohortId?: string | null;
  courseId?: string | null;
  permissionKey: "manage_assignments" | "review_assignments";
  studentId?: string | null;
  tenantId: string;
  userId: string;
}): Promise<DelegatedAssignmentDecision | null> {
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

  if (params.assignmentId) {
    scopes.push({ scopeId: params.assignmentId, scopeType: "assignment" });
  }

  if (params.studentId) {
    scopes.push({ scopeId: params.studentId, scopeType: "student" });
  }

  for (const scope of scopes) {
    const source = await explainPermissionSource({
      permission: params.permissionKey,
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      tenantId: params.tenantId,
      userId: params.userId,
    });

    if (source.source === "delegated") {
      return {
        delegatedPermission: source.delegatedPermission,
        permissionKey: params.permissionKey,
        scopeId: scope.scopeId,
        scopeType: scope.scopeType,
        source: "delegated",
      };
    }
  }

  return null;
}

export async function logAssignmentDelegatedUse(params: {
  action: string;
  decision: DelegatedAssignmentDecision;
  entityId: string;
  entityType: "assignment" | "assignment_submission";
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
    entityType: params.entityType,
    scopeId: params.decision.scopeId,
    scopeType: params.decision.scopeType,
    tenantId: params.tenantId,
    userId: params.userId,
  });
}

function applyTrainerAssignmentScope<T extends { or: (filters: string) => T }>(
  query: T,
  courseIds: string[],
  cohortIds: string[],
  trainerUserId: string,
) {
  const filters: string[] = [];

  if (courseIds.length > 0) {
    filters.push(`course_id.in.(${courseIds.join(",")})`);
  }

  if (cohortIds.length > 0) {
    filters.push(`cohort_id.in.(${cohortIds.join(",")})`);
  }

  filters.push(`trainer_user_id.eq.${trainerUserId}`);

  return query.or(filters.join(","));
}

async function attachAssignmentRelations(
  assignments: Assignment[],
  tenantId: string,
  includeSubmissionCounts = true,
) {
  if (assignments.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const courseIds = Array.from(
    new Set(assignments.map((assignment) => assignment.course_id).filter(Boolean)),
  ) as string[];
  const cohortIds = Array.from(
    new Set(assignments.map((assignment) => assignment.cohort_id).filter(Boolean)),
  ) as string[];
  const assignmentIds = assignments.map((assignment) => assignment.id);

  const [coursesResult, cohortsResult, submissionsResult] = await Promise.all([
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
    includeSubmissionCounts
      ? supabase
          .from("assignment_submissions")
          .select("assignment_id,status")
          .eq("tenant_id", tenantId)
          .in("assignment_id", assignmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  if (cohortsResult.error) {
    throw cohortsResult.error;
  }

  if (submissionsResult.error) {
    throw submissionsResult.error;
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
  const countsByAssignment = new Map<
    string,
    Record<"late" | "pending" | "reviewed" | "submitted", number>
  >();

  for (const row of (submissionsResult.data ?? []) as {
    assignment_id: string;
    status: "late" | "pending" | "reviewed" | "submitted";
  }[]) {
    const counts =
      countsByAssignment.get(row.assignment_id) ?? {
        late: 0,
        pending: 0,
        reviewed: 0,
        submitted: 0,
      };
    counts[row.status] += 1;
    countsByAssignment.set(row.assignment_id, counts);
  }

  return assignments.map((assignment) => ({
    ...assignment,
    awaitingReviewCount:
      (countsByAssignment.get(assignment.id)?.late ?? 0) +
      (countsByAssignment.get(assignment.id)?.pending ?? 0) +
      (countsByAssignment.get(assignment.id)?.submitted ?? 0),
    cohort: assignment.cohort_id
      ? cohortById.get(assignment.cohort_id) ?? null
      : null,
    course: assignment.course_id
      ? courseById.get(assignment.course_id) ?? null
      : null,
    submissionCounts:
      countsByAssignment.get(assignment.id) ?? {
        late: 0,
        pending: 0,
        reviewed: 0,
        submitted: 0,
      },
  })) satisfies AssignmentWithRelations[];
}

async function notifyAssignmentRoles(
  assignment: Assignment,
  title: string,
  message: string,
  severity: "info" | "warning" = "info",
) {
  try {
    await createNotificationForTenantRoles({
      actionUrl: `/app/assignments/${assignment.id}`,
      entityId: assignment.id,
      entityType: "assignment",
      message,
      metadata: {
        cohortId: assignment.cohort_id,
        courseId: assignment.course_id,
        dueAt: assignment.due_at,
      },
      roles: ["owner", "admin"],
      severity,
      tenantId: assignment.tenant_id,
      title,
      type: "assignment_notice",
    });

    if (assignment.trainer_user_id) {
      await createNotificationsForUsers({
        actionUrl: `/app/assignments/${assignment.id}`,
        entityId: assignment.id,
        entityType: "assignment",
        message,
        metadata: {
          cohortId: assignment.cohort_id,
          courseId: assignment.course_id,
          dueAt: assignment.due_at,
        },
        severity,
        tenantId: assignment.tenant_id,
        title,
        type: "assignment_notice",
        userIds: [assignment.trainer_user_id],
      });
    }
  } catch {
    // Assignment notifications are non-blocking.
  }
}

export async function getAssignments(
  tenantId: string,
  options: AssignmentListOptions = {},
): Promise<AssignmentListPage> {
  await getCurrentUserAndRole(tenantId);
  const supabase = getSupabaseClient();
  const trainerScope = await getCurrentTrainerScope(tenantId);
  const page = normalizePage(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const search = normalizeAssignmentSearch(options.search);
  const start = (page - 1) * pageSize;
  const baseQuery = options.needsReview
    ? supabase
        .from("assignments")
        .select(assignmentNeedsReviewColumns, { count: "exact" })
    : supabase.from("assignments").select(assignmentColumns, { count: "exact" });
  let query = baseQuery.eq("tenant_id", tenantId);

  if (trainerScope) {
    query = applyTrainerAssignmentScope(
      query,
      trainerScope.courseIds,
      trainerScope.cohortIds,
      trainerScope.userId,
    );
  }

  if (search) {
    query = query.ilike("title", `%${escapeIlikePattern(search)}%`);
  }

  if (options.status) {
    query = query.eq("status", options.status);
  }

  if (options.courseId) {
    query = query.eq("course_id", options.courseId);
  }

  if (options.needsReview) {
    query = query.in("assignment_submissions.status", [
      "late",
      "pending",
      "submitted",
    ]);
  }

  const sort = options.sort ?? "due_soon";

  if (sort === "title") {
    query = query.order("title", { ascending: true }).order("id", {
      ascending: true,
    });
  } else if (sort === "newest") {
    query = query.order("created_at", { ascending: false }).order("id", {
      ascending: true,
    });
  } else {
    query = query
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
  }

  const { count, data, error } = await query.range(start, start + pageSize - 1);

  if (error) {
    throw error;
  }

  const total = count ?? 0;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  if (page > totalPages) {
    return getAssignments(tenantId, {
      ...options,
      page: totalPages,
      pageSize,
    });
  }

  const items = await attachAssignmentRelations(
    ((data ?? []) as unknown as Assignment[]).map(normalizeAssignment),
    tenantId,
  );

  return {
    hasNext: page < totalPages,
    hasPrevious: page > 1,
    items,
    page,
    pageSize,
    total,
    totalPages,
  };
}

export async function getAssignmentProgramOptions(tenantId: string) {
  await getCurrentUserAndRole(tenantId);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("courses")
    .select("id,title")
    .eq("tenant_id", tenantId)
    .order("title", { ascending: true })
    .limit(200);

  if (error) {
    throw error;
  }

  return (data ?? []) as AssignmentProgramOption[];
}

export async function getAssignmentById(params: {
  assignmentId: string;
  tenantId: string;
}) {
  await getCurrentUserAndRole(params.tenantId);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("assignments")
    .select(assignmentColumns)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.assignmentId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const [assignment] = await attachAssignmentRelations(
    [normalizeAssignment(data as Assignment)],
    params.tenantId,
    false,
  );
  return assignment ?? null;
}

export async function createAssignment(input: AssignmentInput) {
  const validated = validateAssignmentInput(input);
  const { decision, role, user } = await ensureCanManageAssignment({
    cohortId: input.cohortId,
    courseId: input.courseId,
    tenantId: input.tenantId,
  });
  const trainerUserId =
    role === "trainer" ? user.id : input.trainerUserId?.trim() || null;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("create_assignment_secure", {
      p_attachment_urls_json: validated.attachmentUrls,
      p_cohort_id: input.cohortId || null,
      p_course_id: input.courseId || null,
      p_description: input.description.trim() || null,
      p_due_at: validated.dueAt,
      p_instructions: input.instructions.trim() || null,
      p_max_score: validated.maxScore,
      p_tenant_id: input.tenantId,
      p_title: validated.title,
      p_trainer_user_id: trainerUserId,
    });

  if (error) {
    throw error;
  }

  const assignment = normalizeAssignment(data as Assignment);

  await logActivity({
    action: "assignment_created",
    description: "Created assignment",
    entityId: assignment.id,
    entityName: assignment.title,
    entityType: "assignment",
    metadata: {
      cohortId: assignment.cohort_id,
      courseId: assignment.course_id,
      dueAt: assignment.due_at,
      maxScore: assignment.max_score,
    },
    tenantId: assignment.tenant_id,
  });
  await logAssignmentDelegatedUse({
    action: "create_assignment",
    decision,
    entityId: assignment.id,
    entityType: "assignment",
    tenantId: assignment.tenant_id,
    userId: user.id,
  });

  return assignment;
}

export async function updateAssignment(input: UpdateAssignmentInput) {
  const validated = validateAssignmentInput(input);
  const existing = await getAssignmentById({
    assignmentId: input.assignmentId,
    tenantId: input.tenantId,
  });

  if (!existing) {
    throw new Error("Assignment not found in this workspace.");
  }

  const { decision, user } = await ensureCanManageAssignment({
    assignmentId: input.assignmentId,
    assignmentTrainerUserId: existing.trainer_user_id,
    cohortId: input.cohortId,
    courseId: input.courseId,
    tenantId: input.tenantId,
  });
  const trainerUserId = input.trainerUserId?.trim() || null;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_assignment_secure", {
      p_assignment_id: input.assignmentId,
      p_attachment_urls_json: validated.attachmentUrls,
      p_cohort_id: input.cohortId || null,
      p_course_id: input.courseId || null,
      p_description: input.description.trim() || null,
      p_due_at: validated.dueAt,
      p_instructions: input.instructions.trim() || null,
      p_max_score: validated.maxScore,
      p_tenant_id: input.tenantId,
      p_title: validated.title,
      p_trainer_user_id: trainerUserId,
    });

  if (error) {
    throw error;
  }

  const assignment = normalizeAssignment(data as Assignment);

  await logActivity({
    action: "assignment_updated",
    description: "Updated assignment",
    entityId: assignment.id,
    entityName: assignment.title,
    entityType: "assignment",
    metadata: {
      cohortId: assignment.cohort_id,
      courseId: assignment.course_id,
      dueAt: assignment.due_at,
      status: assignment.status,
    },
    tenantId: assignment.tenant_id,
  });
  await logAssignmentDelegatedUse({
    action: "update_assignment",
    decision,
    entityId: assignment.id,
    entityType: "assignment",
    tenantId: assignment.tenant_id,
    userId: user.id,
  });

  return assignment;
}

async function updateAssignmentStatus(params: {
  action: "assignment_closed" | "assignment_published";
  assignmentId: string;
  description: string;
  status: Extract<AssignmentStatus, "closed" | "published">;
  tenantId: string;
}) {
  const existing = await getAssignmentById({
    assignmentId: params.assignmentId,
    tenantId: params.tenantId,
  });

  if (!existing) {
    throw new Error("Assignment not found in this workspace.");
  }

  const { decision, user } = await ensureCanManageAssignment({
    assignmentId: existing.id,
    assignmentTrainerUserId: existing.trainer_user_id,
    cohortId: existing.cohort_id,
    courseId: existing.course_id,
    tenantId: params.tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_assignment_status_secure", {
      p_assignment_id: params.assignmentId,
      p_status: params.status,
      p_tenant_id: params.tenantId,
    });

  if (error) {
    throw error;
  }

  const assignment = normalizeAssignment(data as Assignment);

  await logActivity({
    action: params.action,
    description: params.description,
    entityId: assignment.id,
    entityName: assignment.title,
    entityType: "assignment",
    metadata: {
      cohortId: assignment.cohort_id,
      courseId: assignment.course_id,
      dueAt: assignment.due_at,
      status: assignment.status,
    },
    severity: params.action === "assignment_closed" ? "warning" : "info",
    tenantId: assignment.tenant_id,
  });
  await logAssignmentDelegatedUse({
    action: params.action,
    decision,
    entityId: assignment.id,
    entityType: "assignment",
    tenantId: assignment.tenant_id,
    userId: user.id,
  });

  if (params.action === "assignment_published") {
    const dueTime = assignment.due_at
      ? new Date(assignment.due_at).getTime()
      : null;
    const now = Date.now();
    const dueSoon =
      dueTime !== null && dueTime >= now && dueTime - now <= 48 * 60 * 60 * 1000;
    const overdue = dueTime !== null && dueTime < now;

    await notifyAssignmentRoles(
      assignment,
      overdue
        ? `Assignment overdue: ${assignment.title}`
        : dueSoon
          ? `Assignment due soon: ${assignment.title}`
          : `Assignment published: ${assignment.title}`,
      overdue
        ? `Assignment ${assignment.title} is already past its due date.`
        : dueSoon
          ? `Assignment ${assignment.title} is due soon.`
          : `Assignment ${assignment.title} is now published.`,
      overdue || dueSoon ? "warning" : "info",
    );
  }

  return assignment;
}

export async function publishAssignment(params: {
  assignmentId: string;
  tenantId: string;
}) {
  return updateAssignmentStatus({
    action: "assignment_published",
    assignmentId: params.assignmentId,
    description: "Published assignment",
    status: "published",
    tenantId: params.tenantId,
  });
}

export async function closeAssignment(params: {
  assignmentId: string;
  tenantId: string;
}) {
  return updateAssignmentStatus({
    action: "assignment_closed",
    assignmentId: params.assignmentId,
    description: "Closed assignment",
    status: "closed",
    tenantId: params.tenantId,
  });
}

export function canRoleManageAssignments(role: MemberRole | null | undefined) {
  return canManageAttendance(role);
}

export { assignmentColumns, normalizeAssignment };
