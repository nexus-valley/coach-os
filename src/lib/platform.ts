import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type PlatformRole = "owner" | "admin" | "support" | "finance";
export type PlatformAdminStatus = "active" | "suspended";
export type PlatformSubscriptionStatus =
  | "active"
  | "cancelled"
  | "past_due"
  | "suspended"
  | "trial";
export type PlatformPaymentStatus =
  | "not_required"
  | "overdue"
  | "paid"
  | "unpaid"
  | "waived";

export type PlatformAdminContext = {
  role: PlatformRole;
  status: PlatformAdminStatus;
  user_id: string;
};

export type PlatformDashboard = {
  active_subscriptions: number;
  active_tenants: number;
  overdue_subscriptions: number;
  recent_activity: PlatformActivity[];
  recent_tenants: Array<{
    created_at: string | null;
    id: string;
    name: string;
    slug: string;
  }>;
  suspended_tenants: number;
  tenant_count: number;
  total_courses: number;
  total_students: number;
  trial_tenants: number;
};

export type PlatformTenantSummary = {
  category: string | null;
  courses_count: number;
  created_at: string | null;
  id: string;
  last_activity_at: string | null;
  name: string;
  slug: string;
  students_count: number;
  subscription: PlatformTenantSubscriptionSummary;
  team_members_count: number;
};

export type PlatformTenantSubscriptionSummary = {
  amount: number | null;
  billing_cycle: string | null;
  currency: string | null;
  current_period_end: string | null;
  payment_status: PlatformPaymentStatus | null;
  plan_code: string | null;
  plan_name: string | null;
  status: PlatformSubscriptionStatus | null;
  trial_ends_at: string | null;
};

export type PlatformTenantDetail = {
  activity: PlatformActivity[];
  counts: {
    courses_count: number;
    owner_admin_count: number;
    students_count: number;
    team_members_count: number;
  };
  latest_usage_snapshot: PlatformUsageSnapshot | null;
  subscription: PlatformTenantSubscriptionSummary & {
    id: string | null;
    notes_present: boolean;
    plan_id: string | null;
    trial_started_at: string | null;
    current_period_start: string | null;
  };
  support_note_counts?: {
    archived: number;
    in_progress: number;
    open: number;
    resolved: number;
  };
  support_notes: PlatformSupportNote[];
  tenant: {
    category: string | null;
    created_at: string | null;
    id: string;
    name: string;
    slug: string;
    subscription_status: string | null;
  };
};

export type PlatformUsageSnapshot = {
  ai_requests_count: number;
  courses_count: number;
  created_at: string;
  id: string;
  marketing_campaigns_count: number;
  metadata_json: Record<string, unknown>;
  snapshot_date: string;
  storage_mb: number;
  students_count: number;
  team_members_count: number;
  tenant_id: string;
};

export type PlatformSupportNote = {
  created_at: string;
  created_by: string | null;
  id: string;
  note: string;
  note_type: string;
  status: string;
  updated_at: string;
};

export type PlatformActivity = {
  action: string;
  created_at: string;
  entity_id: string | null;
  entity_type: string | null;
  id: string;
  metadata_json: Record<string, unknown>;
  tenant_id?: string | null;
};

export type PlatformPlanInput = {
  aiMonthlyLimit?: number | null;
  code: string;
  description?: string | null;
  features?: Record<string, unknown>;
  marketingMonthlyLimit?: number | null;
  maxCourses?: number | null;
  maxStorageMb?: number | null;
  maxStudents?: number | null;
  maxTeamMembers?: number | null;
  monthlyPrice?: number;
  name: string;
  status?: "active" | "archived" | "inactive";
  yearlyPrice?: number;
};

export type PlatformSubscriptionPlan = {
  ai_monthly_limit: number | null;
  code: string;
  created_at: string;
  description: string | null;
  id: string;
  marketing_monthly_limit: number | null;
  max_courses: number | null;
  max_storage_mb: number | null;
  max_students: number | null;
  max_team_members: number | null;
  monthly_price: number;
  name: string;
  status: "active" | "archived" | "inactive";
  yearly_price: number;
};

export type PlatformTenantSubscriptionInput = {
  amount?: number;
  billingCycle?: "custom" | "monthly" | "yearly";
  currentPeriodEnd?: string | null;
  currentPeriodStart?: string | null;
  metadata?: Record<string, unknown>;
  notes?: string | null;
  paymentStatus?: PlatformPaymentStatus;
  planId?: string | null;
  status?: PlatformSubscriptionStatus;
  tenantId: string;
  trialEndsAt?: string | null;
  trialStartedAt?: string | null;
};

export type ManualSubscriptionActivationInput = {
  amountMinor: number;
  billingCycle: "monthly" | "yearly";
  currency: "INR";
  customerEmail: string;
  founderApproval: string;
  gracePeriodEndsAt?: string | null;
  idempotencyKey: string;
  operatorNote?: string | null;
  paymentMethod: string;
  paymentReference: string;
  paymentVerifiedAt: string;
  planCode: "starter" | "growth";
  replaceCurrent: boolean;
  subscriptionEnd: string;
  subscriptionStart: string;
  supportTier?: string | null;
  tenantId: string;
};

export type ManualSubscriptionActivationResult = Record<string, unknown>;

export type PlatformSupportNoteInput = {
  metadata?: Record<string, unknown>;
  note: string;
  noteType?: "billing" | "follow_up" | "general" | "onboarding" | "risk" | "technical";
  status?: "archived" | "in_progress" | "open" | "resolved";
  tenantId: string;
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function hasMissingPlatformSchemaError(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "42P01" ||
    error?.code === "42883" ||
    error?.message?.toLowerCase().includes("platform_admin_users") ||
    error?.message?.toLowerCase().includes("get_platform_dashboard")
  );
}

export async function getPlatformAdminContext(): Promise<PlatformAdminContext | null> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("platform_admin_users")
    .select("user_id,role,status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    if (hasMissingPlatformSchemaError(error)) {
      return null;
    }

    throw new Error(error.message);
  }

  return (data as PlatformAdminContext | null) ?? null;
}

export async function getPlatformDashboard() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_platform_dashboard");

  if (error) {
    throw new Error(error.message);
  }

  return data as PlatformDashboard;
}

export async function getPlatformTenants() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_platform_tenants");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as PlatformTenantSummary[];
}

export async function getPlatformPlans() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("platform_subscription_plans")
    .select(
      "id,code,name,description,monthly_price,yearly_price,max_students,max_courses,max_team_members,max_storage_mb,ai_monthly_limit,marketing_monthly_limit,status,created_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as PlatformSubscriptionPlan[];
}

export async function getPlatformTenantDetail(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_platform_tenant_detail", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as PlatformTenantDetail;
}

export async function upsertPlatformSubscriptionPlan(input: PlatformPlanInput) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("upsert_platform_subscription_plan", {
    p_ai_monthly_limit: input.aiMonthlyLimit ?? null,
    p_code: input.code,
    p_currency: "INR",
    p_description: input.description ?? null,
    p_features_json: input.features ?? {},
    p_marketing_monthly_limit: input.marketingMonthlyLimit ?? null,
    p_max_courses: input.maxCourses ?? null,
    p_max_storage_mb: input.maxStorageMb ?? null,
    p_max_students: input.maxStudents ?? null,
    p_max_team_members: input.maxTeamMembers ?? null,
    p_monthly_price: input.monthlyPrice ?? 0,
    p_name: input.name,
    p_status: input.status ?? "active",
    p_yearly_price: input.yearlyPrice ?? 0,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as string;
}

export async function updateTenantSubscription(input: PlatformTenantSubscriptionInput) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_tenant_subscription", {
    p_amount: input.amount ?? 0,
    p_billing_cycle: input.billingCycle ?? "monthly",
    p_currency: "INR",
    p_current_period_end: input.currentPeriodEnd ?? null,
    p_current_period_start: input.currentPeriodStart ?? null,
    p_metadata_json: input.metadata ?? {},
    p_notes: input.notes ?? null,
    p_payment_status: input.paymentStatus ?? "not_required",
    p_plan_id: input.planId ?? null,
    p_status: input.status ?? "trial",
    p_tenant_id: input.tenantId,
    p_trial_ends_at: input.trialEndsAt ?? null,
    p_trial_started_at: input.trialStartedAt ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as string;
}

export async function activateTenantSubscriptionManual(
  input: ManualSubscriptionActivationInput,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "activate_tenant_subscription_manual",
    {
      p_amount_minor: input.amountMinor,
      p_billing_cycle: input.billingCycle,
      p_currency: input.currency,
      p_customer_email: input.customerEmail,
      p_founder_approval: input.founderApproval,
      p_grace_period_ends_at: input.gracePeriodEndsAt ?? null,
      p_idempotency_key: input.idempotencyKey,
      p_operator_note: input.operatorNote ?? null,
      p_payment_method: input.paymentMethod,
      p_payment_reference: input.paymentReference,
      p_payment_verified_at: input.paymentVerifiedAt,
      p_plan_code: input.planCode,
      p_replace_current: input.replaceCurrent,
      p_subscription_end: input.subscriptionEnd,
      p_subscription_start: input.subscriptionStart,
      p_support_tier: input.supportTier ?? null,
      p_tenant_id: input.tenantId,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? {}) as ManualSubscriptionActivationResult;
}

export async function recordPlatformSupportNote(input: PlatformSupportNoteInput) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("record_platform_support_note", {
    p_metadata_json: input.metadata ?? {},
    p_note: input.note,
    p_note_type: input.noteType ?? "general",
    p_status: input.status ?? "open",
    p_tenant_id: input.tenantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as string;
}

export async function updatePlatformSupportNote(
  noteId: string,
  input: { metadata?: Record<string, unknown>; note?: string | null; status?: string | null },
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_platform_support_note", {
    p_metadata_json: input.metadata ?? {},
    p_note: input.note ?? null,
    p_note_id: noteId,
    p_status: input.status ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as string;
}

export async function capturePlatformUsageSnapshot(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("capture_platform_usage_snapshot", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as string;
}

export function toDisplayDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined,
  }).format(new Date(value));
}

export function toCurrency(value: number | null | undefined, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    currency,
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value ?? 0);
}

export function normalizePlatformError(error: unknown) {
  const message = getErrorMessage(error, "Unable to complete the platform request.");
  const lower = message.toLowerCase();

  if (
    lower.includes("permission denied") ||
    lower.includes("platform admin access") ||
    lower.includes("row-level security") ||
    lower.includes("42501")
  ) {
    return "You do not have permission to perform that platform action.";
  }

  if (lower.includes("duplicate key")) {
    return "A record with those values already exists.";
  }

  if (lower.includes("cannot contain html-like")) {
    return "Remove HTML-like characters before saving.";
  }

  if (lower.includes("too long") || lower.includes("too large")) {
    return "One of the fields is over the allowed length.";
  }

  return message;
}
