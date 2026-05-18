import type { Course } from "@/src/lib/courses";
import { requireTenantPermission } from "@/src/lib/permissions";
import type { Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentTrainerScope } from "@/src/lib/trainerAssignments";

export type Cohort = {
  id: string;
  tenant_id: string;
  course_id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

export type CohortMember = {
  id: string;
  tenant_id: string;
  cohort_id: string;
  student_id: string;
  enrolled_at: string;
};

export type CohortWithCourse = Cohort & {
  course: Pick<Course, "id" | "title"> | null;
  memberCount: number;
};

export type CohortMemberWithStudent = CohortMember & {
  student: Pick<Student, "id" | "full_name" | "email" | "phone" | "status"> | null;
};

export type StudentCohortMembership = CohortMember & {
  cohort: CohortWithCourse | null;
};

export type CohortInput = {
  courseId: string;
  description: string;
  endDate: string;
  name: string;
  startDate: string;
  tenantId: string;
};

export type UpdateCohortInput = CohortInput & {
  cohortId: string;
};

const cohortColumns =
  "id,tenant_id,course_id,name,description,start_date,end_date,created_at";

const cohortMemberColumns =
  "id,tenant_id,cohort_id,student_id,enrolled_at";

async function attachCohortRelations(cohorts: Cohort[], tenantId: string) {
  if (cohorts.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const courseIds = Array.from(
    new Set(cohorts.map((cohort) => cohort.course_id)),
  );
  const cohortIds = cohorts.map((cohort) => cohort.id);

  const [coursesResult, membersResult] = await Promise.all([
    courseIds.length
      ? supabase
          .from("courses")
          .select("id,title")
          .eq("tenant_id", tenantId)
          .in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("cohort_members")
      .select("cohort_id")
      .eq("tenant_id", tenantId)
      .in("cohort_id", cohortIds),
  ]);

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  if (membersResult.error) {
    throw membersResult.error;
  }

  const courses = (coursesResult.data ?? []) as Pick<Course, "id" | "title">[];
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const memberCounts = new Map<string, number>();

  for (const member of (membersResult.data ?? []) as { cohort_id: string }[]) {
    memberCounts.set(member.cohort_id, (memberCounts.get(member.cohort_id) ?? 0) + 1);
  }

  return cohorts.map((cohort) => ({
    ...cohort,
    course: courseById.get(cohort.course_id) ?? null,
    memberCount: memberCounts.get(cohort.id) ?? 0,
  }));
}

export async function getCohortsForTenant(tenantId: string) {
  const supabase = getSupabaseClient();
  const trainerScope = await getCurrentTrainerScope(tenantId);

  if (trainerScope && trainerScope.cohortIds.length === 0) {
    return [];
  }

  let query = supabase
    .from("cohorts")
    .select(cohortColumns)
    .eq("tenant_id", tenantId);

  if (trainerScope) {
    query = query.in("id", trainerScope.cohortIds);
  }

  const { data, error } = await query
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return attachCohortRelations((data ?? []) as Cohort[], tenantId);
}

export async function getCohortById(params: {
  cohortId: string;
  tenantId: string;
}) {
  const trainerScope = await getCurrentTrainerScope(params.tenantId);

  if (trainerScope && !trainerScope.cohortIds.includes(params.cohortId)) {
    return null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("cohorts")
    .select(cohortColumns)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.cohortId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const [cohort] = await attachCohortRelations([data as Cohort], params.tenantId);
  return cohort ?? null;
}

export async function createCohort(input: CohortInput) {
  await requireTenantPermission({
    description: "Blocked cohort creation without course management permission.",
    permission: "manage_courses",
    tenantId: input.tenantId,
  });

  const name = input.name.trim();

  if (!name) {
    throw new Error("Cohort name is required.");
  }

  if (!input.courseId) {
    throw new Error("Select a course before creating a cohort.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("cohorts")
    .insert({
      course_id: input.courseId,
      description: input.description.trim() || null,
      end_date: input.endDate || null,
      name,
      start_date: input.startDate || null,
      tenant_id: input.tenantId,
    })
    .select(cohortColumns)
    .single();

  if (error) {
    throw error;
  }

  return data as Cohort;
}

export async function updateCohort(input: UpdateCohortInput) {
  await requireTenantPermission({
    description: "Blocked cohort update without course management permission.",
    permission: "manage_courses",
    tenantId: input.tenantId,
  });

  const name = input.name.trim();

  if (!name) {
    throw new Error("Cohort name is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("cohorts")
    .update({
      course_id: input.courseId,
      description: input.description.trim() || null,
      end_date: input.endDate || null,
      name,
      start_date: input.startDate || null,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.cohortId)
    .select(cohortColumns)
    .single();

  if (error) {
    throw error;
  }

  return data as Cohort;
}

export async function deleteCohort(params: {
  cohortId: string;
  tenantId: string;
}) {
  await requireTenantPermission({
    description: "Blocked cohort deletion without delete permission.",
    permission: "delete_records",
    tenantId: params.tenantId,
  });

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("cohorts")
    .delete()
    .eq("tenant_id", params.tenantId)
    .eq("id", params.cohortId);

  if (error) {
    throw error;
  }
}

export async function getCohortMembers(params: {
  cohortId: string;
  tenantId: string;
}) {
  const trainerScope = await getCurrentTrainerScope(params.tenantId);

  if (trainerScope && !trainerScope.cohortIds.includes(params.cohortId)) {
    return [];
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("cohort_members")
    .select(cohortMemberColumns)
    .eq("tenant_id", params.tenantId)
    .eq("cohort_id", params.cohortId)
    .order("enrolled_at", { ascending: false });

  if (error) {
    throw error;
  }

  const members = (data ?? []) as CohortMember[];
  const studentIds = Array.from(
    new Set(members.map((member) => member.student_id)),
  );

  const studentsResult = studentIds.length
    ? await supabase
        .from("students")
        .select("id,full_name,email,phone,status")
        .eq("tenant_id", params.tenantId)
        .in("id", studentIds)
    : { data: [], error: null };

  if (studentsResult.error) {
    throw studentsResult.error;
  }

  const students = (studentsResult.data ?? []) as Pick<
    Student,
    "id" | "full_name" | "email" | "phone" | "status"
  >[];
  const studentById = new Map(
    students.map((student) => [student.id, student]),
  );

  return members.map((member) => ({
    ...member,
    student: studentById.get(member.student_id) ?? null,
  })) as CohortMemberWithStudent[];
}

export async function getCohortsForStudent(params: {
  studentId: string;
  tenantId: string;
}) {
  const trainerScope = await getCurrentTrainerScope(params.tenantId);
  const supabase = getSupabaseClient();
  let query = supabase
    .from("cohort_members")
    .select(cohortMemberColumns)
    .eq("tenant_id", params.tenantId)
    .eq("student_id", params.studentId);

  if (trainerScope) {
    if (trainerScope.cohortIds.length === 0) {
      return [];
    }

    query = query.in("cohort_id", trainerScope.cohortIds);
  }

  const { data, error } = await query
    .order("enrolled_at", { ascending: false });

  if (error) {
    throw error;
  }

  const memberships = (data ?? []) as CohortMember[];
  const cohortIds = Array.from(
    new Set(memberships.map((membership) => membership.cohort_id)),
  );

  const cohortsResult = cohortIds.length
    ? await supabase
        .from("cohorts")
        .select(cohortColumns)
        .eq("tenant_id", params.tenantId)
        .in("id", cohortIds)
    : { data: [], error: null };

  if (cohortsResult.error) {
    throw cohortsResult.error;
  }

  const cohorts = await attachCohortRelations(
    (cohortsResult.data ?? []) as Cohort[],
    params.tenantId,
  );
  const cohortById = new Map(cohorts.map((cohort) => [cohort.id, cohort]));

  return memberships.map((membership) => ({
    ...membership,
    cohort: cohortById.get(membership.cohort_id) ?? null,
  })) as StudentCohortMembership[];
}

export async function addStudentToCohort(params: {
  cohortId: string;
  studentId: string;
  tenantId: string;
}) {
  await requireTenantPermission({
    description: "Blocked cohort member update without student management permission.",
    permission: "manage_students",
    tenantId: params.tenantId,
  });

  const supabase = getSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("cohort_members")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("cohort_id", params.cohortId)
    .eq("student_id", params.studentId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    throw new Error("This student is already in that cohort.");
  }

  const { data, error } = await supabase
    .from("cohort_members")
    .insert({
      cohort_id: params.cohortId,
      student_id: params.studentId,
      tenant_id: params.tenantId,
    })
    .select(cohortMemberColumns)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("This student is already in that cohort.");
    }

    throw error;
  }

  return data as CohortMember;
}

export async function removeStudentFromCohort(params: {
  cohortId: string;
  studentId: string;
  tenantId: string;
}) {
  await requireTenantPermission({
    description: "Blocked cohort member removal without student management permission.",
    permission: "manage_students",
    tenantId: params.tenantId,
  });

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("cohort_members")
    .delete()
    .eq("tenant_id", params.tenantId)
    .eq("cohort_id", params.cohortId)
    .eq("student_id", params.studentId);

  if (error) {
    throw error;
  }
}
