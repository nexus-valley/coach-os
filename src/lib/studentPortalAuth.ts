import type { Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import type { Tenant } from "@/src/lib/tenant";

export type StudentPortalAccount = {
  created_at: string;
  email: string;
  id: string;
  last_login_at: string | null;
  linked_at: string;
  linked_by: string | null;
  metadata_json: Record<string, unknown>;
  status: "active" | "pending" | "revoked";
  student_id: string;
  tenant_id: string;
  updated_at: string;
  user_id: string;
};

export type StudentPortalContext = {
  account: StudentPortalAccount;
  student: Student;
  tenant: Tenant;
};

const portalAccountSelect =
  "id,tenant_id,student_id,user_id,email,status,linked_by,linked_at,last_login_at,metadata_json,created_at,updated_at";
const studentSelect =
  "id,tenant_id,full_name,email,phone,status,source,notes,created_by,created_at,updated_at";
const tenantSelect = "id,name,slug,category,owner_user_id";

function isSchemaMissing(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST200" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

export async function getCurrentStudentPortalContext() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    return null;
  }

  const accountResult = await supabase
    .from("student_portal_accounts")
    .select(portalAccountSelect)
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("linked_at", { ascending: true })
    .limit(1)
    .maybeSingle<StudentPortalAccount>();

  if (accountResult.error) {
    if (isSchemaMissing(accountResult.error)) {
      return null;
    }

    throw accountResult.error;
  }

  if (!accountResult.data) {
    return null;
  }

  const [studentResult, tenantResult] = await Promise.all([
    supabase
      .from("students")
      .select(studentSelect)
      .eq("tenant_id", accountResult.data.tenant_id)
      .eq("id", accountResult.data.student_id)
      .maybeSingle<Student>(),
    supabase
      .from("tenants")
      .select(tenantSelect)
      .eq("id", accountResult.data.tenant_id)
      .maybeSingle<Tenant>(),
  ]);

  if (studentResult.error) {
    throw studentResult.error;
  }

  if (tenantResult.error) {
    throw tenantResult.error;
  }

  if (!studentResult.data || !tenantResult.data) {
    return null;
  }

  return {
    account: accountResult.data,
    student: studentResult.data,
    tenant: tenantResult.data,
  } satisfies StudentPortalContext;
}

export async function hasCurrentStudentPortalAccess() {
  return Boolean(await getCurrentStudentPortalContext());
}
