import { getSupabaseClient } from "@/src/lib/supabaseClient";
import type { CrmLead } from "@/src/lib/crm";

export type MarketingAssignedRole = "admin" | "owner" | "staff" | "trainer";
export type MarketingCampaignType =
  | "admission_drive"
  | "announcement"
  | "course_launch"
  | "lead_nurture"
  | "other"
  | "reactivation"
  | "referral"
  | "webinar";
export type MarketingChannel =
  | "email"
  | "in_app"
  | "manual"
  | "mixed"
  | "other"
  | "phone"
  | "sms"
  | "whatsapp";
export type MarketingTemplateChannel = Exclude<MarketingChannel, "mixed">;
export type MarketingCampaignStatus =
  | "active"
  | "archived"
  | "completed"
  | "draft"
  | "paused"
  | "planned";
export type MarketingCampaignLeadStatus =
  | "added"
  | "contacted"
  | "converted"
  | "interested"
  | "not_interested"
  | "removed"
  | "responded";
export type MarketingTemplateStatus = "active" | "archived" | "draft";
export type MarketingTemplateType =
  | "announcement"
  | "course_launch"
  | "follow_up"
  | "lead_nurture"
  | "other"
  | "referral"
  | "reminder"
  | "webinar_invite";

export type MarketingCampaign = {
  assigned_role: MarketingAssignedRole | null;
  assigned_to: string | null;
  budget: number | null;
  campaign_type: MarketingCampaignType;
  channel: MarketingChannel;
  created_at: string;
  created_by: string | null;
  description: string | null;
  end_at: string | null;
  goal: string | null;
  id: string;
  metadata_json: Record<string, unknown>;
  name: string;
  start_at: string | null;
  status: MarketingCampaignStatus;
  tenant_id: string;
  updated_at: string;
  updated_by: string | null;
};

export type MarketingTemplate = {
  body: string;
  channel: MarketingTemplateChannel;
  created_at: string;
  created_by: string | null;
  id: string;
  metadata_json: Record<string, unknown>;
  name: string;
  status: MarketingTemplateStatus;
  subject: string | null;
  template_type: MarketingTemplateType;
  tenant_id: string;
  updated_at: string;
  updated_by: string | null;
};

export type MarketingCampaignLead = {
  campaign_id: string;
  created_at: string;
  id: string;
  last_touch_at: string | null;
  lead_id: string;
  metadata_json: Record<string, unknown>;
  next_touch_at: string | null;
  status: MarketingCampaignLeadStatus;
  tenant_id: string;
  updated_at: string;
};

export type MarketingActivity = {
  activity_type: string;
  actor_id: string | null;
  campaign_id: string | null;
  channel: MarketingChannel | null;
  created_at: string;
  id: string;
  lead_id: string | null;
  metadata_json: Record<string, unknown>;
  note: string | null;
  template_id: string | null;
  tenant_id: string;
};

export type MarketingCenterData = {
  activities: MarketingActivity[];
  campaignLeads: MarketingCampaignLead[];
  campaigns: MarketingCampaign[];
  crmLeads: CrmLead[];
  templates: MarketingTemplate[];
};

export const marketingCampaignTypes: MarketingCampaignType[] = [
  "lead_nurture",
  "admission_drive",
  "webinar",
  "course_launch",
  "reactivation",
  "announcement",
  "referral",
  "other",
];

export const marketingChannels: MarketingChannel[] = [
  "manual",
  "whatsapp",
  "email",
  "sms",
  "phone",
  "in_app",
  "mixed",
  "other",
];

export const marketingTemplateChannels: MarketingTemplateChannel[] = [
  "manual",
  "whatsapp",
  "email",
  "sms",
  "phone",
  "in_app",
  "other",
];

export const marketingCampaignStatuses: MarketingCampaignStatus[] = [
  "draft",
  "planned",
  "active",
  "paused",
  "completed",
  "archived",
];

export const marketingCampaignLeadStatuses: MarketingCampaignLeadStatus[] = [
  "added",
  "contacted",
  "responded",
  "interested",
  "not_interested",
  "converted",
  "removed",
];

export const marketingTemplateStatuses: MarketingTemplateStatus[] = [
  "draft",
  "active",
  "archived",
];

export const marketingTemplateTypes: MarketingTemplateType[] = [
  "lead_nurture",
  "follow_up",
  "webinar_invite",
  "course_launch",
  "reminder",
  "announcement",
  "referral",
  "other",
];

export const marketingAssignedRoles: MarketingAssignedRole[] = [
  "owner",
  "admin",
  "staff",
  "trainer",
];

const campaignSelect =
  "id,tenant_id,created_by,updated_by,assigned_to,assigned_role,name,description,campaign_type,channel,status,goal,start_at,end_at,budget,metadata_json,created_at,updated_at";
const templateSelect =
  "id,tenant_id,created_by,updated_by,name,channel,template_type,subject,body,status,metadata_json,created_at,updated_at";
const campaignLeadSelect =
  "id,tenant_id,campaign_id,lead_id,status,last_touch_at,next_touch_at,metadata_json,created_at,updated_at";
const activitySelect =
  "id,tenant_id,campaign_id,lead_id,template_id,actor_id,activity_type,channel,note,metadata_json,created_at";
const crmLeadSelect =
  "id,tenant_id,public_site_lead_id,created_by,updated_by,assigned_to,assigned_role,name,email,phone,source,status,priority,interested_course_id,lead_value,last_contacted_at,next_follow_up_at,converted_student_id,lost_reason,tags,metadata_json,created_at,updated_at";

export async function getMarketingCenterData(
  tenantId: string,
): Promise<MarketingCenterData> {
  const supabase = getSupabaseClient();
  const [campaignsResult, templatesResult, campaignLeadsResult, activitiesResult, crmLeadsResult] =
    await Promise.all([
      supabase
        .from("marketing_campaigns")
        .select(campaignSelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(120),
      supabase
        .from("marketing_message_templates")
        .select(templateSelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(120),
      supabase
        .from("marketing_campaign_leads")
        .select(campaignLeadSelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(250),
      supabase
        .from("marketing_campaign_activities")
        .select(activitySelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(150),
      supabase
        .from("crm_leads")
        .select(crmLeadSelect)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(150),
    ]);

  if (campaignsResult.error) throw campaignsResult.error;
  if (templatesResult.error) throw templatesResult.error;
  if (campaignLeadsResult.error) throw campaignLeadsResult.error;
  if (activitiesResult.error) throw activitiesResult.error;
  if (crmLeadsResult.error) throw crmLeadsResult.error;

  return {
    activities: (activitiesResult.data ?? []) as MarketingActivity[],
    campaignLeads: (campaignLeadsResult.data ?? []) as MarketingCampaignLead[],
    campaigns: (campaignsResult.data ?? []) as MarketingCampaign[],
    crmLeads: (crmLeadsResult.data ?? []) as CrmLead[],
    templates: (templatesResult.data ?? []) as MarketingTemplate[],
  };
}

export async function createMarketingCampaign(payload: {
  assignedRole?: MarketingAssignedRole | null;
  assignedTo?: string | null;
  budget?: number | null;
  campaignType: MarketingCampaignType;
  channel: MarketingChannel;
  description?: string | null;
  endAt?: string | null;
  goal?: string | null;
  metadataJson?: Record<string, unknown>;
  name: string;
  startAt?: string | null;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_marketing_campaign", {
    p_assigned_role: payload.assignedRole ?? null,
    p_assigned_to: payload.assignedTo ?? null,
    p_budget: payload.budget ?? null,
    p_campaign_type: payload.campaignType,
    p_channel: payload.channel,
    p_description: payload.description ?? null,
    p_end_at: payload.endAt || null,
    p_goal: payload.goal ?? null,
    p_metadata_json: payload.metadataJson ?? {},
    p_name: payload.name,
    p_start_at: payload.startAt || null,
    p_tenant_id: payload.tenantId,
  });

  if (error) throw error;
  return data as string;
}

export async function updateMarketingCampaign(payload: {
  assignedRole?: MarketingAssignedRole | null;
  assignedTo?: string | null;
  budget?: number | null;
  campaignId: string;
  campaignType?: MarketingCampaignType | null;
  channel?: MarketingChannel | null;
  description?: string | null;
  endAt?: string | null;
  goal?: string | null;
  metadataJson?: Record<string, unknown> | null;
  name?: string | null;
  startAt?: string | null;
  status?: MarketingCampaignStatus | null;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_marketing_campaign", {
    p_assigned_role: payload.assignedRole ?? null,
    p_assigned_to: payload.assignedTo ?? null,
    p_budget: payload.budget ?? null,
    p_campaign_id: payload.campaignId,
    p_campaign_type: payload.campaignType ?? null,
    p_channel: payload.channel ?? null,
    p_description: payload.description ?? null,
    p_end_at: payload.endAt || null,
    p_goal: payload.goal ?? null,
    p_metadata_json: payload.metadataJson ?? null,
    p_name: payload.name ?? null,
    p_start_at: payload.startAt || null,
    p_status: payload.status ?? null,
  });

  if (error) throw error;
  return data as string;
}

export async function createMarketingTemplate(payload: {
  body: string;
  channel: MarketingTemplateChannel;
  metadataJson?: Record<string, unknown>;
  name: string;
  status: MarketingTemplateStatus;
  subject?: string | null;
  templateType: MarketingTemplateType;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_marketing_template", {
    p_body: payload.body,
    p_channel: payload.channel,
    p_metadata_json: payload.metadataJson ?? {},
    p_name: payload.name,
    p_status: payload.status,
    p_subject: payload.subject ?? null,
    p_template_type: payload.templateType,
    p_tenant_id: payload.tenantId,
  });

  if (error) throw error;
  return data as string;
}

export async function updateMarketingTemplate(payload: {
  body?: string | null;
  channel?: MarketingTemplateChannel | null;
  metadataJson?: Record<string, unknown> | null;
  name?: string | null;
  status?: MarketingTemplateStatus | null;
  subject?: string | null;
  templateId: string;
  templateType?: MarketingTemplateType | null;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_marketing_template", {
    p_body: payload.body ?? null,
    p_channel: payload.channel ?? null,
    p_metadata_json: payload.metadataJson ?? null,
    p_name: payload.name ?? null,
    p_status: payload.status ?? null,
    p_subject: payload.subject ?? null,
    p_template_id: payload.templateId,
    p_template_type: payload.templateType ?? null,
  });

  if (error) throw error;
  return data as string;
}

export async function addLeadsToMarketingCampaign(payload: {
  campaignId: string;
  leadIds: string[];
  metadataJson?: Record<string, unknown>;
  nextTouchAt?: string | null;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("add_leads_to_marketing_campaign", {
    p_campaign_id: payload.campaignId,
    p_lead_ids: payload.leadIds,
    p_metadata_json: payload.metadataJson ?? {},
    p_next_touch_at: payload.nextTouchAt || null,
  });

  if (error) throw error;
  return data as number;
}

export async function updateMarketingCampaignLead(payload: {
  campaignLeadId: string;
  lastTouchAt?: string | null;
  metadataJson?: Record<string, unknown> | null;
  nextTouchAt?: string | null;
  status?: MarketingCampaignLeadStatus | null;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_marketing_campaign_lead", {
    p_campaign_lead_id: payload.campaignLeadId,
    p_last_touch_at: payload.lastTouchAt || null,
    p_metadata_json: payload.metadataJson ?? null,
    p_next_touch_at: payload.nextTouchAt || null,
    p_status: payload.status ?? null,
  });

  if (error) throw error;
  return data as string;
}

export async function logMarketingTouch(payload: {
  campaignId: string;
  channel: MarketingChannel;
  leadId: string;
  metadataJson?: Record<string, unknown>;
  note?: string | null;
  templateId?: string | null;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("log_marketing_touch", {
    p_campaign_id: payload.campaignId,
    p_channel: payload.channel,
    p_lead_id: payload.leadId,
    p_metadata_json: payload.metadataJson ?? {},
    p_note: payload.note ?? null,
    p_template_id: payload.templateId ?? null,
  });

  if (error) throw error;
  return data as string;
}
