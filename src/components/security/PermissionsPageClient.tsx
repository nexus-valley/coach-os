"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  createDelegatedPermission,
  delegatedPermissionKeys,
  delegatedPermissionLabels,
  delegatedPermissionScopeLabels,
  delegatedPermissionScopeTypes,
  getDelegatedPermissions,
  getEffectivePermissions,
  getUserDelegatedPermissions,
  revokeDelegatedPermission,
  type DelegatedPermission,
  type DelegatedPermissionKey,
  type DelegatedPermissionScopeType,
  type DelegatedPermissionWithUser,
  type EffectivePermission,
} from "@/src/lib/delegatedPermissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  getCurrentMemberRole,
  getTenantMembers,
  type MemberRole,
  type TenantMemberWithProfile,
} from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type GrantFormState = {
  expiresAt: string;
  permissionKey: DelegatedPermissionKey;
  reason: string;
  scopeId: string;
  scopeType: DelegatedPermissionScopeType;
  startsAt: string;
  userId: string;
};

type DisplayPermission =
  | DelegatedPermissionWithUser
  | (DelegatedPermission & { user?: DelegatedPermissionWithUser["user"] });

const emptyForm: GrantFormState = {
  expiresAt: "",
  permissionKey: "view_reports",
  reason: "",
  scopeId: "",
  scopeType: "workspace",
  startsAt: "",
  userId: "",
};

function formatDate(value: string | null) {
  if (!value) {
    return "No expiry";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDateTimeInput(value: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function toIsoOrNull(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function getStatusTone(status: DelegatedPermission["status"]) {
  if (status === "active") {
    return "success" as const;
  }

  if (status === "revoked") {
    return "danger" as const;
  }

  return "warning" as const;
}

function getUserLabel(
  permission: DisplayPermission,
  teamMembers: TenantMemberWithProfile[],
) {
  const knownUser = teamMembers.find((member) => member.user_id === permission.user_id);
  const name =
    permission.user?.full_name ??
    knownUser?.profile?.full_name ??
    permission.user?.email ??
    knownUser?.profile?.email ??
    "Workspace member";

  return `${name} (${permission.user?.role ?? knownUser?.role ?? "member"})`;
}

function getScopeLabel(permission: DisplayPermission) {
  if (!permission.scope_type || permission.scope_type === "workspace") {
    return "Workspace";
  }

  return `${delegatedPermissionScopeLabels[permission.scope_type]} ${permission.scope_id?.slice(0, 8) ?? ""}`;
}

function PermissionList({
  currentUserId,
  currentRole,
  onRevoke,
  permissions,
  revokingId,
  teamMembers,
}: {
  currentUserId: string | null;
  currentRole: MemberRole | null;
  onRevoke: (permissionId: string) => void;
  permissions: DisplayPermission[];
  revokingId: string;
  teamMembers: TenantMemberWithProfile[];
}) {
  if (!permissions.length) {
    return (
      <EmptyState
        description="No delegated permission exceptions are active or pending for this view."
        icon="PE"
        title="No extra permissions yet"
      />
    );
  }

  return (
    <div className="grid gap-4">
      {permissions.map((permission) => {
        const canRevoke =
          currentRole === "owner"
            ? permission.status !== "revoked"
            : currentRole === "admin" &&
              permission.status === "pending" &&
              permission.granted_by === currentUserId;
        const revokeLabel =
          currentRole === "admin" ? "Withdraw" : "Revoke";

        return (
        <Card className="p-5" key={permission.id}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-[#0B1F33]">
                  {delegatedPermissionLabels[permission.permission_key]}
                </h3>
                <Badge tone={getStatusTone(permission.status)}>
                  {permission.status}
                </Badge>
                {permission.scope_type === "workspace" || !permission.scope_type ? (
                  <Badge tone="warning">Broad workspace scope</Badge>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-[#425B76]">
                {getUserLabel(permission, teamMembers)}
              </p>
              <div className="mt-4 grid gap-3 text-sm text-[#425B76] sm:grid-cols-2 lg:grid-cols-4">
                <span>
                  <strong className="text-[#0B1F33]">Scope:</strong>{" "}
                  {getScopeLabel(permission)}
                </span>
                <span>
                  <strong className="text-[#0B1F33]">Starts:</strong>{" "}
                  {formatDate(permission.starts_at)}
                </span>
                <span>
                  <strong className="text-[#0B1F33]">Expires:</strong>{" "}
                  {formatDate(permission.expires_at)}
                </span>
                <span>
                  <strong className="text-[#0B1F33]">Reason:</strong>{" "}
                  {permission.reason || "Not provided"}
                </span>
              </div>
            </div>
            {canRevoke ? (
              <Button
                disabled={revokingId === permission.id}
                onClick={() => onRevoke(permission.id)}
                size="sm"
                type="button"
                variant="secondary"
              >
                {revokingId === permission.id ? "Updating..." : revokeLabel}
              </Button>
            ) : null}
          </div>
        </Card>
        );
      })}
    </div>
  );
}

export function PermissionsPageClient() {
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [effectivePermissions, setEffectivePermissions] = useState<
    EffectivePermission[]
  >([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState<GrantFormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<DisplayPermission[]>([]);
  const [revokingId, setRevokingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [teamMembers, setTeamMembers] = useState<TenantMemberWithProfile[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const canManage = currentRole === "owner" || currentRole === "admin";
  const activeDelegatedCount = useMemo(
    () =>
      permissions.filter((permission) => permission.status === "active").length,
    [permissions],
  );

  async function loadPermissions() {
    const currentTenant = await getCurrentTenant();

    if (!currentTenant) {
      throw new Error("Workspace context is not available.");
    }

    const supabase = getSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      throw new Error("You must be logged in to view permissions.");
    }

    const role = await getCurrentMemberRole(currentTenant.id, user.id);
    const members =
      role === "owner" || role === "admin"
        ? await getTenantMembers(currentTenant.id)
        : [];
    const rows =
      role === "owner" || role === "admin"
        ? await getDelegatedPermissions(currentTenant.id)
        : await getUserDelegatedPermissions(currentTenant.id, user.id);
    const effective = await getEffectivePermissions(currentTenant.id, user.id);

    setCurrentRole(role);
    setCurrentUserId(user.id);
    setEffectivePermissions(effective);
    setForm((current) => ({
      ...current,
      userId: current.userId || members[0]?.user_id || user.id,
    }));
    setPermissions(rows);
    setTeamMembers(members);
    setTenant(currentTenant);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        await loadPermissions();

        if (active) {
          setError("");
        }
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load delegated permissions.",
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

  async function handleCreatePermission(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await createDelegatedPermission({
        expiresAt: toIsoOrNull(form.expiresAt),
        permissionKey: form.permissionKey,
        reason: form.reason,
        scopeId: form.scopeType === "workspace" ? null : form.scopeId.trim(),
        scopeType: form.scopeType,
        startsAt: toIsoOrNull(form.startsAt),
        tenantId: tenant.id,
        userId: form.userId,
      });

      await loadPermissions();
      setForm((current) => ({
        ...emptyForm,
        userId: current.userId,
      }));
      setSuccess(
        currentRole === "owner"
          ? "Delegated permission granted."
          : "Delegated permission request created for owner approval.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to save delegated permission.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(permissionId: string) {
    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    setRevokingId(permissionId);
    setError("");
    setSuccess("");

    try {
      await revokeDelegatedPermission(tenant.id, permissionId);
      await loadPermissions();
      setSuccess("Delegated permission revoked.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to revoke delegated permission.",
      );
    } finally {
      setRevokingId("");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse p-6">
          <span className="sr-only">Loading permissions</span>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="rounded-[2rem] border border-[#BFDDF5] bg-[linear-gradient(135deg,#EAF8FC,#FFFFFF)] p-6 shadow-2xl shadow-[#0B2A3D]/10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge tone="light">Security</Badge>
            <h1 className="mt-4 text-3xl font-semibold text-[#0B1F33]">
              Delegated Permissions
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#425B76]">
              Grant narrow, auditable exceptions without changing a member&apos;s
              base workspace role.
            </p>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Card className="rounded-2xl p-4 shadow-none">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5D7185]">
                Active exceptions
              </p>
              <p className="mt-2 text-2xl font-semibold text-[#0B1F33]">
                {activeDelegatedCount}
              </p>
            </Card>
            <Card className="rounded-2xl p-4 shadow-none">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5D7185]">
                Effective permissions
              </p>
              <p className="mt-2 text-2xl font-semibold text-[#0B1F33]">
                {effectivePermissions.length}
              </p>
            </Card>
          </div>
        </div>
      </section>

      {error ? <FeedbackAlert>{error}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      {canManage ? (
        <Card className="p-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold text-[#0B1F33]">
              Grant Exception
            </h2>
            <p className="text-sm text-[#5D7185]">
              Owner grants activate immediately. Admin requests are stored as
              pending for the approval foundation.
            </p>
          </div>
          <form
            className="mt-6 grid gap-4 lg:grid-cols-2"
            onSubmit={handleCreatePermission}
          >
            <label className="text-sm font-semibold text-[#0B1F33]">
              Target user
              <select
                className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
                required
                value={form.userId}
              >
                {teamMembers.map((member) => (
                  <option key={member.id} value={member.user_id}>
                    {member.profile?.full_name ??
                      member.profile?.email ??
                      member.user_id}{" "}
                    ({member.role})
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-semibold text-[#0B1F33]">
              Permission
              <select
                className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    permissionKey: event.target.value as DelegatedPermissionKey,
                  }))
                }
                value={form.permissionKey}
              >
                {delegatedPermissionKeys.map((key) => (
                  <option key={key} value={key}>
                    {delegatedPermissionLabels[key]}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-semibold text-[#0B1F33]">
              Scope
              <select
                className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scopeId: "",
                    scopeType: event.target.value as DelegatedPermissionScopeType,
                  }))
                }
                value={form.scopeType}
              >
                {delegatedPermissionScopeTypes.map((scope) => (
                  <option key={scope} value={scope}>
                    {delegatedPermissionScopeLabels[scope]}
                  </option>
                ))}
              </select>
            </label>

            {form.scopeType !== "workspace" ? (
              <label className="text-sm font-semibold text-[#0B1F33]">
                Scope ID
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      scopeId: event.target.value,
                    }))
                  }
                  placeholder={`${form.scopeType} UUID`}
                  required
                  value={form.scopeId}
                />
              </label>
            ) : null}

            <label className="text-sm font-semibold text-[#0B1F33]">
              Starts at
              <input
                className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    startsAt: event.target.value,
                  }))
                }
                type="datetime-local"
                value={formatDateTimeInput(form.startsAt)}
              />
            </label>

            <label className="text-sm font-semibold text-[#0B1F33]">
              Expires at
              <input
                className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    expiresAt: event.target.value,
                  }))
                }
                type="datetime-local"
                value={formatDateTimeInput(form.expiresAt)}
              />
            </label>

            <label className="text-sm font-semibold text-[#0B1F33] lg:col-span-2">
              Reason
              <textarea
                className="mt-2 min-h-24 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 py-3 text-sm"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                placeholder="Why is this exception needed?"
                value={form.reason}
              />
            </label>

            <div className="lg:col-span-2">
              <Button disabled={saving || !form.userId} type="submit">
                {saving ? "Saving..." : "Grant Permission"}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <FeedbackAlert tone="warning">
          Grant controls are restricted to workspace owners and admins. Your
          active delegated permissions are listed below.
        </FeedbackAlert>
      )}

      <section>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#0B1F33]">
              {canManage ? "Workspace Exceptions" : "My Extra Permissions"}
            </h2>
            <p className="text-sm text-[#5D7185]">
              Expired and revoked permissions do not apply to effective access.
            </p>
          </div>
        </div>
        <PermissionList
          currentUserId={currentUserId}
          currentRole={currentRole}
          onRevoke={handleRevoke}
          permissions={permissions}
          revokingId={revokingId}
          teamMembers={teamMembers}
        />
      </section>
    </div>
  );
}
