"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import {
  featureDefinitions,
  featureListToMap,
  getFeatureStatusLabel,
  getPortalFeatureAccess,
  getTenantFeatureAccess,
  isFeatureEnabled,
  type FeatureAccessMap,
  type FeatureKey,
} from "@/src/lib/featureAccess";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant } from "@/src/lib/tenant";

type FeatureGateProps = {
  children: ReactNode;
  featureKey: FeatureKey;
  mode?: "app" | "portal";
  tenantId?: string;
};

export function FeatureGate({
  children,
  featureKey,
  mode = "app",
  tenantId,
}: FeatureGateProps) {
  const [access, setAccess] = useState<FeatureAccessMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<MemberRole | null>(null);

  useEffect(() => {
    let active = true;

    async function loadAccess() {
      try {
        const targetTenantId =
          tenantId ?? (mode === "app" ? (await getCurrentTenant())?.id : null);

        if (!targetTenantId) {
          if (active) {
            setAccess(null);
            setLoading(false);
          }
          return;
        }

        const response =
          mode === "portal"
            ? await getPortalFeatureAccess(targetTenantId)
            : await getTenantFeatureAccess(targetTenantId);

        if (mode === "app") {
          const supabase = getSupabaseClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();
          const currentRole = user
            ? await getCurrentMemberRole(targetTenantId, user.id)
            : null;

          if (active) {
            setRole(currentRole);
          }
        }

        if (active) {
          setAccess(featureListToMap(response.features));
          setLoading(false);
        }
      } catch {
        if (active) {
          setAccess(null);
          setLoading(false);
        }
      }
    }

    loadAccess();

    return () => {
      active = false;
    };
  }, [featureKey, mode, tenantId]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#D8E8F0] bg-white p-6 text-sm font-medium text-[#5D7185] shadow-sm">
        Checking module access...
      </div>
    );
  }

  if (isFeatureEnabled(access, featureKey)) {
    return <>{children}</>;
  }

  const definition = featureDefinitions.find((feature) => feature.key === featureKey);
  const status = access?.[featureKey]?.status;
  const canManage = role === "owner" || role === "admin";

  return (
    <section className="rounded-2xl border border-[#D8E8F0] bg-white p-8 shadow-sm shadow-[#0B2A3D]/5">
      <div className="max-w-2xl">
        <span className="inline-flex rounded-full border border-[#D8E8F0] bg-[#F3FAFD] px-3 py-1 text-xs font-semibold text-[#425B76]">
          {getFeatureStatusLabel(status)}
        </span>
        <h2 className="mt-4 text-2xl font-semibold text-[#0B2A3D]">
          This module is not enabled for your workspace.
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#5D7185]">
          {definition?.label ?? "This module"} is currently unavailable for this
          workspace. Existing data remains protected and the route is kept in
          place so the app can show this safe state.
        </p>
        {canManage ? (
          <Link
            className="mt-6 inline-flex rounded-xl bg-[#145DA0] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0B2A3D]"
            href="/app/settings/features"
          >
            Open Feature Settings
          </Link>
        ) : null}
      </div>
    </section>
  );
}
