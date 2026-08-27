import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type AcademyAnnouncementStatus = "archived" | "draft" | "published";

export type AcademyAnnouncement = {
  archived_at: string | null;
  audience_type: "all_students";
  body: string;
  created_at: string;
  created_by?: string | null;
  expires_at: string | null;
  id: string;
  published_at: string | null;
  status: AcademyAnnouncementStatus;
  tenant_id: string;
  title: string;
  updated_at: string;
};

export type StudentAnnouncement = Omit<AcademyAnnouncement, "created_by">;

export type AnnouncementAudience = "cohort" | "program" | "tenant";

export type StudentAnnouncementAttentionState = "read" | "unread" | null;

export type StudentAnnouncementSummary = {
  attention_state: StudentAnnouncementAttentionState;
  audience_type: AnnouncementAudience;
  body: string;
  cohort_id: string | null;
  cohort_name: string | null;
  course_id: string | null;
  course_title: string | null;
  expires_at: string | null;
  id: string;
  notification_id: string | null;
  published_at: string;
  title: string;
  updated_at: string;
};

export type StudentAnnouncementCursor = {
  id: string;
  publishedAt: string;
};

export type StudentAnnouncementListInput = {
  cursor?: StudentAnnouncementCursor | null;
  limit?: number;
};

export type TeamAnnouncementSummary = {
  archived_at: string | null;
  audience_type: AnnouncementAudience;
  body_preview: string;
  cohort_id: string | null;
  cohort_name: string | null;
  course_id: string | null;
  course_title: string | null;
  created_at: string;
  expires_at: string | null;
  id: string;
  in_app_recipient_count: number;
  published_at: string | null;
  read_count: number;
  status: AcademyAnnouncementStatus;
  title: string;
  unread_count: number;
  updated_at: string;
};

export type TeamAnnouncementDetail = Omit<
  TeamAnnouncementSummary,
  "body_preview"
> & {
  body: string;
};

export type TeamAnnouncementCursor = {
  id: string;
  updatedAt: string;
};

export type TeamAnnouncementListInput = {
  audienceType?: AnnouncementAudience | null;
  cursor?: TeamAnnouncementCursor | null;
  limit?: number;
  status?: AcademyAnnouncementStatus | null;
  tenantId: string;
};

export type AnnouncementWriteInput = {
  audienceType: AnnouncementAudience;
  body: string;
  cohortId: string | null;
  courseId: string | null;
  expiresAt: string | null;
  title: string;
};

function normalizeAnnouncement(data: unknown) {
  if (Array.isArray(data)) {
    const [first] = data;

    if (!first) {
      throw new Error("Announcement was not returned.");
    }

    return first as AcademyAnnouncement;
  }

  if (!data || typeof data !== "object") {
    throw new Error("Announcement was not returned.");
  }

  return data as AcademyAnnouncement;
}

function normalizeAnnouncementList<TAnnouncement>(data: unknown) {
  return Array.isArray(data) ? (data as TAnnouncement[]) : [];
}

function normalizeTeamAnnouncement(data: unknown) {
  if (Array.isArray(data)) {
    return (data[0] as TeamAnnouncementDetail | undefined) ?? null;
  }

  return data && typeof data === "object"
    ? (data as TeamAnnouncementDetail)
    : null;
}

function normalizeStudentAnnouncement(data: unknown) {
  if (Array.isArray(data)) {
    return (data[0] as StudentAnnouncementSummary | undefined) ?? null;
  }

  return data && typeof data === "object"
    ? (data as StudentAnnouncementSummary)
    : null;
}

export function formatAnnouncementDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export async function getStudentAnnouncements() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_student_announcements");

  if (error) {
    throw error;
  }

  return normalizeAnnouncementList<StudentAnnouncement>(data);
}

export async function getStudentAnnouncementsV2({
  cursor = null,
  limit = 25,
}: StudentAnnouncementListInput = {}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_student_announcements_v2", {
    p_cursor_id: cursor?.id ?? null,
    p_cursor_published_at: cursor?.publishedAt ?? null,
    p_limit: limit,
  });

  if (error) {
    throw error;
  }

  return normalizeAnnouncementList<StudentAnnouncementSummary>(data);
}

export async function getStudentAnnouncementV2(announcementId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_student_announcement_v2", {
    p_announcement_id: announcementId,
  });

  if (error) {
    throw error;
  }

  return normalizeStudentAnnouncement(data);
}

export async function getTeamAnnouncements(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_team_announcements", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

  return normalizeAnnouncementList<AcademyAnnouncement>(data);
}

export async function createAcademyAnnouncement(
  tenantId: string,
  title: string,
  body: string,
  expiresAt?: string | null,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_academy_announcement", {
    p_body: body,
    p_expires_at: expiresAt ?? null,
    p_tenant_id: tenantId,
    p_title: title,
  });

  if (error) {
    throw error;
  }

  return normalizeAnnouncement(data);
}

export async function updateAcademyAnnouncement(
  announcementId: string,
  title: string,
  body: string,
  expiresAt?: string | null,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_academy_announcement", {
    p_announcement_id: announcementId,
    p_body: body,
    p_expires_at: expiresAt ?? null,
    p_title: title,
  });

  if (error) {
    throw error;
  }

  return normalizeAnnouncement(data);
}

export async function publishAcademyAnnouncement(announcementId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("publish_academy_announcement", {
    p_announcement_id: announcementId,
  });

  if (error) {
    throw error;
  }

  return normalizeAnnouncement(data);
}

export async function archiveAcademyAnnouncement(announcementId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("archive_academy_announcement", {
    p_announcement_id: announcementId,
  });

  if (error) {
    throw error;
  }

  return normalizeAnnouncement(data);
}

export async function getTeamAnnouncementsV2({
  audienceType = null,
  cursor = null,
  limit = 25,
  status = null,
  tenantId,
}: TeamAnnouncementListInput) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_team_announcements_v2", {
    p_audience_type: audienceType,
    p_cursor_id: cursor?.id ?? null,
    p_cursor_updated_at: cursor?.updatedAt ?? null,
    p_limit: limit,
    p_status: status,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

  return normalizeAnnouncementList<TeamAnnouncementSummary>(data);
}

export async function getTeamAnnouncementV2(
  tenantId: string,
  announcementId: string,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_team_announcement_v2", {
    p_announcement_id: announcementId,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

  return normalizeTeamAnnouncement(data);
}

export async function createAcademyAnnouncementV2(
  tenantId: string,
  input: AnnouncementWriteInput,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_academy_announcement_v2", {
    p_audience_type: input.audienceType,
    p_body: input.body,
    p_cohort_id: input.cohortId,
    p_course_id: input.courseId,
    p_expires_at: input.expiresAt,
    p_tenant_id: tenantId,
    p_title: input.title,
  });

  if (error) {
    throw error;
  }

  return normalizeAnnouncement(data);
}

export async function updateAcademyAnnouncementV2(
  announcementId: string,
  input: AnnouncementWriteInput,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_academy_announcement_v2", {
    p_announcement_id: announcementId,
    p_audience_type: input.audienceType,
    p_body: input.body,
    p_cohort_id: input.cohortId,
    p_course_id: input.courseId,
    p_expires_at: input.expiresAt,
    p_title: input.title,
  });

  if (error) {
    throw error;
  }

  return normalizeAnnouncement(data);
}

async function runAnnouncementLifecycleRpc(
  rpc:
    | "archive_academy_announcement_v2"
    | "delete_draft_academy_announcement_v2"
    | "publish_academy_announcement_v2",
  announcementId: string,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(rpc, {
    p_announcement_id: announcementId,
  });

  if (error) {
    throw error;
  }

  return normalizeAnnouncement(data);
}

export function publishAcademyAnnouncementV2(announcementId: string) {
  return runAnnouncementLifecycleRpc(
    "publish_academy_announcement_v2",
    announcementId,
  );
}

export function archiveAcademyAnnouncementV2(announcementId: string) {
  return runAnnouncementLifecycleRpc(
    "archive_academy_announcement_v2",
    announcementId,
  );
}

export function deleteDraftAcademyAnnouncementV2(announcementId: string) {
  return runAnnouncementLifecycleRpc(
    "delete_draft_academy_announcement_v2",
    announcementId,
  );
}
