import { runAutomationTrigger } from "@/src/lib/automationTriggers";
import type { EnrollmentStatus } from "@/src/lib/enrollments";
import {
  deriveStudentPortalState,
  type StudentDirectoryEnrollment,
  type StudentDirectoryRow,
} from "@/src/lib/studentDirectory";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentTrainerScope } from "@/src/lib/trainerAssignments";
import type { MemberRole } from "@/src/lib/team";
import {
  enforceWorkspaceLimit,
  refreshWorkspaceUsageSnapshot,
} from "@/src/lib/usage";

export type StudentStatus = "active" | "inactive" | "lead" | "blocked";

export type Student = {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: StudentStatus;
  source: string | null;
  notes: string | null;
  portal_enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type StudentInput = {
  email: string;
  fullName: string;
  notes: string;
  phone: string;
  source: string;
  status: StudentStatus;
  tenantId: string;
};

export type UpdateStudentInput = StudentInput & {
  studentId: string;
};

export async function getStudentsForTenant(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("students")
    .select(
      "id,tenant_id,full_name,email,phone,status,source,notes,portal_enabled,created_by,created_at,updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Student[];
}

type DirectoryEnrollmentRecord = {
  course_id: string;
  enrolled_at: string;
  id: string;
  status: EnrollmentStatus;
  student_id: string;
};

type DirectoryPortalAccountRecord = {
  status: "active" | "pending" | "revoked";
  student_id: string;
};

export async function getStudentDirectoryRows(params: {
  memberRole: MemberRole;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const [students, trainerScope] = await Promise.all([
    getStudentsForTenant(params.tenantId),
    params.memberRole === "trainer"
      ? getCurrentTrainerScope(params.tenantId)
      : Promise.resolve(null),
  ]);

  if (students.length === 0) {
    return [] satisfies StudentDirectoryRow[];
  }

  if (params.memberRole === "trainer" && trainerScope === null) {
    return [] satisfies StudentDirectoryRow[];
  }

  const authorizedStudentIds = students.map((student) => student.id);
  const enrollmentQuery = supabase
    .from("enrollments")
    .select("id,student_id,course_id,status,enrolled_at")
    .eq("tenant_id", params.tenantId)
    .in("student_id", authorizedStudentIds);

  const canViewPortalAccounts =
    params.memberRole === "owner" || params.memberRole === "admin";
  const [enrollmentsResult, portalAccountsResult] = await Promise.all([
    enrollmentQuery.order("enrolled_at", { ascending: false }),
    canViewPortalAccounts
      ? supabase
          .from("student_portal_accounts")
          .select("student_id,status")
          .eq("tenant_id", params.tenantId)
          .in("student_id", authorizedStudentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (enrollmentsResult.error) {
    throw enrollmentsResult.error;
  }

  if (portalAccountsResult.error) {
    throw portalAccountsResult.error;
  }

  const enrollments = (enrollmentsResult.data ?? []) as DirectoryEnrollmentRecord[];
  const courseIds = Array.from(
    new Set(enrollments.map((enrollment) => enrollment.course_id)),
  );
  const { data: coursesData, error: coursesError } = courseIds.length
    ? await supabase
        .from("courses")
        .select("id,title")
        .eq("tenant_id", params.tenantId)
        .in("id", courseIds)
    : { data: [], error: null };

  if (coursesError) {
    throw coursesError;
  }

  const courseTitleById = new Map(
    ((coursesData ?? []) as { id: string; title: string }[]).map((course) => [
      course.id,
      course.title,
    ]),
  );
  const enrollmentsByStudent = new Map<string, StudentDirectoryEnrollment[]>();

  for (const enrollment of enrollments) {
    const courseTitle = courseTitleById.get(enrollment.course_id);

    if (!courseTitle) {
      continue;
    }

    const current = enrollmentsByStudent.get(enrollment.student_id) ?? [];
    current.push({
      canOpenCourse:
        params.memberRole !== "trainer" ||
        Boolean(trainerScope?.courseIds.includes(enrollment.course_id)),
      courseId: enrollment.course_id,
      courseTitle,
      enrolledAt: enrollment.enrolled_at,
      id: enrollment.id,
      status: enrollment.status,
    });
    enrollmentsByStudent.set(enrollment.student_id, current);
  }

  const portalAccountByStudent = new Map(
    ((portalAccountsResult.data ?? []) as DirectoryPortalAccountRecord[]).map(
      (account) => [account.student_id, account.status],
    ),
  );

  return students.map((student) => ({
    enrollments: enrollmentsByStudent.get(student.id) ?? [],
    portalState: deriveStudentPortalState({
      canViewPortalAccounts,
      portalAccountStatus: portalAccountByStudent.get(student.id) ?? null,
      portalEnabled: student.portal_enabled,
      studentStatus: student.status,
    }),
    student,
  })) satisfies StudentDirectoryRow[];
}

export async function createStudent(input: StudentInput) {
  await enforceWorkspaceLimit(input.tenantId, "students");

  const supabase = getSupabaseClient();
  const fullName = input.fullName.trim();

  if (!fullName) {
    throw new Error("Full name is required.");
  }

  const { data, error } = await supabase
    .rpc("create_student_secure", {
      p_email: input.email,
      p_full_name: fullName,
      p_notes: input.notes,
      p_phone: input.phone,
      p_source: input.source,
      p_status: input.status,
      p_tenant_id: input.tenantId,
    })
    .single();

  if (error) {
    throw error;
  }

  const student = data as Student;

  await refreshWorkspaceUsageSnapshot(student.tenant_id);
  await runAutomationTrigger("student_created", {
    entityId: student.id,
    entityType: "student",
    metadata: {
      email: student.email,
      phone: student.phone,
      source: student.source,
      student_name: student.full_name,
    },
    tenantId: student.tenant_id,
  });

  return student;
}

export async function getStudentById(params: {
  studentId: string;
  tenantId: string;
}) {
  const trainerScope = await getCurrentTrainerScope(params.tenantId);

  if (trainerScope) {
    const visibleStudents = await getStudentsForTenant(params.tenantId);

    if (!visibleStudents.some((student) => student.id === params.studentId)) {
      return null;
    }
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("students")
    .select(
      "id,tenant_id,full_name,email,phone,status,source,notes,portal_enabled,created_by,created_at,updated_at",
    )
    .eq("tenant_id", params.tenantId)
    .eq("id", params.studentId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Student | null) ?? null;
}

export async function updateStudent(input: UpdateStudentInput) {
  const fullName = input.fullName.trim();

  if (!fullName) {
    throw new Error("Full name is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_student_secure", {
      p_email: input.email,
      p_full_name: fullName,
      p_notes: input.notes,
      p_phone: input.phone,
      p_source: input.source,
      p_status: input.status,
      p_student_id: input.studentId,
      p_tenant_id: input.tenantId,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as Student;
}

export async function deleteStudent(params: {
  studentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("delete_student_secure", {
    p_student_id: params.studentId,
    p_tenant_id: params.tenantId,
  });

  if (error) {
    throw error;
  }

  await refreshWorkspaceUsageSnapshot(params.tenantId);
}
