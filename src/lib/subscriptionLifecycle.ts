import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  normalizeTenantOperationalState,
  normalizeTenantSubscriptionLifecycle,
  type TenantOperationalState,
  type TenantSubscriptionLifecycle,
} from "@/src/lib/subscriptionLifecycleModel";

export async function getCurrentTenantOperationalState(
  tenantId: string,
): Promise<TenantOperationalState> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_current_tenant_operational_state",
    { p_tenant_id: tenantId },
  );

  if (error) {
    throw new Error("Workspace access state is unavailable.");
  }

  const state = normalizeTenantOperationalState(data);

  if (state.tenantId !== tenantId) {
    throw new Error("Workspace access state is unavailable.");
  }

  return state;
}

export async function getTenantSubscriptionLifecycle(
  tenantId: string,
): Promise<TenantSubscriptionLifecycle> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_tenant_subscription_lifecycle",
    { p_tenant_id: tenantId },
  );

  if (error) {
    throw new Error("Subscription lifecycle is unavailable.");
  }

  const lifecycle = normalizeTenantSubscriptionLifecycle(data);

  if (lifecycle.tenantId !== tenantId) {
    throw new Error("Subscription lifecycle is unavailable.");
  }

  return lifecycle;
}

