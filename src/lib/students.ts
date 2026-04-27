import { getSupabaseClient } from "@/src/lib/supabaseClient";

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
  const { data, error } = await supabase
    .from("students")
    .select(
      "id,tenant_id,full_name,email,phone,status,source,notes,created_by,created_at,updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Student[];
}

export async function createStudent(input: StudentInput) {
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

  return data as Student;
}

export async function getStudentById(params: {
  studentId: string;
  tenantId: string;
}) {
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

  return data as Student;
}

export async function deleteStudent(params: {
  studentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("students")
    .delete()
    .eq("tenant_id", params.tenantId)
    .eq("id", params.studentId);

  if (error) {
    throw error;
  }
}
