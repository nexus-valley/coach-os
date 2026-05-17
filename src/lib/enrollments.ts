import { logActivity } from "@/src/lib/auditLogger";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
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
  return getEnrollmentsByFilter(params.tenantId, {
    column: "student_id",
    value: params.studentId,
  });
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

export async function createEnrollment(input: CreateEnrollmentInput) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("You must be logged in to create an enrollment.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("enrollments")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("student_id", input.studentId)
    .eq("course_id", input.courseId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    throw new Error("This student is already enrolled in that course.");
  }

  const { data, error } = await supabase
    .from("enrollments")
    .insert({
      course_id: input.courseId,
      created_by: user.id,
      status: input.status ?? "active",
      student_id: input.studentId,
      tenant_id: input.tenantId,
    })
    .select(
      "id,tenant_id,student_id,course_id,status,enrolled_at,completed_at,created_by,created_at,updated_at",
    )
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("This student is already enrolled in that course.");
    }

    throw error;
  }

  const enrollment = data as Enrollment;

  await logActivity({
    action: "enrollment_created",
    description: "Added student enrollment",
    entityId: enrollment.id,
    entityName: "Course enrollment",
    entityType: "enrollment",
    metadata: {
      courseId: enrollment.course_id,
      studentId: enrollment.student_id,
      status: enrollment.status,
    },
    tenantId: enrollment.tenant_id,
  });

  return enrollment;
}

export async function updateEnrollmentStatus(
  input: UpdateEnrollmentStatusInput,
) {
  const completedAt =
    input.status === "completed" ? new Date().toISOString() : null;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("enrollments")
    .update({
      completed_at: completedAt,
      status: input.status,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.enrollmentId)
    .select(
      "id,tenant_id,student_id,course_id,status,enrolled_at,completed_at,created_by,created_at,updated_at",
    )
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
  const { data: existingEnrollment, error: existingError } = await supabase
    .from("enrollments")
    .select(
      "id,tenant_id,student_id,course_id,status,enrolled_at,completed_at,created_by,created_at,updated_at",
    )
    .eq("tenant_id", params.tenantId)
    .eq("id", params.enrollmentId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const { error } = await supabase
    .from("enrollments")
    .delete()
    .eq("tenant_id", params.tenantId)
    .eq("id", params.enrollmentId);

  if (error) {
    throw error;
  }

  if (existingEnrollment) {
    const enrollment = existingEnrollment as Enrollment;
    await logActivity({
      action: "enrollment_deleted",
      description: "Removed course enrollment",
      entityId: enrollment.id,
      entityName: "Course enrollment",
      entityType: "enrollment",
      metadata: {
        courseId: enrollment.course_id,
        status: enrollment.status,
        studentId: enrollment.student_id,
      },
      severity: "warning",
      tenantId: enrollment.tenant_id,
    });
  }
}
