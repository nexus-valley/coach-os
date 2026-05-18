import { logActivity } from "@/src/lib/auditLogger";
import { getMemberRoleForTenant, requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

type AssignmentCourse = {
  id: string;
  title: string;
};

type AssignmentCohort = {
  id: string;
  name: string;
};

export type TrainerCourseAssignment = {
  assigned_by: string | null;
  course: AssignmentCourse | null;
  course_id: string;
  created_at: string;
  id: string;
  tenant_id: string;
  trainer_user_id: string;
};

export type TrainerCohortAssignment = {
  assigned_by: string | null;
  cohort: AssignmentCohort | null;
  cohort_id: string;
  created_at: string;
  id: string;
  tenant_id: string;
  trainer_user_id: string;
};

const trainerCourseAssignmentSelect =
  "id,tenant_id,trainer_user_id,course_id,assigned_by,created_at";
const trainerCohortAssignmentSelect =
  "id,tenant_id,trainer_user_id,cohort_id,assigned_by,created_at";

async function getCurrentUser() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  return user;
}

async function ensureAssignmentManager(tenantId: string) {
  return requireTenantPermission({
    description: "Blocked trainer assignment change without admin permission.",
    permission: "invite_team",
    tenantId,
  });
}

async function ensureTargetIsTrainer(tenantId: string, trainerUserId: string) {
  const role = await getMemberRoleForTenant(tenantId, trainerUserId);

  if (role !== "trainer") {
    throw new Error("Assignments can only be created for trainer users.");
  }
}

async function attachCourseAssignments(
  assignments: Omit<TrainerCourseAssignment, "course">[],
  tenantId: string,
) {
  if (assignments.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const courseIds = Array.from(
    new Set(assignments.map((assignment) => assignment.course_id)),
  );
  const { data, error } = await supabase
    .from("courses")
    .select("id,title")
    .eq("tenant_id", tenantId)
    .in("id", courseIds);

  if (error) {
    throw error;
  }

  const courses = (data ?? []) as AssignmentCourse[];
  const courseById = new Map(courses.map((course) => [course.id, course]));

  return assignments.map((assignment) => ({
    ...assignment,
    course: courseById.get(assignment.course_id) ?? null,
  })) satisfies TrainerCourseAssignment[];
}

async function attachCohortAssignments(
  assignments: Omit<TrainerCohortAssignment, "cohort">[],
  tenantId: string,
) {
  if (assignments.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const cohortIds = Array.from(
    new Set(assignments.map((assignment) => assignment.cohort_id)),
  );
  const { data, error } = await supabase
    .from("cohorts")
    .select("id,name")
    .eq("tenant_id", tenantId)
    .in("id", cohortIds);

  if (error) {
    throw error;
  }

  const cohorts = (data ?? []) as AssignmentCohort[];
  const cohortById = new Map(cohorts.map((cohort) => [cohort.id, cohort]));

  return assignments.map((assignment) => ({
    ...assignment,
    cohort: cohortById.get(assignment.cohort_id) ?? null,
  })) satisfies TrainerCohortAssignment[];
}

export async function getTrainerAssignedCourseIds(
  tenantId: string,
  trainerUserId: string,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("trainer_course_assignments")
    .select("course_id")
    .eq("tenant_id", tenantId)
    .eq("trainer_user_id", trainerUserId);

  if (error) {
    throw error;
  }

  return ((data ?? []) as { course_id: string }[]).map((item) => item.course_id);
}

export async function getTrainerAssignedCohortIds(
  tenantId: string,
  trainerUserId: string,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("trainer_cohort_assignments")
    .select("cohort_id")
    .eq("tenant_id", tenantId)
    .eq("trainer_user_id", trainerUserId);

  if (error) {
    throw error;
  }

  return ((data ?? []) as { cohort_id: string }[]).map((item) => item.cohort_id);
}

export async function getTrainerAssignedCourses(
  tenantId: string,
  trainerUserId: string,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("trainer_course_assignments")
    .select(trainerCourseAssignmentSelect)
    .eq("tenant_id", tenantId)
    .eq("trainer_user_id", trainerUserId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return attachCourseAssignments(
    (data ?? []) as Omit<TrainerCourseAssignment, "course">[],
    tenantId,
  );
}

export async function getTrainerAssignedCohorts(
  tenantId: string,
  trainerUserId: string,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("trainer_cohort_assignments")
    .select(trainerCohortAssignmentSelect)
    .eq("tenant_id", tenantId)
    .eq("trainer_user_id", trainerUserId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return attachCohortAssignments(
    (data ?? []) as Omit<TrainerCohortAssignment, "cohort">[],
    tenantId,
  );
}

export async function isTrainerAssignedToCourse(
  tenantId: string,
  trainerUserId: string,
  courseId: string,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("trainer_course_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("trainer_user_id", trainerUserId)
    .eq("course_id", courseId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

export async function isTrainerAssignedToCohort(
  tenantId: string,
  trainerUserId: string,
  cohortId: string,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("trainer_cohort_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("trainer_user_id", trainerUserId)
    .eq("cohort_id", cohortId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

export async function assignTrainerToCourse(params: {
  courseId: string;
  tenantId: string;
  trainerUserId: string;
}) {
  const { user } = await ensureAssignmentManager(params.tenantId);
  await ensureTargetIsTrainer(params.tenantId, params.trainerUserId);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("trainer_course_assignments")
    .insert({
      assigned_by: user.id,
      course_id: params.courseId,
      tenant_id: params.tenantId,
      trainer_user_id: params.trainerUserId,
    })
    .select(trainerCourseAssignmentSelect)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("Trainer is already assigned to this course.");
    }

    throw error;
  }

  const [assignment] = await attachCourseAssignments(
    [data as Omit<TrainerCourseAssignment, "course">],
    params.tenantId,
  );

  await logActivity({
    action: "trainer_assigned_course",
    description: `Assigned trainer to course ${assignment.course?.title ?? params.courseId}`,
    entityId: assignment.id,
    entityName: assignment.course?.title ?? "Course assignment",
    entityType: "trainer_assignment",
    metadata: {
      courseId: assignment.course_id,
      trainerUserId: assignment.trainer_user_id,
    },
    tenantId: assignment.tenant_id,
  });

  return assignment;
}

export async function removeTrainerFromCourse(params: {
  courseId: string;
  tenantId: string;
  trainerUserId: string;
}) {
  await ensureAssignmentManager(params.tenantId);
  const existing = await getTrainerAssignedCourses(
    params.tenantId,
    params.trainerUserId,
  );
  const assignment = existing.find((item) => item.course_id === params.courseId);
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("trainer_course_assignments")
    .delete()
    .eq("tenant_id", params.tenantId)
    .eq("trainer_user_id", params.trainerUserId)
    .eq("course_id", params.courseId);

  if (error) {
    throw error;
  }

  await logActivity({
    action: "trainer_removed_course",
    description: `Removed trainer from course ${assignment?.course?.title ?? params.courseId}`,
    entityId: assignment?.id ?? null,
    entityName: assignment?.course?.title ?? "Course assignment",
    entityType: "trainer_assignment",
    metadata: {
      courseId: params.courseId,
      trainerUserId: params.trainerUserId,
    },
    tenantId: params.tenantId,
  });
}

export async function assignTrainerToCohort(params: {
  cohortId: string;
  tenantId: string;
  trainerUserId: string;
}) {
  const { user } = await ensureAssignmentManager(params.tenantId);
  await ensureTargetIsTrainer(params.tenantId, params.trainerUserId);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("trainer_cohort_assignments")
    .insert({
      assigned_by: user.id,
      cohort_id: params.cohortId,
      tenant_id: params.tenantId,
      trainer_user_id: params.trainerUserId,
    })
    .select(trainerCohortAssignmentSelect)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("Trainer is already assigned to this cohort.");
    }

    throw error;
  }

  const [assignment] = await attachCohortAssignments(
    [data as Omit<TrainerCohortAssignment, "cohort">],
    params.tenantId,
  );

  await logActivity({
    action: "trainer_assigned_cohort",
    description: `Assigned trainer to cohort ${assignment.cohort?.name ?? params.cohortId}`,
    entityId: assignment.id,
    entityName: assignment.cohort?.name ?? "Cohort assignment",
    entityType: "trainer_assignment",
    metadata: {
      cohortId: assignment.cohort_id,
      trainerUserId: assignment.trainer_user_id,
    },
    tenantId: assignment.tenant_id,
  });

  return assignment;
}

export async function removeTrainerFromCohort(params: {
  cohortId: string;
  tenantId: string;
  trainerUserId: string;
}) {
  await ensureAssignmentManager(params.tenantId);
  const existing = await getTrainerAssignedCohorts(
    params.tenantId,
    params.trainerUserId,
  );
  const assignment = existing.find((item) => item.cohort_id === params.cohortId);
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("trainer_cohort_assignments")
    .delete()
    .eq("tenant_id", params.tenantId)
    .eq("trainer_user_id", params.trainerUserId)
    .eq("cohort_id", params.cohortId);

  if (error) {
    throw error;
  }

  await logActivity({
    action: "trainer_removed_cohort",
    description: `Removed trainer from cohort ${assignment?.cohort?.name ?? params.cohortId}`,
    entityId: assignment?.id ?? null,
    entityName: assignment?.cohort?.name ?? "Cohort assignment",
    entityType: "trainer_assignment",
    metadata: {
      cohortId: params.cohortId,
      trainerUserId: params.trainerUserId,
    },
    tenantId: params.tenantId,
  });
}

export async function getCurrentTrainerScope(tenantId: string) {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (role !== "trainer") {
    return null;
  }

  const [courseIds, cohortIds] = await Promise.all([
    getTrainerAssignedCourseIds(tenantId, user.id),
    getTrainerAssignedCohortIds(tenantId, user.id),
  ]);

  return {
    cohortIds,
    courseIds,
    role,
    userId: user.id,
  };
}
