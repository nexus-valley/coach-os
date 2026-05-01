"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  canManageTeam,
  getCurrentMemberRole,
  getTenantMembers,
  removeTenantMember,
  updateTenantMemberRole,
  type MemberRole,
  type TenantMemberWithProfile,
} from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import {
  defaultTenantBrandColor,
  getTenantSettings,
  getSafeTenantBrandColor,
  updateTenantSettings,
  type TenantSettings,
} from "@/src/lib/tenantSettings";

const manageableRoles: Exclude<MemberRole, "owner">[] = ["admin", "staff"];

type BrandingFormState = {
  brandColor: string;
  logoUrl: string;
  name: string;
  supportEmail: string;
  supportPhone: string;
  websiteUrl: string;
};

const emptyBrandingForm: BrandingFormState = {
  brandColor: defaultTenantBrandColor,
  logoUrl: "",
  name: "",
  supportEmail: "",
  supportPhone: "",
  websiteUrl: "",
};

const roleDefinitions: {
  description: string;
  role: MemberRole;
  title: string;
}[] = [
  {
    description:
      "Full workspace control, including team role changes and member removal.",
    role: "owner",
    title: "Owner",
  },
  {
    description:
      "Can manage operating modules like courses, students, cohorts, enrollments, and payments.",
    role: "admin",
    title: "Admin",
  },
  {
    description:
      "Can work with student and enrollment workflows, with destructive and settings controls hidden.",
    role: "staff",
    title: "Staff",
  },
];

function RoleBadge({ role }: { role: MemberRole }) {
  const label = role.charAt(0).toUpperCase() + role.slice(1);

  if (role === "owner") {
    return (
      <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
        {label}
      </Badge>
    );
  }

  if (role === "admin") {
    return (
      <Badge className="border-[#145DA0]/25 bg-[#145DA0]/10 text-[#145DA0]">
        {label}
      </Badge>
    );
  }

  return (
    <Badge className="border-[#D8E8F0] bg-[#F6FBFE] text-[#425B76]">
      {label}
    </Badge>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function createBrandingForm(settings: TenantSettings): BrandingFormState {
  return {
    brandColor: getSafeTenantBrandColor(settings.brand_color),
    logoUrl: settings.logo_url ?? "",
    name: settings.name,
    supportEmail: settings.support_email ?? "",
    supportPhone: settings.support_phone ?? "",
    websiteUrl: settings.website_url ?? "",
  };
}

function getPreviewBrandColor(value: string) {
  return getSafeTenantBrandColor(value);
}

function createCurrentUserMember(params: {
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  tenantId: string;
  userId: string;
}): TenantMemberWithProfile {
  return {
    created_at: new Date().toISOString(),
    id: params.userId,
    profile: {
      avatar_url: null,
      email: params.email,
      full_name: params.fullName,
      id: params.userId,
    },
    role: params.role,
    tenant_id: params.tenantId,
    user_id: params.userId,
  };
}

export function TeamSettingsClient() {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [brandingForm, setBrandingForm] =
    useState<BrandingFormState>(emptyBrandingForm);
  const [brandingMessage, setBrandingMessage] = useState("");
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<TenantMemberWithProfile[]>([]);
  const [mutatingMemberId, setMutatingMemberId] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenantSettings, setTenantSettings] =
    useState<TenantSettings | null>(null);

  const loadTeam = useCallback(async (currentTenant: Tenant) => {
    const supabase = getSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      router.replace("/login");
      return;
    }

    const role = await getCurrentMemberRole(currentTenant.id, user.id);

    if (!role) {
      throw new Error("Your team role could not be loaded.");
    }

    setCurrentUserId(user.id);
    setCurrentRole(role);

    if (role === "staff") {
      setMembers([
        createCurrentUserMember({
          email: user.email ?? null,
          fullName:
            typeof user.user_metadata.full_name === "string"
              ? user.user_metadata.full_name
              : null,
          role,
          tenantId: currentTenant.id,
          userId: user.id,
        }),
      ]);
      return;
    }

    setMembers(await getTenantMembers(currentTenant.id));
  }, [router]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const settings = await getTenantSettings(currentTenant.id);

        if (!active) {
          return;
        }

        if (settings) {
          setBrandingForm(createBrandingForm(settings));
          setTenantSettings(settings);
        }

        setTenant(currentTenant);
        await loadTeam(currentTenant);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load team settings."));
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
  }, [loadTeam, router]);

  async function refreshTeam() {
    if (!tenant) {
      return;
    }

    await loadTeam(tenant);
  }

  async function handleRoleChange(
    member: TenantMemberWithProfile,
    role: Exclude<MemberRole, "owner">,
  ) {
    if (!tenant || !canManageTeam(currentRole)) {
      return;
    }

    setMutatingMemberId(member.id);
    setActionError("");

    try {
      await updateTenantMemberRole(tenant.id, member.id, role);
      await refreshTeam();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to update member role."));
    } finally {
      setMutatingMemberId("");
    }
  }

  async function handleRemoveMember(member: TenantMemberWithProfile) {
    if (!tenant || !canManageTeam(currentRole)) {
      return;
    }

    const confirmed = window.confirm("Remove this team member?");

    if (!confirmed) {
      return;
    }

    setMutatingMemberId(member.id);
    setActionError("");

    try {
      await removeTenantMember(tenant.id, member.id);
      await refreshTeam();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to remove team member."));
    } finally {
      setMutatingMemberId("");
    }
  }

  function handleBrandingChange(
    field: keyof BrandingFormState,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    setBrandingMessage("");
    setActionError("");
    setBrandingForm((currentForm) => ({
      ...currentForm,
      [field]: event.target.value,
    }));
  }

  async function handleBrandingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !canManageTeam(currentRole)) {
      return;
    }

    setActionError("");
    setBrandingMessage("");
    setBrandingSaving(true);

    try {
      const updatedSettings = await updateTenantSettings(
        tenant.id,
        brandingForm,
      );

      setTenantSettings(updatedSettings);
      setBrandingForm(createBrandingForm(updatedSettings));
      setTenant((currentTenant) =>
        currentTenant ? { ...currentTenant, name: updatedSettings.name } : null,
      );
      setBrandingMessage("Workspace branding saved.");
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to save workspace branding."),
      );
    } finally {
      setBrandingSaving(false);
    }
  }

  const canManage = canManageTeam(currentRole);
  const previewBrandColor = getPreviewBrandColor(brandingForm.brandColor);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-white/10 bg-[#101214]">
          <span className="sr-only">Loading team settings</span>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            Settings
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Team & permissions
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Manage visible team roles for this workspace. RLS remains the
            backend authority for tenant isolation.
          </p>
        </div>
        {currentRole ? <RoleBadge role={currentRole} /> : null}
      </div>

      {error ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {actionError ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {actionError}
        </div>
      ) : null}

      {brandingMessage ? (
        <div className="mt-6 rounded-3xl border border-teal-400/30 bg-teal-400/10 p-4 text-sm text-teal-100">
          {brandingMessage}
        </div>
      ) : null}

      <section className="mt-8 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Workspace Branding
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Business identity
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Set the logo, accent color, and support details that appear
                across customer-facing workspace surfaces.
              </p>
            </div>
            <p className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-slate-300">
              {canManage ? "Owner editable" : "Read only"}
            </p>
          </div>

          <form className="mt-7 grid gap-5" onSubmit={handleBrandingSubmit}>
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-300">
                Workspace Name
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                  disabled={!canManage || brandingSaving}
                  onChange={(event) => handleBrandingChange("name", event)}
                  placeholder="Nexus Valley Academy"
                  required
                  value={brandingForm.name}
                />
              </label>

              <label className="block text-sm font-medium text-slate-300">
                Brand Color
                <div className="mt-2 flex gap-3">
                  <input
                    aria-label="Brand color picker"
                    className="h-11 w-14 rounded-2xl border border-white/10 bg-white/10 p-1 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canManage || brandingSaving}
                    onChange={(event) =>
                      handleBrandingChange("brandColor", event)
                    }
                    type="color"
                    value={previewBrandColor}
                  />
                  <input
                    className="h-11 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                    disabled={!canManage || brandingSaving}
                    onChange={(event) =>
                      handleBrandingChange("brandColor", event)
                    }
                    placeholder="#14b8a6"
                    value={brandingForm.brandColor}
                  />
                </div>
              </label>
            </div>

            <label className="block text-sm font-medium text-slate-300">
              Logo URL
              <input
                className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                disabled={!canManage || brandingSaving}
                onChange={(event) => handleBrandingChange("logoUrl", event)}
                placeholder="https://example.com/logo.png"
                type="url"
                value={brandingForm.logoUrl}
              />
            </label>

            <div className="grid gap-5 md:grid-cols-3">
              <label className="block text-sm font-medium text-slate-300">
                Support Email
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                  disabled={!canManage || brandingSaving}
                  onChange={(event) =>
                    handleBrandingChange("supportEmail", event)
                  }
                  placeholder="support@example.com"
                  type="email"
                  value={brandingForm.supportEmail}
                />
              </label>

              <label className="block text-sm font-medium text-slate-300">
                Support Phone
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                  disabled={!canManage || brandingSaving}
                  onChange={(event) =>
                    handleBrandingChange("supportPhone", event)
                  }
                  placeholder="+1 555 0100"
                  value={brandingForm.supportPhone}
                />
              </label>

              <label className="block text-sm font-medium text-slate-300">
                Website URL
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                  disabled={!canManage || brandingSaving}
                  onChange={(event) => handleBrandingChange("websiteUrl", event)}
                  placeholder="https://example.com"
                  type="url"
                  value={brandingForm.websiteUrl}
                />
              </label>
            </div>

            {canManage ? (
              <div className="flex justify-end">
                <Button disabled={brandingSaving} type="submit">
                  {brandingSaving ? "Saving..." : "Save Branding"}
                </Button>
              </div>
            ) : null}
          </form>
        </Card>

        <Card className="border-white/10 bg-[#15181b] p-6 text-white shadow-2xl shadow-black/10">
          <Badge
            className="bg-white/5"
            style={{
              borderColor: `${previewBrandColor}55`,
              color: previewBrandColor,
            }}
          >
            Live Preview
          </Badge>
          <div className="mt-7 rounded-3xl border border-white/10 bg-[#101214] p-6">
            {brandingForm.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${brandingForm.name || "Workspace"} logo`}
                className="h-14 w-14 rounded-2xl border border-white/10 object-cover"
                src={brandingForm.logoUrl}
              />
            ) : (
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl text-sm font-bold text-black"
                style={{ backgroundColor: previewBrandColor }}
              >
                {brandingForm.name.trim().slice(0, 2).toUpperCase() || "CO"}
              </div>
            )}
            <h3 className="mt-5 text-2xl font-semibold">
              {brandingForm.name || tenant?.name || "Workspace"}
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              {tenantSettings?.slug ?? "workspace"} · CoachOS workspace
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <span
                className="rounded-full border px-3 py-1 text-xs font-semibold"
                style={{
                  borderColor: `${previewBrandColor}55`,
                  color: previewBrandColor,
                }}
              >
                Branded badge
              </span>
              <span
                className="inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold text-black"
                style={{ backgroundColor: previewBrandColor }}
              >
                Primary action
              </span>
            </div>
          </div>
          {!canManage ? (
            <p className="mt-5 text-sm leading-6 text-slate-400">
              Branding can be edited by workspace owners only. Your current
              role can view these settings.
            </p>
          ) : null}
        </Card>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-[0.75fr_1.25fr]">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <p className="text-sm font-medium text-slate-400">
            Current workspace
          </p>
          <h3 className="mt-3 text-2xl font-semibold">
            {tenant?.name ?? "Workspace"}
          </h3>
          <div className="mt-6 rounded-3xl border border-teal-400/30 bg-teal-400/10 p-5">
            <p className="text-sm font-semibold text-teal-300">
              Your role
            </p>
            <div className="mt-3">
              {currentRole ? <RoleBadge role={currentRole} /> : null}
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              {currentRole === "owner"
                ? "You can manage team roles and remove admin or staff members."
                : currentRole === "admin"
                  ? "You can view the team list, but only owners can change roles."
                  : "You can view your own workspace role. Team management is owner-only."}
            </p>
          </div>
        </Card>

        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Team members
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">Workspace team</h3>
            </div>
            <p className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-slate-300">
              {members.length} visible
            </p>
          </div>

          <div className="mt-7 divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10">
            {members.map((member) => {
              const isSelf = member.user_id === currentUserId;
              const ownerMember = member.role === "owner";
              const canEditMember = canManage && !isSelf && !ownerMember;
              const displayName =
                member.profile?.full_name ||
                member.profile?.email ||
                (isSelf ? "You" : "Team member");

              return (
                <div
                  className="grid gap-4 bg-[#101214] p-4 lg:grid-cols-[1fr_auto_auto] lg:items-center"
                  key={member.id}
                >
                  <div>
                    <p className="font-semibold text-white">{displayName}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      {member.profile?.email || member.user_id}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Joined {formatDate(member.created_at)}
                    </p>
                  </div>

                  {canEditMember ? (
                    <select
                      className="h-10 rounded-full border border-white/10 bg-white/10 px-3 text-sm font-semibold text-white outline-none transition focus:border-teal-400/40 focus:ring-4 focus:ring-teal-400/10"
                      disabled={mutatingMemberId === member.id}
                      onChange={(event) =>
                        handleRoleChange(
                          member,
                          event.target.value as Exclude<MemberRole, "owner">,
                        )
                      }
                      value={member.role}
                    >
                      {manageableRoles.map((role) => (
                        <option
                          className="text-slate-950"
                          key={role}
                          value={role}
                        >
                          {role}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <RoleBadge role={member.role} />
                  )}

                  {canEditMember ? (
                    <Button
                      className="text-red-300! hover:bg-red-500/10! hover:text-red-200!"
                      disabled={mutatingMemberId === member.id}
                      onClick={() => handleRemoveMember(member)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  ) : (
                    <p className="text-sm text-slate-500">
                      {isSelf ? "Current user" : "View only"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {roleDefinitions.map((definition) => (
          <Card
            className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10"
            key={definition.role}
          >
            <RoleBadge role={definition.role} />
            <h3 className="mt-5 text-xl font-semibold">{definition.title}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {definition.description}
            </p>
          </Card>
        ))}
      </section>
    </div>
  );
}
