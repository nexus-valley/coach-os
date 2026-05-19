import { logActivity } from "@/src/lib/auditLogger";
import { requireTenantPermission } from "@/src/lib/permissions";
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
  await requireTenantPermission({
    description: "Blocked student creation without student management permission.",
    permission: "manage_students",
    tenantId: input.tenantId,
  });
  await enforceWorkspaceLimit(input.tenantId, "students");

  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("You must be logged in to add a student.");
  }

  const fullName = input.fullName.trim();

  if (!fullName) {
    throw new Error("Full name is required.");
  }

  const { data, error } = await supabase
    .from("students")
    .insert({
      created_by: user.id,
      email: input.email.trim() || null,
      full_name: fullName,
      notes: input.notes.trim() || null,
      phone: input.phone.trim() || null,
      source: input.source.trim() || null,
      status: input.status,
      tenant_id: input.tenantId,
    })
    .select(
      "id,tenant_id,full_name,email,phone,status,source,notes,created_by,created_at,updated_at",
    )
    .single();

  if (error) {
    throw error;
  }

  const student = data as Student;

  await logActivity({
    action: "student_created",
    description: "Created new student profile",
    entityId: student.id,
    entityName: student.full_name,
    entityType: "student",
    tenantId: student.tenant_id,
  });
  await refreshWorkspaceUsageSnapshot(student.tenant_id);

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
  await requireTenantPermission({
    description: "Blocked student update without student management permission.",
    permission: "manage_students",
    tenantId: input.tenantId,
  });

  const fullName = input.fullName.trim();

  if (!fullName) {
    throw new Error("Full name is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("students")
    .update({
      email: input.email.trim() || null,
      full_name: fullName,
      notes: input.notes.trim() || null,
      phone: input.phone.trim() || null,
      source: input.source.trim() || null,
      status: input.status,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.studentId)
    .select(
      "id,tenant_id,full_name,email,phone,status,source,notes,created_by,created_at,updated_at",
    )
    .single();

  if (error) {
    throw error;
  }

  const student = data as Student;

  await logActivity({
    action: "student_updated",
    description: "Updated student profile",
    entityId: student.id,
    entityName: student.full_name,
    entityType: "student",
    metadata: { status: student.status },
    tenantId: student.tenant_id,
  });

  return student;
}

export async function deleteStudent(params: {
  studentId: string;
  tenantId: string;
}) {
  await requireTenantPermission({
    description: "Blocked student deletion without delete permission.",
    permission: "delete_records",
    tenantId: params.tenantId,
  });

  const supabase = getSupabaseClient();
  const { data: existingStudent, error: existingError } = await supabase
    .from("students")
    .select("id,tenant_id,full_name,status")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.studentId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const { error } = await supabase
    .from("students")
    .delete()
    .eq("tenant_id", params.tenantId)
    .eq("id", params.studentId);

  if (error) {
    throw error;
  }

  if (existingStudent) {
    await logActivity({
      action: "student_deleted",
      description: "Deleted student profile",
      entityId: existingStudent.id,
      entityName: existingStudent.full_name,
      entityType: "student",
      metadata: { status: existingStudent.status },
      severity: "critical",
      tenantId: existingStudent.tenant_id,
    });
  }

  await refreshWorkspaceUsageSnapshot(params.tenantId);
}
