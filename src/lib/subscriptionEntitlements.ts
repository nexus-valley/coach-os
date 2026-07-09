import { getSupabaseClient } from "@/src/lib/supabaseClient";

type JsonRecord = Record<string, unknown>;

export type CanonicalPlanPrice = {
  amount_minor: number | null;
  billing_cycle: string | null;
  currency: string | null;
  region_code: string | null;
  status: string | null;
};

export type CanonicalPlanUsageLimit = {
  enforcement_mode: string | null;
  limit_value: number | string | null;
  resource_key: string | null;
  warning_threshold_percent: number | null;
};

export type CanonicalPlanFeatureEntitlement = {
  entitlement_status: string | null;
  feature_key: string | null;
  requires_platform_approval: boolean | null;
};

export type CanonicalPlanCatalogItem = {
  code: string;
  feature_entitlements: CanonicalPlanFeatureEntitlement[];
  id: string;
  is_public: boolean;
  name: string;
  prices: CanonicalPlanPrice[];
  status: string;
  tier_rank: number | null;
  trial_days: number | null;
  usage_limits: CanonicalPlanUsageLimit[];
};

export type TenantEntitlementAssignment = {
  billing_cycle?: string | null;
  currency?: string | null;
  payment_status?: string | null;
  plan_code?: string | null;
  plan_name?: string | null;
  source?: string | null;
  status?: string | null;
  trial_ends_at?: string | null;
};

export type TenantEntitlementFeature = {
  effective_status: string | null;
  feature_key: string | null;
  module62_status: string | null;
  plan_status: string | null;
  reason: string | null;
  requires_platform_approval: boolean | null;
};

export type TenantEntitlementLimit = {
  base_limit_value: number | string | null;
  enforcement_mode: string | null;
  limit_value: number | string | null;
  limit_type: string | null;
  override_type: string | null;
  resource_key: string | null;
  warning_threshold_percent: number | null;
};

export type TenantEntitlementState = {
  assignment: TenantEntitlementAssignment | null;
  features: TenantEntitlementFeature[];
  gateway_required: boolean;
  latest_usage: JsonRecord;
  limits: TenantEntitlementLimit[];
  payment_forced: boolean;
  tenant_id: string;
  warnings: JsonRecord[];
};

export type SetTenantSubscriptionPlanInput = {
  billingCycle: "custom" | "monthly" | "yearly";
  currency: "EUR" | "INR" | "USD";
  metadata?: JsonRecord;
  paymentStatus: "not_required" | "overdue" | "paid" | "unpaid" | "waived";
  planCode: string;
  status:
    | "active"
    | "cancelled"
    | "expired"
    | "grace"
    | "past_due"
    | "suspended"
    | "trial";
  tenantId: string;
  trialEndsAt?: string | null;
};

export type PlatformUpgradeRequestStatus =
  | "approved"
  | "cancelled"
  | "in_review"
  | "open"
  | "rejected";

export type PlatformUpgradeRequest = {
  created_at: string | null;
  current_assignment: TenantEntitlementAssignment | null;
  gateway_required: boolean;
  metadata_present: boolean;
  payment_forced: boolean;
  reason: string | null;
  request_id: string;
  requested_by: string | null;
  requested_by_email: string | null;
  requested_plan_code: string | null;
  requested_plan_name: string | null;
  status: PlatformUpgradeRequestStatus | string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_slug: string | null;
  updated_at: string | null;
};

export type TenantUpgradeRequest = {
  created_at: string | null;
  entitlement_changed: boolean;
  payment_gateway_called: boolean;
  reason: string | null;
  request_id: string;
  requested_plan_code: string | null;
  requested_plan_name: string | null;
  status: PlatformUpgradeRequestStatus | string | null;
  tenant_id: string | null;
  updated_at: string | null;
};

export type TenantRequestablePlan = {
  current_assignment: TenantEntitlementAssignment | null;
  display_order: number | null;
  has_open_request: boolean;
  plan_code: string;
  plan_name: string | null;
  request_description: string | null;
  request_label: string | null;
  tier_rank: number | null;
  trial_days: number | null;
};

export type PlanUpgradeRequestResult = {
  entitlement_changed: boolean;
  payment_gateway_called: boolean;
  request_id: string;
  requested_plan_code: string | null;
  status: string | null;
  tenant_id: string | null;
};

export type GetPlatformUpgradeRequestsInput = {
  limit?: number;
  offset?: number;
  status?: PlatformUpgradeRequestStatus | null;
  tenantId?: string | null;
};

export type GetTenantUpgradeRequestsInput = {
  limit?: number;
  status?: PlatformUpgradeRequestStatus | null;
  tenantId: string;
};

export type RequestPlanUpgradeInput = {
  reason?: string | null;
  requestedPlanCode: string;
  tenantId: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asLimitValue(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function normalizePlanCatalogItem(row: JsonRecord): CanonicalPlanCatalogItem {
  return {
    code: asString(row.code) ?? "unknown",
    feature_entitlements: asArray(row.feature_entitlements).map((item) => ({
      entitlement_status: asString(item.entitlement_status),
      feature_key: asString(item.feature_key),
      requires_platform_approval:
        typeof item.requires_platform_approval === "boolean"
          ? item.requires_platform_approval
          : null,
    })),
    id: asString(row.id) ?? "",
    is_public: asBoolean(row.is_public),
    name: asString(row.name) ?? "Unnamed plan",
    prices: asArray(row.prices).map((item) => ({
      amount_minor: asNumber(item.amount_minor),
      billing_cycle: asString(item.billing_cycle),
      currency: asString(item.currency),
      region_code: asString(item.region_code),
      status: asString(item.status),
    })),
    status: asString(row.status) ?? "unknown",
    tier_rank: asNumber(row.tier_rank),
    trial_days: asNumber(row.trial_days),
    usage_limits: asArray(row.usage_limits).map((item) => ({
      enforcement_mode: asString(item.enforcement_mode),
      limit_value: asLimitValue(item.limit_value),
      resource_key: asString(item.resource_key),
      warning_threshold_percent: asNumber(item.warning_threshold_percent),
    })),
  };
}

function normalizeTenantEntitlementState(value: unknown): TenantEntitlementState {
  const row = isRecord(value) ? value : {};
  const assignment = isRecord(row.assignment) && Object.keys(row.assignment).length > 0
    ? row.assignment
    : null;

  return {
    assignment: assignment
      ? {
          billing_cycle: asString(assignment.billing_cycle),
          currency: asString(assignment.currency),
          payment_status: asString(assignment.payment_status),
          plan_code: asString(assignment.plan_code),
          plan_name: asString(assignment.plan_name),
          source: asString(assignment.source),
          status: asString(assignment.status),
          trial_ends_at: asString(assignment.trial_ends_at),
        }
      : null,
    features: asArray(row.features).map((item) => ({
      effective_status: asString(item.effective_status),
      feature_key: asString(item.feature_key),
      module62_status: asString(item.module62_status),
      plan_status: asString(item.plan_status),
      reason: asString(item.reason),
      requires_platform_approval:
        typeof item.requires_platform_approval === "boolean"
          ? item.requires_platform_approval
          : null,
    })),
    gateway_required: asBoolean(row.gateway_required),
    latest_usage: isRecord(row.latest_usage) ? row.latest_usage : {},
    limits: asArray(row.limits).map((item) => ({
      base_limit_value: asLimitValue(item.base_limit_value),
      enforcement_mode: asString(item.enforcement_mode),
      limit_type: asString(item.limit_type),
      limit_value: asLimitValue(item.limit_value),
      override_type: asString(item.override_type),
      resource_key: asString(item.resource_key),
      warning_threshold_percent: asNumber(item.warning_threshold_percent),
    })),
    payment_forced: asBoolean(row.payment_forced),
    tenant_id: asString(row.tenant_id) ?? "",
    warnings: asArray(row.warnings),
  };
}

function normalizeTenantEntitlementAssignment(
  value: unknown,
): TenantEntitlementAssignment | null {
  if (!isRecord(value) || Object.keys(value).length === 0) return null;

  return {
    billing_cycle: asString(value.billing_cycle),
    currency: asString(value.currency),
    payment_status: asString(value.payment_status),
    plan_code: asString(value.plan_code),
    plan_name: asString(value.plan_name),
    source: asString(value.source),
    status: asString(value.status),
    trial_ends_at: asString(value.trial_ends_at),
  };
}

function normalizePlatformUpgradeRequest(row: JsonRecord): PlatformUpgradeRequest {
  return {
    created_at: asString(row.created_at),
    current_assignment: normalizeTenantEntitlementAssignment(row.current_assignment),
    gateway_required: asBoolean(row.gateway_required),
    metadata_present: asBoolean(row.metadata_present),
    payment_forced: asBoolean(row.payment_forced),
    reason: asString(row.reason),
    request_id: asString(row.request_id) ?? "",
    requested_by: asString(row.requested_by),
    requested_by_email: asString(row.requested_by_email),
    requested_plan_code: asString(row.requested_plan_code),
    requested_plan_name: asString(row.requested_plan_name),
    status: asString(row.status),
    tenant_id: asString(row.tenant_id),
    tenant_name: asString(row.tenant_name),
    tenant_slug: asString(row.tenant_slug),
    updated_at: asString(row.updated_at),
  };
}

function normalizeTenantUpgradeRequest(row: JsonRecord): TenantUpgradeRequest {
  return {
    created_at: asString(row.created_at),
    entitlement_changed: asBoolean(row.entitlement_changed),
    payment_gateway_called: asBoolean(row.payment_gateway_called),
    reason: asString(row.reason),
    request_id: asString(row.request_id) ?? "",
    requested_plan_code: asString(row.requested_plan_code),
    requested_plan_name: asString(row.requested_plan_name),
    status: asString(row.status),
    tenant_id: asString(row.tenant_id),
    updated_at: asString(row.updated_at),
  };
}

function normalizeTenantRequestablePlan(row: JsonRecord): TenantRequestablePlan {
  return {
    current_assignment: normalizeTenantEntitlementAssignment(row.current_assignment),
    display_order: asNumber(row.display_order),
    has_open_request: asBoolean(row.has_open_request),
    plan_code: asString(row.plan_code) ?? "",
    plan_name: asString(row.plan_name),
    request_description: asString(row.request_description),
    request_label: asString(row.request_label),
    tier_rank: asNumber(row.tier_rank),
    trial_days: asNumber(row.trial_days),
  };
}

function normalizePlanUpgradeRequestResult(
  value: unknown,
): PlanUpgradeRequestResult {
  const row = isRecord(value) ? value : {};

  return {
    entitlement_changed: asBoolean(row.entitlement_changed),
    payment_gateway_called: asBoolean(row.payment_gateway_called),
    request_id: asString(row.request_id) ?? "",
    requested_plan_code: asString(row.requested_plan_code),
    status: asString(row.status),
    tenant_id: asString(row.tenant_id),
  };
}

export async function getPlatformPlanCatalog(): Promise<CanonicalPlanCatalogItem[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_platform_plan_catalog");

  if (error) {
    throw new Error(error.message);
  }

  return asArray(data).map(normalizePlanCatalogItem);
}

export async function getTenantEntitlementState(
  tenantId: string,
): Promise<TenantEntitlementState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_tenant_entitlement_state", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeTenantEntitlementState(data);
}

export async function getTenantRequestablePlanCatalog(
  tenantId: string,
): Promise<TenantRequestablePlan[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_tenant_requestable_plan_catalog",
    {
      p_tenant_id: tenantId,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  return asArray(data).map(normalizeTenantRequestablePlan);
}

export async function getPlatformUpgradeRequests(
  input: GetPlatformUpgradeRequestsInput = {},
): Promise<PlatformUpgradeRequest[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_platform_upgrade_requests", {
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
    p_status: input.status ?? null,
    p_tenant_id: input.tenantId ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return asArray(data).map(normalizePlatformUpgradeRequest);
}

export async function getTenantUpgradeRequests(
  input: GetTenantUpgradeRequestsInput,
): Promise<TenantUpgradeRequest[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_tenant_upgrade_requests", {
    p_limit: input.limit ?? 20,
    p_status: input.status ?? null,
    p_tenant_id: input.tenantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return asArray(data).map(normalizeTenantUpgradeRequest);
}

export async function requestPlanUpgrade(
  input: RequestPlanUpgradeInput,
): Promise<PlanUpgradeRequestResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("request_plan_upgrade", {
    p_reason: input.reason ?? null,
    p_requested_plan_code: input.requestedPlanCode,
    p_tenant_id: input.tenantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizePlanUpgradeRequestResult(data);
}

export async function setTenantSubscriptionPlan(
  input: SetTenantSubscriptionPlanInput,
): Promise<TenantEntitlementState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("set_tenant_subscription_plan", {
    p_billing_cycle: input.billingCycle,
    p_currency: input.currency,
    p_metadata_json: input.metadata ?? {},
    p_payment_status: input.paymentStatus,
    p_plan_code: input.planCode,
    p_status: input.status,
    p_tenant_id: input.tenantId,
    p_trial_ends_at: input.trialEndsAt ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeTenantEntitlementState(data);
}
