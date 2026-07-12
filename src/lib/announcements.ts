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
