"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/src/components/ui/Button";
import {
  bulkUpdateTenantFeatureAccess,
  featureDefinitions,
  featureListToMap,
  getFeatureStatusLabel,
  getTenantFeatureAccess,
  type FeatureAccessMap,
  type FeatureKey,
  type FeatureStatus,
} from "@/src/lib/featureAccess";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

const manageableStatuses: FeatureStatus[] = ["enabled", "disabled"];

export function FeatureSettingsPage() {
  const [access, setAccess] = useState<FeatureAccessMap | null>(null);
  const [draft, setDraft] = useState<Partial<Record<FeatureKey, FeatureStatus>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [role, setRole] = useState<MemberRole | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setError(null);
        const currentTenant = await getCurrentTenant();

        if (!currentTenant) {
          throw new Error("Workspace not found.");
        }

        const supabase = getSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const currentRole = user
          ? await getCurrentMemberRole(currentTenant.id, user.id)
          : null;
        const response = await getTenantFeatureAccess(currentTenant.id);

        if (active) {
          setTenant(currentTenant);
          setRole(currentRole);
          setAccess(featureListToMap(response.features));
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Feature settings could not be loaded.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, []);

  const groupedFeatures = useMemo(() => {
    return featureDefinitions.reduce<Record<string, typeof featureDefinitions>>(
      (groups, feature) => {
        groups[feature.section] = groups[feature.section] ?? [];
        groups[feature.section].push(feature);
        return groups;
      },
      {},
    );
  }, []);

  const canManage = role === "owner" || role === "admin";
  const hasChanges = Object.keys(draft).length > 0;

  function getStatus(featureKey: FeatureKey) {
    return draft[featureKey] ?? access?.[featureKey]?.status ?? "enabled";
  }

  function updateDraft(featureKey: FeatureKey, status: FeatureStatus) {
    setSuccess(null);
    setDraft((current) => ({
      ...current,
      [featureKey]: status,
    }));
  }

  async function handleSave() {
    if (!tenant || !hasChanges) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const response = await bulkUpdateTenantFeatureAccess(tenant.id, draft);
      setAccess(featureListToMap(response.features));
      setDraft({});
      setSuccess("Feature settings updated.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Feature settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-[#D8E8F0] bg-white p-6 text-sm font-medium text-[#5D7185]">
        Loading feature settings...
      </section>
    );
  }

  if (!canManage) {
    return (
      <section className="rounded-2xl border border-[#D8E8F0] bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#0B2A3D]">
          Feature settings are restricted.
        </h2>
        <p className="mt-3 text-sm text-[#5D7185]">
          Only workspace owners and admins can manage module availability.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#D8E8F0] bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#145DA0]">
              Workspace settings
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-[#0B2A3D]">
              Feature Access
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#5D7185]">
              Enable or disable optional modules for this workspace. Core
              workspace features remain enabled. Payment gateway and live class
              provider integrations remain placeholders until those modules are
              implemented.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {success ? (
              <span className="rounded-full bg-[#E7F8EE] px-3 py-1 text-sm font-semibold text-[#1F7A4D]">
                {success}
              </span>
            ) : null}
            <Button
              disabled={!hasChanges || saving}
              onClick={handleSave}
              type="button"
            >
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>
        {error ? (
          <div className="mt-5 rounded-xl border border-[#F5B8B8] bg-[#FFF5F5] p-4 text-sm font-medium text-[#A13D3D]">
            {error}
          </div>
        ) : null}
      </section>

      {Object.entries(groupedFeatures).map(([section, features]) => (
        <section
          className="rounded-2xl border border-[#D8E8F0] bg-white p-6 shadow-sm"
          key={section}
        >
          <h2 className="text-lg font-semibold text-[#0B2A3D]">{section}</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {features.map((feature) => {
              const currentStatus = getStatus(feature.key);
              const persistedStatus = access?.[feature.key]?.status ?? "enabled";
              const locked =
                feature.required ||
                persistedStatus === "locked_by_plan" ||
                persistedStatus === "coming_soon";

              return (
                <article
                  className="rounded-2xl border border-[#D8E8F0] bg-[#F8FCFE] p-4"
                  key={feature.key}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-[#0B2A3D]">
                        {feature.label}
                      </h3>
                      <p className="mt-2 text-sm leading-5 text-[#5D7185]">
                        {feature.description}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#425B76] ring-1 ring-[#D8E8F0]">
                      {getFeatureStatusLabel(currentStatus)}
                    </span>
                  </div>
                  <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.16em] text-[#7890A8]">
                    Status
                  </label>
                  <select
                    className="mt-2 w-full rounded-xl border border-[#D8E8F0] bg-white px-3 py-2 text-sm font-semibold text-[#0B2A3D] outline-none focus:border-[#2ECBEA] focus:ring-2 focus:ring-[#2ECBEA]/20 disabled:cursor-not-allowed disabled:bg-[#EEF4F8] disabled:text-[#7890A8]"
                    disabled={locked}
                    onChange={(event) =>
                      updateDraft(feature.key, event.target.value as FeatureStatus)
                    }
                    value={currentStatus}
                  >
                    {locked ? (
                      <option value={currentStatus}>
                        {getFeatureStatusLabel(currentStatus)}
                      </option>
                    ) : (
                      manageableStatuses.map((status) => (
                        <option key={status} value={status}>
                          {getFeatureStatusLabel(status)}
                        </option>
                      ))
                    )}
                  </select>
                  {feature.required ? (
                    <p className="mt-3 text-xs font-medium text-[#7890A8]">
                      Core workspace feature.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
