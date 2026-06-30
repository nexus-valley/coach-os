import { runAutomationTrigger } from "@/src/lib/automationTriggers";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentTrainerScope } from "@/src/lib/trainerAssignments";
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
  const trainerScope = await getCurrentTrainerScope(tenantId);
  let scopedStudentIds: string[] | null = null;

  if (trainerScope) {
    const [enrollmentsResult, cohortMembersResult] = await Promise.all([
      trainerScope.courseIds.length
        ? supabase
            .from("enrollments")
            .select("student_id")
            .eq("tenant_id", tenantId)
            .in("course_id", trainerScope.courseIds)
        : Promise.resolve({ data: [], error: null }),
      trainerScope.cohortIds.length
        ? supabase
            .from("cohort_members")
            .select("student_id")
            .eq("tenant_id", tenantId)
            .in("cohort_id", trainerScope.cohortIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (enrollmentsResult.error) {
      throw enrollmentsResult.error;
    }

    if (cohortMembersResult.error) {
      throw cohortMembersResult.error;
    }

    scopedStudentIds = Array.from(
      new Set([
        ...((enrollmentsResult.data ?? []) as { student_id: string }[]).map(
          (item) => item.student_id,
        ),
        ...((cohortMembersResult.data ?? []) as { student_id: string }[]).map(
          (item) => item.student_id,
        ),
      ]),
    );

    if (scopedStudentIds.length === 0) {
      return [];
    }
  }

  let query = supabase
    .from("students")
    .select(
      "id,tenant_id,full_name,email,phone,status,source,notes,created_by,created_at,updated_at",
    )
    .eq("tenant_id", tenantId);

  if (scopedStudentIds) {
    query = query.in("id", scopedStudentIds);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Student[];
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
      "id,tenant_id,full_name,email,phone,status,source,notes,created_by,created_at,updated_at",
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
