import { getSupabaseClient } from "@/src/lib/supabaseClient";
import type { MemberRole } from "@/src/lib/team";

export type TeamEmploymentType =
  | "consultant"
  | "contract"
  | "full_time"
  | "intern"
  | "part_time"
  | "visiting";

export type TeamEmploymentStatus =
  | "active"
  | "exited"
  | "on_leave"
  | "onboarding"
  | "suspended";

export type TeamWorkLocation = "hybrid" | "onsite" | "remote";

export type TeamMemberOperationsSummary = {
  active_members: number;
  exited_members: number;
  on_leave_members: number;
  onboarding_members: number;
  staff_admin_count: number;
  total_members: number;
  trainer_count: number;
};

export type TeamMemberOperationsRow = {
  active_students_count: number;
  assigned_cohorts_count: number;
  assigned_courses_count: number;
  department: string | null;
  designation: string | null;
  display_name: string | null;
  email: string | null;
  employment_status: TeamEmploymentStatus;
  employment_type: TeamEmploymentType | null;
  exit_date: string | null;
  full_name: string | null;
  joining_date: string | null;
  member_created_at: string;
  profile_id: string | null;
  profile_updated_at: string | null;
  role: MemberRole;
  staff_code: string | null;
  tenant_id: string;
  upcoming_sessions_count: number;
  user_id: string;
  work_location: TeamWorkLocation | null;
};

export type TeamOperationsDashboard = {
  members: TeamMemberOperationsRow[];
  summary: TeamMemberOperationsSummary;
};

export type TeamMemberOperationsDetail = {
  activity: Array<{
    action: string;
    actor_user_id: string | null;
    created_at: string;
    id: string;
    metadata_json: Record<string, unknown>;
  }>;
  cohorts: Array<{
    course_id: string;
    id: string;
    name: string;
  }>;
  courses: Array<{
    id: string;
    status: string | null;
    title: string;
  }>;
  member: {
    email: string | null;
    full_name: string | null;
    member_created_at: string;
    role: MemberRole;
    tenant_id: string;
    user_id: string;
  };
  notes: Array<{
    created_at: string;
    created_by: string;
    id: string;
    note: string;
    note_type: string;
  }>;
  profile: {
    created_at: string | null;
    department: string | null;
    designation: string | null;
    display_name: string | null;
    employment_status: TeamEmploymentStatus;
    employment_type: TeamEmploymentType | null;
    exit_date: string | null;
    id: string | null;
    joining_date: string | null;
    metadata_json: Record<string, unknown>;
    notes: string | null;
    staff_code: string | null;
    updated_at: string | null;
    work_location: TeamWorkLocation | null;
  };
  workload: {
    active_students_count: number;
    assigned_cohorts_count: number;
    assigned_courses_count: number;
    upcoming_sessions_count: number;
  };
};

export type TeamMemberProfileInput = {
  department: string;
  designation: string;
  displayName: string;
  employmentStatus: TeamEmploymentStatus;
  employmentType: TeamEmploymentType | "";
  exitDate: string;
  joiningDate: string;
  metadataJson?: Record<string, unknown>;
  notes: string;
  staffCode: string;
  tenantId: string;
  userId: string;
  workLocation: TeamWorkLocation | "";
};

export type TeamMemberNoteInput = {
  note: string;
  noteType: string;
  tenantId: string;
  userId: string;
};

const emptySummary: TeamMemberOperationsSummary = {
  active_members: 0,
  exited_members: 0,
  on_leave_members: 0,
  onboarding_members: 0,
  staff_admin_count: 0,
  total_members: 0,
  trainer_count: 0,
};

function normalizeDashboard(data: unknown): TeamOperationsDashboard {
  const payload = (data ?? {}) as Partial<TeamOperationsDashboard>;

  return {
    members: Array.isArray(payload.members) ? payload.members : [],
    summary: {
      ...emptySummary,
      ...(payload.summary ?? {}),
    },
  };
}

function normalizeDetail(data: unknown): TeamMemberOperationsDetail {
  const payload = data as TeamMemberOperationsDetail | null;

  if (!payload?.member) {
    throw new Error("Team member detail was not returned.");
  }

  const defaultProfile: TeamMemberOperationsDetail["profile"] = {
    created_at: null,
    department: null,
    designation: null,
    display_name: null,
    employment_status: "active",
    employment_type: null,
    exit_date: null,
    id: null,
    joining_date: null,
    metadata_json: {},
    notes: null,
    staff_code: null,
    updated_at: null,
    work_location: null,
  };
  const defaultWorkload: TeamMemberOperationsDetail["workload"] = {
    active_students_count: 0,
    assigned_cohorts_count: 0,
    assigned_courses_count: 0,
    upcoming_sessions_count: 0,
  };

  return {
    activity: Array.isArray(payload.activity) ? payload.activity : [],
    cohorts: Array.isArray(payload.cohorts) ? payload.cohorts : [],
    courses: Array.isArray(payload.courses) ? payload.courses : [],
    member: payload.member,
    notes: Array.isArray(payload.notes) ? payload.notes : [],
    profile: { ...defaultProfile, ...(payload.profile ?? {}) },
    workload: { ...defaultWorkload, ...(payload.workload ?? {}) },
  };
}

export function formatTeamOpsLabel(value: string | null | undefined) {
  if (!value) return "Not set";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatTeamOpsDate(value: string | null | undefined) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export async function getTeamOperationsDashboard(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_team_operations_dashboard", {
    p_tenant_id: tenantId,
  });

  if (error) throw error;
  return normalizeDashboard(data);
}

export async function getTeamMemberOperationsDetail(input: {
  tenantId: string;
  userId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_team_member_operations_detail",
    {
      p_tenant_id: input.tenantId,
      p_user_id: input.userId,
    },
  );

  if (error) throw error;
  return normalizeDetail(data);
}

export async function upsertTeamMemberProfile(input: TeamMemberProfileInput) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("upsert_team_member_profile", {
    p_department: input.department || null,
    p_designation: input.designation || null,
    p_display_name: input.displayName || null,
    p_employment_status: input.employmentStatus,
    p_employment_type: input.employmentType || null,
    p_exit_date: input.exitDate || null,
    p_joining_date: input.joiningDate || null,
    p_metadata_json: input.metadataJson ?? {},
    p_notes: input.notes || null,
    p_staff_code: input.staffCode || null,
    p_tenant_id: input.tenantId,
    p_user_id: input.userId,
    p_work_location: input.workLocation || null,
  });

  if (error) throw error;
  return data as string;
}

export async function updateTeamMemberStatus(input: {
  employmentStatus: TeamEmploymentStatus;
  exitDate: string;
  tenantId: string;
  userId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_team_member_status", {
    p_employment_status: input.employmentStatus,
    p_exit_date: input.exitDate || null,
    p_tenant_id: input.tenantId,
    p_user_id: input.userId,
  });

  if (error) throw error;
  return data as string;
}

export async function addTeamMemberNote(input: TeamMemberNoteInput) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("add_team_member_note", {
    p_note: input.note,
    p_note_type: input.noteType,
    p_tenant_id: input.tenantId,
    p_user_id: input.userId,
  });

  if (error) throw error;
  return data as string;
}
