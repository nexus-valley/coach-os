import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type CrmAssignedRole = "admin" | "owner" | "staff" | "trainer";
export type CrmLeadSource =
  | "campaign"
  | "import"
  | "manual"
  | "other"
  | "phone"
  | "public_site"
  | "referral"
  | "walk_in"
  | "whatsapp";
export type CrmLeadStatus =
  | "archived"
  | "contacted"
  | "converted"
  | "demo_scheduled"
  | "follow_up"
  | "lost"
  | "new"
  | "proposal_sent"
  | "qualified";
export type CrmNoteType =
  | "call"
  | "demo"
  | "email"
  | "meeting"
  | "note"
  | "system"
  | "whatsapp";
export type CrmPriority = "high" | "low" | "normal" | "urgent";
export type CrmTaskStatus = "cancelled" | "completed" | "in_progress" | "pending";

export type CrmLead = {
  assigned_role: CrmAssignedRole | null;
  assigned_to: string | null;
  converted_student_id: string | null;
  created_at: string;
  created_by: string | null;
  email: string | null;
  id: string;
  interested_course_id: string | null;
  last_contacted_at: string | null;
  lead_value: number | null;
  lost_reason: string | null;
  metadata_json: Record<string, unknown>;
  name: string;
  next_follow_up_at: string | null;
  phone: string | null;
  priority: CrmPriority;
  public_site_lead_id: string | null;
  source: CrmLeadSource;
  status: CrmLeadStatus;
  tags: string[];
  tenant_id: string;
  updated_at: string;
  updated_by: string | null;
};

export type CrmLeadNote = {
  created_at: string;
  created_by: string | null;
  id: string;
  is_private: boolean;
  lead_id: string;
  metadata_json: Record<string, unknown>;
  note: string;
  note_type: CrmNoteType;
  tenant_id: string;
};

export type CrmFollowUpTask = {
  assigned_role: CrmAssignedRole | null;
  assigned_to: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  created_by: string | null;
  description: string | null;
  due_at: string | null;
  id: string;
  lead_id: string;
  metadata_json: Record<string, unknown>;
  status: CrmTaskStatus;
  tenant_id: string;
  title: string;
  updated_at: string;
};

export type CrmActivityLog = {
  action: string;
  actor_id: string | null;
  created_at: string;
  id: string;
  lead_id: string | null;
  metadata_json: Record<string, unknown>;
  tenant_id: string;
};

export type PublicSiteLeadForCrm = {
  created_at: string;
  email: string | null;
  id: string;
  interested_course_id: string | null;
  message: string | null;
  name: string;
  phone: string | null;
  status: string;
  tenant_id: string;
};

export type CrmDashboardData = {
  activityLogs: CrmActivityLog[];
  followUpTasks: CrmFollowUpTask[];
  leads: CrmLead[];
  notes: CrmLeadNote[];
  publicSiteLeads: PublicSiteLeadForCrm[];
};

export const crmLeadSources: CrmLeadSource[] = [
  "manual",
  "public_site",
  "referral",
  "whatsapp",
  "phone",
  "walk_in",
  "campaign",
  "import",
  "other",
];

export const crmLeadStatuses: CrmLeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "demo_scheduled",
  "proposal_sent",
  "follow_up",
  "converted",
  "lost",
  "archived",
];

export const crmPriorities: CrmPriority[] = ["low", "normal", "high", "urgent"];

export const crmAssignedRoles: CrmAssignedRole[] = [
  "owner",
  "admin",
  "staff",
  "trainer",
];

export const crmNoteTypes: CrmNoteType[] = [
  "note",
  "call",
  "whatsapp",
  "email",
  "meeting",
  "demo",
];

const leadSelect =
  "id,tenant_id,public_site_lead_id,created_by,updated_by,assigned_to,assigned_role,name,email,phone,source,status,priority,interested_course_id,lead_value,last_contacted_at,next_follow_up_at,converted_student_id,lost_reason,tags,metadata_json,created_at,updated_at";
const noteSelect =
  "id,tenant_id,lead_id,created_by,note_type,note,is_private,metadata_json,created_at";
const taskSelect =
  "id,tenant_id,lead_id,created_by,assigned_to,assigned_role,title,description,status,due_at,completed_by,completed_at,metadata_json,created_at,updated_at";
const activitySelect =
  "id,tenant_id,lead_id,actor_id,action,metadata_json,created_at";
const publicSiteLeadSelect =
  "id,tenant_id,name,email,phone,message,interested_course_id,status,created_at";

export async function getCrmDashboardData(
  tenantId: string,
): Promise<CrmDashboardData> {
  const supabase = getSupabaseClient();
  const [leadsResult, notesResult, tasksResult, activityResult, publicLeadResult] =
    await Promise.all([
      supabase
        .from("crm_leads")
        .select(leadSelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(150),
      supabase
        .from("crm_lead_notes")
        .select(noteSelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("crm_follow_up_tasks")
        .select(taskSelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("crm_activity_logs")
        .select(activitySelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("public_site_leads")
        .select(publicSiteLeadSelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

  if (leadsResult.error) {
    throw leadsResult.error;
  }

  if (notesResult.error) {
    throw notesResult.error;
  }

  if (tasksResult.error) {
    throw tasksResult.error;
  }

  if (activityResult.error) {
    throw activityResult.error;
  }

  return {
    activityLogs: (activityResult.data ?? []) as CrmActivityLog[],
    followUpTasks: (tasksResult.data ?? []) as CrmFollowUpTask[],
    leads: (leadsResult.data ?? []) as CrmLead[],
    notes: (notesResult.data ?? []) as CrmLeadNote[],
    publicSiteLeads: publicLeadResult.error
      ? []
      : ((publicLeadResult.data ?? []) as PublicSiteLeadForCrm[]),
  };
}

export async function createCrmLead(payload: {
  assignedRole?: CrmAssignedRole | null;
  assignedTo?: string | null;
  email?: string | null;
  interestedCourseId?: string | null;
  metadataJson?: Record<string, unknown>;
  name: string;
  phone?: string | null;
  priority: CrmPriority;
  source: CrmLeadSource;
  tags?: string[];
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_crm_lead", {
    p_assigned_role: payload.assignedRole ?? null,
    p_assigned_to: payload.assignedTo ?? null,
    p_email: payload.email ?? null,
    p_interested_course_id: payload.interestedCourseId ?? null,
    p_metadata_json: payload.metadataJson ?? {},
    p_name: payload.name,
    p_phone: payload.phone ?? null,
    p_priority: payload.priority,
    p_source: payload.source,
    p_tags: payload.tags ?? [],
    p_tenant_id: payload.tenantId,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function importPublicSiteLeadToCrm(payload: {
  assignedRole?: CrmAssignedRole | null;
  assignedTo?: string | null;
  priority: CrmPriority;
  publicSiteLeadId: string;
  tags?: string[];
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "create_crm_lead_from_public_site_lead",
    {
      p_assigned_role: payload.assignedRole ?? null,
      p_assigned_to: payload.assignedTo ?? null,
      p_priority: payload.priority,
      p_public_site_lead_id: payload.publicSiteLeadId,
      p_tags: payload.tags ?? [],
    },
  );

  if (error) {
    throw error;
  }

  return data as string;
}

export async function updateCrmLead(payload: {
  assignedRole?: CrmAssignedRole | null;
  assignedTo?: string | null;
  interestedCourseId?: string | null;
  leadId: string;
  lostReason?: string | null;
  metadataJson?: Record<string, unknown> | null;
  nextFollowUpAt?: string | null;
  priority?: CrmPriority | null;
  status?: CrmLeadStatus | null;
  tags?: string[] | null;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_crm_lead", {
    p_assigned_role: payload.assignedRole ?? null,
    p_assigned_to: payload.assignedTo ?? null,
    p_interested_course_id: payload.interestedCourseId ?? null,
    p_lead_id: payload.leadId,
    p_lost_reason: payload.lostReason ?? null,
    p_metadata_json: payload.metadataJson ?? null,
    p_next_follow_up_at: payload.nextFollowUpAt || null,
    p_priority: payload.priority ?? null,
    p_status: payload.status ?? null,
    p_tags: payload.tags ?? null,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function addCrmLeadNote(payload: {
  isPrivate: boolean;
  leadId: string;
  metadataJson?: Record<string, unknown>;
  note: string;
  noteType: CrmNoteType;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("add_crm_lead_note", {
    p_is_private: payload.isPrivate,
    p_lead_id: payload.leadId,
    p_metadata_json: payload.metadataJson ?? {},
    p_note: payload.note,
    p_note_type: payload.noteType,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function createCrmFollowUpTask(payload: {
  assignedRole?: CrmAssignedRole | null;
  assignedTo?: string | null;
  description?: string | null;
  dueAt?: string | null;
  leadId: string;
  metadataJson?: Record<string, unknown>;
  title: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_crm_follow_up_task", {
    p_assigned_role: payload.assignedRole ?? null,
    p_assigned_to: payload.assignedTo ?? null,
    p_description: payload.description ?? null,
    p_due_at: payload.dueAt || null,
    p_lead_id: payload.leadId,
    p_metadata_json: payload.metadataJson ?? {},
    p_title: payload.title,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function updateCrmFollowUpTask(payload: {
  description?: string | null;
  dueAt?: string | null;
  metadataJson?: Record<string, unknown> | null;
  status?: CrmTaskStatus | null;
  taskId: string;
  title?: string | null;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_crm_follow_up_task", {
    p_description: payload.description ?? null,
    p_due_at: payload.dueAt || null,
    p_metadata_json: payload.metadataJson ?? null,
    p_status: payload.status ?? null,
    p_task_id: payload.taskId,
    p_title: payload.title ?? null,
  });

  if (error) {
    throw error;
  }

  return data as string;
}
