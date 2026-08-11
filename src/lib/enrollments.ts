import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentTrainerScope } from "@/src/lib/trainerAssignments";
import type { Course } from "@/src/lib/courses";
import type { Student } from "@/src/lib/students";

export type EnrollmentStatus = "active" | "completed" | "paused" | "cancelled";

export type Enrollment = {
  id: string;
  tenant_id: string;
  student_id: string;
  course_id: string;
  status: EnrollmentStatus;
  enrolled_at: string;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EnrollmentWithRelations = Enrollment & {
  course: Course | null;
  student: Student | null;
};

export type CreateEnrollmentInput = {
  courseId: string;
  status?: EnrollmentStatus;
  studentId: string;
  tenantId: string;
};

export type UpdateEnrollmentStatusInput = {
  enrollmentId: string;
  status: EnrollmentStatus;
  tenantId: string;
};

export type EnrollmentCourseOption = Pick<Course, "id" | "status" | "title">;

async function loadEnrollmentRelations(
  enrollments: Enrollment[],
  tenantId: string,
) {
  const supabase = getSupabaseClient();
  const courseIds = Array.from(
    new Set(enrollments.map((enrollment) => enrollment.course_id)),
  );
  const studentIds = Array.from(
    new Set(enrollments.map((enrollment) => enrollment.student_id)),
  );

  const [coursesResult, studentsResult] = await Promise.all([
    courseIds.length
      ? supabase
          .from("courses")
          .select(
            "id,tenant_id,title,slug,description,status,thumbnail_url,created_by,created_at,updated_at",
          )
          .eq("tenant_id", tenantId)
          .in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("students")
          .select(
            "id,tenant_id,full_name,email,phone,status,source,notes,created_by,created_at,updated_at",
          )
          .eq("tenant_id", tenantId)
          .in("id", studentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  if (studentsResult.error) {
    throw studentsResult.error;
  }

  const courses = (coursesResult.data ?? []) as Course[];
  const students = (studentsResult.data ?? []) as Student[];
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const studentById = new Map(students.map((student) => [student.id, student]));

  return enrollments.map((enrollment) => ({
    ...enrollment,
    course: courseById.get(enrollment.course_id) ?? null,
    student: studentById.get(enrollment.student_id) ?? null,
  }));
}

async function getEnrollmentsByFilter(
  tenantId: string,
  filter?: { column: "course_id" | "student_id"; value: string },
) {
  const supabase = getSupabaseClient();
  const trainerScope = await getCurrentTrainerScope(tenantId);

  if (trainerScope) {
    if (trainerScope.courseIds.length === 0) {
      return [];
    }

    if (
      filter?.column === "course_id" &&
      !trainerScope.courseIds.includes(filter.value)
    ) {
      return [];
    }
  }

  let query = supabase
    .from("enrollments")
    .select(
      "id,tenant_id,student_id,course_id,status,enrolled_at,completed_at,created_by,created_at,updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("enrolled_at", { ascending: false });

  if (filter) {
    query = query.eq(filter.column, filter.value);
  }

  if (trainerScope) {
    query = query.in("course_id", trainerScope.courseIds);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return loadEnrollmentRelations((data ?? []) as Enrollment[], tenantId);
}

export async function getEnrollmentsForTenant(tenantId: string) {
  return getEnrollmentsByFilter(tenantId);
}

export async function getEnrollmentsForStudent(params: {
  studentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("enrollments")
    .select(
      "id,tenant_id,student_id,course_id,status,enrolled_at,completed_at,created_by,created_at,updated_at",
    )
    .eq("tenant_id", params.tenantId)
    .eq("student_id", params.studentId)
    .order("enrolled_at", { ascending: false });

  if (error) {
    throw error;
  }

  return loadEnrollmentRelations((data ?? []) as Enrollment[], params.tenantId);
}

export async function getEnrollmentsForCourse(params: {
  courseId: string;
  tenantId: string;
}) {
  return getEnrollmentsByFilter(params.tenantId, {
    column: "course_id",
    value: params.courseId,
  });
}

export async function getEnrollmentCourseOptions(tenantId: string) {
  const supabase = getSupabaseClient();
  const trainerScope = await getCurrentTrainerScope(tenantId);

  if (trainerScope && trainerScope.courseIds.length === 0) {
    return [] satisfies EnrollmentCourseOption[];
  }

  let query = supabase
    .from("courses")
    .select("id,title,status")
    .eq("tenant_id", tenantId);

  if (trainerScope) {
    query = query.in("id", trainerScope.courseIds);
  }

  const { data, error } = await query.order("title", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as EnrollmentCourseOption[];
}

export async function createEnrollment(input: CreateEnrollmentInput) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("create_enrollment_secure", {
      p_course_id: input.courseId,
      p_status: input.status ?? "active",
      p_student_id: input.studentId,
      p_tenant_id: input.tenantId,
    })
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("This student is already enrolled in that program.");
    }

    throw error;
  }

  const enrollment = data as Enrollment;

  return enrollment;
}

export async function updateEnrollmentStatus(
  input: UpdateEnrollmentStatusInput,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_enrollment_status_secure", {
      p_enrollment_id: input.enrollmentId,
      p_status: input.status,
      p_tenant_id: input.tenantId,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as Enrollment;
}

export async function deleteEnrollment(params: {
  enrollmentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("remove_enrollment_secure", {
    p_enrollment_id: params.enrollmentId,
    p_tenant_id: params.tenantId,
  });

  if (error) {
    throw error;
  }
}
