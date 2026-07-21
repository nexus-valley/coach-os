import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type FeatureStatus =
  | "enabled"
  | "disabled"
  | "locked_by_plan"
  | "coming_soon";

export type FeatureKey =
  | "dashboard"
  | "students"
  | "courses"
  | "attendance"
  | "assignments"
  | "finance"
  | "reports"
  | "documents"
  | "document_uploads"
  | "messages"
  | "crm"
  | "marketing"
  | "automations"
  | "workflows"
  | "approvals"
  | "team_operations"
  | "audit_compliance"
  | "backup_recovery"
  | "website_builder"
  | "certificates"
  | "payment_gateway"
  | "live_classes"
  | "notifications"
  | "mobile_pwa";

export type FeatureDefinition = {
  description: string;
  key: FeatureKey;
  label: string;
  section: "Core" | "Operations" | "Growth" | "Portal" | "Future";
  required?: boolean;
};

export type FeatureAccessItem = {
  configured_at?: string | null;
  feature_key: FeatureKey;
  source?: "manual" | "plan" | "system";
  status: FeatureStatus;
  updated_at?: string | null;
};

export type FeatureAccessResponse = {
  can_manage?: boolean;
  features: FeatureAccessItem[];
  role?: string | null;
  tenant_id?: string;
};

export type FeatureAccessMap = Partial<Record<FeatureKey, FeatureAccessItem>>;

export const featureDefinitions: FeatureDefinition[] = [
  {
    description: "Workspace home and command-center overview.",
    key: "dashboard",
    label: "Home",
    required: true,
    section: "Core",
  },
  {
    description: "Student records, enrollments, and student operations.",
    key: "students",
    label: "Students",
    required: true,
    section: "Core",
  },
  {
    description: "Programs, live classes, and coaching delivery setup.",
    key: "courses",
    label: "Programs",
    required: true,
    section: "Core",
  },
  {
    description: "Attendance and session tracking.",
    key: "attendance",
    label: "Attendance",
    section: "Operations",
  },
  {
    description: "Assignments, submissions, and review workflows.",
    key: "assignments",
    label: "Assignments",
    section: "Operations",
  },
  {
    description: "Student sales, invoices, dues, receipts, and payments.",
    key: "finance",
    label: "Sales",
    section: "Operations",
  },
  {
    description: "Analytics dashboards and CSV exports.",
    key: "reports",
    label: "Analytics",
    section: "Operations",
  },
  {
    description: "Content library and student-visible materials.",
    key: "documents",
    label: "Content Library",
    section: "Operations",
  },
  {
    description: "Actual document upload/download storage workflow.",
    key: "document_uploads",
    label: "Document Uploads",
    section: "Future",
  },
  {
    description: "Student support messages, announcements, and community access.",
    key: "messages",
    label: "Support & Communication",
    section: "Portal",
  },
  {
    description: "CRM leads, follow-ups, and admissions pipeline.",
    key: "crm",
    label: "CRM",
    section: "Growth",
  },
  {
    description: "Campaign planning and marketing operations.",
    key: "marketing",
    label: "Marketing",
    section: "Growth",
  },
  {
    description: "Operational automations and reminders.",
    key: "automations",
    label: "Automations",
    section: "Operations",
  },
  {
    description: "Workflow templates and process runs.",
    key: "workflows",
    label: "Workflows",
    section: "Operations",
  },
  {
    description: "Approval requests, decisions, and gates.",
    key: "approvals",
    label: "Approvals",
    section: "Operations",
  },
  {
    description: "Institute HR and team operations.",
    key: "team_operations",
    label: "Team Operations",
    section: "Operations",
  },
  {
    description: "Audit, compliance, and activity visibility.",
    key: "audit_compliance",
    label: "Audit & Compliance",
    section: "Operations",
  },
  {
    description: "Backup and recovery readiness.",
    key: "backup_recovery",
    label: "Backup & Recovery",
    section: "Operations",
  },
  {
    description:
      "CoachFort-hosted branded public site builder. Custom domains are a future add-on.",
    key: "website_builder",
    label: "Website Builder",
    section: "Growth",
  },
  {
    description: "Certificates for students and enrollments.",
    key: "certificates",
    label: "Certificates",
    section: "Portal",
  },
  {
    description: "Online payment gateway integration. Gateway work is on hold.",
    key: "payment_gateway",
    label: "Payment Gateway",
    section: "Future",
  },
  {
    description: "Live class provider integration.",
    key: "live_classes",
    label: "Live Classes",
    section: "Future",
  },
  {
    description: "In-app notifications and reminder visibility.",
    key: "notifications",
    label: "Notifications",
    section: "Portal",
  },
  {
    description: "Mobile/PWA readiness tools.",
    key: "mobile_pwa",
    label: "Mobile/PWA",
    section: "Portal",
  },
];

export const featureKeys = featureDefinitions.map((feature) => feature.key);

export const navFeatureByLabel: Record<string, FeatureKey | undefined> = {
  Activity: "audit_compliance",
  Analytics: "reports",
  Announcements: "messages",
  Approvals: "approvals",
  Assignments: "assignments",
  Assistant: "dashboard",
  "Backup & Recovery": "backup_recovery",
  Branding: "website_builder",
  Certificates: "certificates",
  Cohorts: "courses",
  Compliance: "audit_compliance",
  Community: "messages",
  "Content Library": "documents",
  Courses: "courses",
  CRM: "crm",
  Dashboard: "dashboard",
  Documents: "documents",
  Enrollments: "students",
  Finance: "finance",
  Home: "dashboard",
  "Live Classes": "attendance",
  Marketing: "marketing",
  Messages: "messages",
  "Mobile Readiness": "mobile_pwa",
  Notifications: "notifications",
  Operations: "attendance",
  Automations: "automations",
  Portal: "students",
  Programs: "courses",
  "Public Site": "website_builder",
  Reminders: "notifications",
  Reports: "reports",
  Sales: "finance",
  Sessions: "attendance",
  Students: "students",
  "Team Operations": "team_operations",
  Workflows: "workflows",
};

export const portalNavFeatureByLabel: Record<string, FeatureKey | undefined> = {
  Announcements: "messages",
  Assignments: "assignments",
  Certificates: "certificates",
  Community: "messages",
  Courses: "courses",
  Documents: "documents",
  "Live Classes": "attendance",
  Materials: "documents",
  Messages: "messages",
  "My Programs": "courses",
  Notifications: "notifications",
  Payments: "finance",
  "Payments & Invoices": "finance",
  Sessions: "attendance",
  Support: "messages",
};

export function defaultFeatureAccess(): FeatureAccessMap {
  return featureDefinitions.reduce<FeatureAccessMap>((acc, definition) => {
    acc[definition.key] = {
      feature_key: definition.key,
      source: "system",
      status:
        definition.key === "document_uploads" ||
        definition.key === "payment_gateway" ||
        definition.key === "live_classes"
          ? "coming_soon"
          : "enabled",
    };
    return acc;
  }, {});
}

export function featureListToMap(
  features: FeatureAccessItem[] | null | undefined,
) {
  const fallback = defaultFeatureAccess();

  for (const item of features ?? []) {
    fallback[item.feature_key] = item;
  }

  return fallback;
}

export function isFeatureEnabled(
  access: FeatureAccessMap | null | undefined,
  featureKey: FeatureKey | undefined,
) {
  if (!featureKey) {
    return true;
  }

  if (!access) {
    return true;
  }

  return (access[featureKey]?.status ?? "enabled") === "enabled";
}

export function getFeatureStatusLabel(status: FeatureStatus | undefined) {
  switch (status) {
    case "coming_soon":
      return "Coming soon";
    case "disabled":
      return "Disabled";
    case "enabled":
      return "Enabled";
    case "locked_by_plan":
      return "Locked by plan";
    default:
      return "Enabled";
  }
}

function isMissingRpcError(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "PGRST202" ||
    error?.code === "42883" ||
    error?.message?.toLowerCase().includes("function") ||
    false
  );
}

export async function getTenantFeatureAccess(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_tenant_feature_access", {
    p_tenant_id: tenantId,
  });

  if (error) {
    if (isMissingRpcError(error)) {
      return {
        can_manage: false,
        features: Object.values(defaultFeatureAccess()),
      } satisfies FeatureAccessResponse;
    }

    throw error;
  }

  return data as FeatureAccessResponse;
}

export async function getPortalFeatureAccess(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_portal_feature_access", {
    p_tenant_id: tenantId,
  });

  if (error) {
    if (isMissingRpcError(error)) {
      return {
        features: Object.values(defaultFeatureAccess()),
      } satisfies FeatureAccessResponse;
    }

    throw error;
  }

  return data as FeatureAccessResponse;
}

export async function updateTenantFeatureAccess(
  tenantId: string,
  featureKey: FeatureKey,
  status: FeatureStatus,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_tenant_feature_access", {
    p_feature_key: featureKey,
    p_status: status,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

  return data as FeatureAccessResponse;
}

export async function bulkUpdateTenantFeatureAccess(
  tenantId: string,
  updates: Partial<Record<FeatureKey, FeatureStatus>>,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "bulk_update_tenant_feature_access",
    {
      p_features: updates,
      p_tenant_id: tenantId,
    },
  );

  if (error) {
    throw error;
  }

  return data as FeatureAccessResponse;
}
