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
