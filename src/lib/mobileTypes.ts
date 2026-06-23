export type MobileContextMode = "none" | "student" | "team";

export type MobileTenantBranding = {
  accent_color?: string | null;
  brand_color?: string | null;
  brand_name?: string | null;
  brand_tagline?: string | null;
  icon_url?: string | null;
  id: string;
  logo_url?: string | null;
  name: string;
  show_powered_by?: boolean;
  slug: string;
  student_portal_theme_color?: string | null;
  support_email?: string | null;
  support_phone?: string | null;
  website_url?: string | null;
  workspace_display_name?: string | null;
};

export type MobileUserProfile = {
  avatar_url?: string | null;
  email?: string | null;
  full_name?: string | null;
  id: string;
};

export type MobilePermissionSummary = Record<string, boolean>;

export type MobileTeamContext = {
  mode: "team";
  permissions: MobilePermissionSummary;
  role: "admin" | "owner" | "staff" | "trainer";
  sections: string[];
  tenant: MobileTenantBranding;
  unread_notifications: number;
  user: MobileUserProfile;
};

export type MobileStudentContext = {
  mode: "student";
  sections: string[];
  student: {
    email?: string | null;
    full_name: string;
    id: string;
    phone?: string | null;
    status?: string | null;
  };
  tenant: MobileTenantBranding;
  unread_notifications: number;
  user: MobileUserProfile;
};

export type MobileNoContext = {
  mode: "none";
  sections: string[];
  unread_notifications: number;
  user: Pick<MobileUserProfile, "id">;
};

export type MobileBootstrap =
  | MobileNoContext
  | MobileStudentContext
  | MobileTeamContext;

export type MobileNotificationItem = {
  action_url?: string | null;
  created_at: string;
  id: string;
  message: string;
  read_at?: string | null;
  severity: "critical" | "info" | "warning";
  status: "archived" | "read" | "unread";
  title: string;
  type: string;
};

export type MobileNotificationsResponse = {
  items: MobileNotificationItem[];
  limit: number;
  offset: number;
  unread_count: number;
};

export type MobileHomeMetricSummary = Record<
  string,
  number | string | boolean | null
>;

export type MobileStudentHome = {
  pending_assignments: Array<Record<string, unknown>>;
  profile: Record<string, unknown>;
  summary: MobileHomeMetricSummary;
  tenant: MobileTenantBranding;
  upcoming_sessions: Array<Record<string, unknown>>;
};

export type MobileTrainerHome = {
  role: "trainer";
  summary: MobileHomeMetricSummary;
  tenant: MobileTenantBranding;
  upcoming_sessions: Array<Record<string, unknown>>;
};

export type MobileTeamHome = {
  role: "admin" | "owner" | "staff" | "trainer";
  sections: string[];
  summary: MobileHomeMetricSummary;
  tenant: MobileTenantBranding;
};

export type MobileOfflineManifest = {
  last_updated: Record<string, string | null>;
  mode: MobileContextMode;
  sections: string[];
  server_time: string;
  tenant_id?: string | null;
};
