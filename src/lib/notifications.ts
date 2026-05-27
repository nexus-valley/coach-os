import { logActivity } from "@/src/lib/auditLogger";
import { logNotificationDelivery } from "@/src/lib/communication";
import {
  getMemberRoleForTenant,
  type MemberRole,
} from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type NotificationType =
  | "attendance_alert"
  | "assignment_notice"
  | "invitation_notice"
  | "invoice_notice"
  | "live_session_notice"
  | "payment_reminder"
  | "session_reminder"
  | "subscription_notice"
  | "system_notice";
export type NotificationSeverity = "critical" | "info" | "warning";
export type NotificationStatus = "archived" | "read" | "unread";

export type Notification = {
  action_url: string | null;
  created_at: string;
  entity_id: string | null;
  entity_type: string | null;
  id: string;
  message: string;
  metadata_json: Record<string, unknown>;
  read_at: string | null;
  severity: NotificationSeverity;
  status: NotificationStatus;
  tenant_id: string;
  title: string;
  type: NotificationType;
  user_id: string;
};

export type NotificationPreferences = {
  created_at: string;
  enable_attendance_alerts: boolean;
  enable_email: boolean;
  enable_in_app: boolean;
  enable_payment_alerts: boolean;
  enable_session_reminders: boolean;
  enable_system_notifications: boolean;
  enable_whatsapp: boolean;
  id: string;
  tenant_id: string;
  updated_at: string;
  user_id: string;
};

export type NotificationFilters = {
  limit?: number;
  severity?: NotificationSeverity | "all";
  status?: NotificationStatus | "all";
  type?: NotificationType | "all";
};

const notificationSelect =
  "id,tenant_id,user_id,type,title,message,entity_type,entity_id,severity,status,action_url,metadata_json,created_at,read_at";
const preferencesSelect =
  "id,tenant_id,user_id,enable_in_app,enable_email,enable_whatsapp,enable_attendance_alerts,enable_payment_alerts,enable_session_reminders,enable_system_notifications,created_at,updated_at";

function isMissingTableError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

function normalizeNotification(row: Notification) {
  return {
    ...row,
    metadata_json: row.metadata_json ?? {},
  } satisfies Notification;
}

export function getSafeNotificationActionUrl(
  actionUrl: string | null | undefined,
) {
  if (!actionUrl || !actionUrl.startsWith("/") || actionUrl.startsWith("//")) {
    return null;
  }

  return actionUrl;
}

async function getCurrentUser() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("You must be logged in to access notifications.");
  }

  return user;
}

export async function getTenantMemberUserIds(
  tenantId: string,
  roles?: MemberRole[],
) {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("tenant_members")
    .select("user_id,role")
    .eq("tenant_id", tenantId);

  if (roles?.length) {
    query = query.in("role", roles);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return ((data ?? []) as { role: MemberRole; user_id: string }[]).map(
    (member) => member.user_id,
  );
}

export async function createNotification(input: {
  actionUrl?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  message: string;
  metadata?: Record<string, unknown>;
  severity?: NotificationSeverity;
  tenantId: string;
  title: string;
  type: NotificationType;
  userId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      action_url: input.actionUrl ?? null,
      entity_id: input.entityId ?? null,
      entity_type: input.entityType ?? null,
      message: input.message,
      metadata_json: input.metadata ?? {},
      severity: input.severity ?? "info",
      status: "unread",
      tenant_id: input.tenantId,
      title: input.title,
      type: input.type,
      user_id: input.userId,
    })
    .select(notificationSelect)
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return null;
    }

    throw error;
  }

  const notification = normalizeNotification(data as Notification);

  await logActivity({
    action: "notification_created",
    description: notification.title,
    entityId: notification.id,
    entityName: notification.title,
    entityType: "notification",
    metadata: {
      severity: notification.severity,
      type: notification.type,
      userId: notification.user_id,
    },
    severity: notification.severity,
    tenantId: notification.tenant_id,
  });

  await logNotificationDelivery({
    message: notification.message,
    notificationId: notification.id,
    tenantId: notification.tenant_id,
    title: notification.title,
    type: notification.type,
    userId: notification.user_id,
  });

  return notification;
}

export async function createNotificationsForUsers(input: Omit<
  Parameters<typeof createNotification>[0],
  "userId"
> & {
  userIds: string[];
}) {
  const uniqueUserIds = Array.from(new Set(input.userIds));
  const notifications: Notification[] = [];

  for (const userId of uniqueUserIds) {
    let notification: Notification | null = null;

    try {
      notification = await createNotification({
        ...input,
        userId,
      });
    } catch {
      notification = null;
    }

    if (notification) {
      notifications.push(notification);
    }
  }

  return notifications;
}

export async function createNotificationForTenantRoles(input: Omit<
  Parameters<typeof createNotification>[0],
  "userId"
> & {
  roles: MemberRole[];
}) {
  const userIds = await getTenantMemberUserIds(input.tenantId, input.roles);

  return createNotificationsForUsers({
    ...input,
    userIds,
  });
}

export async function getUserNotifications(
  tenantId: string,
  filters: NotificationFilters = {},
) {
  const user = await getCurrentUser();
  const role = await getMemberRoleForTenant(tenantId, user.id);
  const limit = Math.min(Math.max(filters.limit ?? 25, 5), 100);
  const supabase = getSupabaseClient();
  let query = supabase
    .from("notifications")
    .select(notificationSelect)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (role !== "owner" && role !== "admin") {
    query = query.eq("user_id", user.id);
  }

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.severity && filters.severity !== "all") {
    query = query.eq("severity", filters.severity);
  }

  if (filters.type && filters.type !== "all") {
    query = query.eq("type", filters.type);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }

    throw error;
  }

  return ((data ?? []) as Notification[]).map(normalizeNotification);
}

export async function getUnreadNotificationCount(tenantId: string) {
  const user = await getCurrentUser();
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .eq("status", "unread");

  if (error) {
    if (isMissingTableError(error)) {
      return 0;
    }

    throw error;
  }

  return count ?? 0;
}

async function updateNotificationStatus(input: {
  notificationId: string;
  status: Extract<NotificationStatus, "archived" | "read">;
  tenantId: string;
}) {
  const user = await getCurrentUser();
  const role = await getMemberRoleForTenant(input.tenantId, user.id);
  const supabase = getSupabaseClient();
  const patch =
    input.status === "read"
      ? { read_at: new Date().toISOString(), status: "read" }
      : { status: "archived" };
  let query = supabase
    .from("notifications")
    .update(patch)
    .eq("tenant_id", input.tenantId)
    .eq("id", input.notificationId);

  if (role !== "owner" && role !== "admin") {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query.select(notificationSelect).single();

  if (error) {
    throw error;
  }

  const notification = normalizeNotification(data as Notification);

  await logActivity({
    action:
      input.status === "read" ? "notification_read" : "notification_archived",
    description:
      input.status === "read"
        ? `Read notification ${notification.title}`
        : `Archived notification ${notification.title}`,
    entityId: notification.id,
    entityName: notification.title,
    entityType: "notification",
    metadata: { type: notification.type },
    tenantId: notification.tenant_id,
  });

  return notification;
}

export async function markNotificationRead(
  tenantId: string,
  notificationId: string,
) {
  return updateNotificationStatus({
    notificationId,
    status: "read",
    tenantId,
  });
}

export async function archiveNotification(
  tenantId: string,
  notificationId: string,
) {
  return updateNotificationStatus({
    notificationId,
    status: "archived",
    tenantId,
  });
}

export async function getNotificationPreferences(tenantId: string) {
  const user = await getCurrentUser();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("notification_preferences")
    .select(preferencesSelect)
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return null;
    }

    throw error;
  }

  if (data) {
    return data as NotificationPreferences;
  }

  const { data: created, error: createError } = await supabase
    .from("notification_preferences")
    .insert({
      tenant_id: tenantId,
      user_id: user.id,
    })
    .select(preferencesSelect)
    .single();

  if (createError) {
    if (isMissingTableError(createError)) {
      return null;
    }

    throw createError;
  }

  return created as NotificationPreferences;
}

export async function updateNotificationPreferences(
  tenantId: string,
  preferences: Partial<
    Pick<
      NotificationPreferences,
      | "enable_attendance_alerts"
      | "enable_email"
      | "enable_in_app"
      | "enable_payment_alerts"
      | "enable_session_reminders"
      | "enable_system_notifications"
      | "enable_whatsapp"
    >
  >,
) {
  const user = await getCurrentUser();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("notification_preferences")
    .upsert(
      {
        ...preferences,
        tenant_id: tenantId,
        user_id: user.id,
      },
      { onConflict: "tenant_id,user_id" },
    )
    .select(preferencesSelect)
    .single();

  if (error) {
    throw error;
  }

  return data as NotificationPreferences;
}
