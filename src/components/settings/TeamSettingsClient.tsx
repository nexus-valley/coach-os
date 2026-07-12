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
import { getCohortsForTenant, type CohortWithCourse } from "@/src/lib/cohorts";
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import {
  canAccessSettings,
  canInviteTeam,
  canManageWorkspace,
  getRoleDescription,
} from "@/src/lib/permissions";
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
  getWorkspaceBranding,
  getSafeTenantBrandColor,
  updateTenantSettings,
  type TenantSettings,
} from "@/src/lib/tenantSettings";
import {
  buildInvitationLink,
  createTeamInvitation,
  listTeamInvitations,
  resendTeamInvitation,
  revokeTeamInvitation,
  type InvitationRole,
  type TeamInvitation,
} from "@/src/lib/teamInvitations";
import {
  assignTrainerToCohort,
  assignTrainerToCourse,
  getTrainerAssignedCohorts,
  getTrainerAssignedCourses,
  removeTrainerFromCohort,
  removeTrainerFromCourse,
  type TrainerCohortAssignment,
  type TrainerCourseAssignment,
} from "@/src/lib/trainerAssignments";

const manageableRoles: Exclude<MemberRole, "owner">[] = [
  "admin",
  "staff",
  "trainer",
];

const invitationRoles: InvitationRole[] = ["admin", "staff", "trainer"];

type BrandingFormState = {
  addressLine1: string;
  addressLine2: string;
  brandColor: string;
  certificateIssuerName: string;
  city: string;
  country: string;
  logoUrl: string;
  postalCode: string;
  receiptFooterText: string;
  state: string;
  supportEmail: string;
  supportPhone: string;
  websiteUrl: string;
  whatsappNumber: string;
  workspaceDisplayName: string;
};

const emptyBrandingForm: BrandingFormState = {
  addressLine1: "",
  addressLine2: "",
  brandColor: defaultTenantBrandColor,
  certificateIssuerName: "",
  city: "",
  country: "",
  logoUrl: "",
  postalCode: "",
  receiptFooterText: "",
  state: "",
  supportEmail: "",
  supportPhone: "",
  websiteUrl: "",
  whatsappNumber: "",
  workspaceDisplayName: "",
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
  {
    description:
      "Training-focused access for assigned course, cohort, and student workflows without billing or workspace settings.",
    role: "trainer",
    title: "Trainer",
  },
];

function RoleBadge({ role }: { role: MemberRole }) {
  const label = role.charAt(0).toUpperCase() + role.slice(1);

  if (role === "owner") {
    return <Badge tone="owner">{label}</Badge>;
  }

  if (role === "admin") {
    return <Badge tone="admin">{label}</Badge>;
  }

  if (role === "trainer") {
    return <Badge tone="trainer">{label}</Badge>;
  }

  return <Badge tone="staff">{label}</Badge>;
}

function InvitationStatusBadge({ status }: { status: TeamInvitation["status"] }) {
  if (status === "accepted") {
    return <Badge tone="success">Accepted</Badge>;
  }

  if (status === "revoked") {
    return <Badge tone="danger">Revoked</Badge>;
  }

  if (status === "expired") {
    return <Badge tone="warning">Expired</Badge>;
  }

  return <Badge>Pending</Badge>;
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
  const branding = getWorkspaceBranding(settings);

  return {
    addressLine1: settings.address_line_1 ?? "",
    addressLine2: settings.address_line_2 ?? "",
    brandColor: getSafeTenantBrandColor(settings.brand_color),
    certificateIssuerName: settings.certificate_issuer_name ?? "",
    city: settings.city ?? "",
    country: settings.country ?? "",
    logoUrl: settings.logo_url ?? "",
    postalCode: settings.postal_code ?? "",
    receiptFooterText: settings.receipt_footer_text ?? "",
    state: settings.state ?? "",
    supportEmail: settings.support_email ?? "",
    supportPhone: settings.support_phone ?? "",
    websiteUrl: settings.website_url ?? "",
    whatsappNumber: settings.whatsapp_number ?? "",
    workspaceDisplayName: branding.displayName,
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
  const [cohorts, setCohorts] = useState<CohortWithCourse[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteRole, setInviteRole] = useState<InvitationRole>("staff");
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<TenantMemberWithProfile[]>([]);
  const [mutatingInvitationId, setMutatingInvitationId] = useState("");
  const [mutatingMemberId, setMutatingMemberId] = useState("");
  const [selectedCohortByTrainer, setSelectedCohortByTrainer] = useState<
    Record<string, string>
  >({});
  const [selectedCourseByTrainer, setSelectedCourseByTrainer] = useState<
    Record<string, string>
  >({});
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenantSettings, setTenantSettings] =
    useState<TenantSettings | null>(null);
  const [trainerCohortAssignments, setTrainerCohortAssignments] = useState<
    Record<string, TrainerCohortAssignment[]>
  >({});
  const [trainerCourseAssignments, setTrainerCourseAssignments] = useState<
    Record<string, TrainerCourseAssignment[]>
  >({});

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

    if (!canAccessSettings(role)) {
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
      return role;
    }

    const tenantMembers = await getTenantMembers(currentTenant.id);
    setMembers(tenantMembers);
    return role;
  }, [router]);

  const loadInvitations = useCallback(async (currentTenant: Tenant) => {
    setInvitations(await listTeamInvitations(currentTenant.id));
  }, []);

  const loadTrainerAssignments = useCallback(
    async (currentTenant: Tenant, visibleMembers: TenantMemberWithProfile[]) => {
      const trainers = visibleMembers.filter(
        (member) => member.role === "trainer",
      );

      if (trainers.length === 0) {
        setTrainerCourseAssignments({});
        setTrainerCohortAssignments({});
        return;
      }

      const pairs = await Promise.all(
        trainers.map(async (trainer) => {
          const [assignedCourses, assignedCohorts] = await Promise.all([
            getTrainerAssignedCourses(currentTenant.id, trainer.user_id),
            getTrainerAssignedCohorts(currentTenant.id, trainer.user_id),
          ]);

          return {
            assignedCohorts,
            assignedCourses,
            trainerId: trainer.user_id,
          };
        }),
      );

      setTrainerCourseAssignments(
        Object.fromEntries(
          pairs.map((item) => [item.trainerId, item.assignedCourses]),
        ),
      );
      setTrainerCohortAssignments(
        Object.fromEntries(
          pairs.map((item) => [item.trainerId, item.assignedCohorts]),
        ),
      );
    },
    [],
  );

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

        setTenant(currentTenant);
        const role = await loadTeam(currentTenant);

        if (!active || !role) {
          return;
        }

        if (!canAccessSettings(role)) {
          const settings = await getTenantSettings(currentTenant.id);

          if (!active) {
            return;
          }

          if (settings) {
            setBrandingForm(createBrandingForm(settings));
            setTenantSettings(settings);
          }

          return;
        }

        const [
          settings,
          tenantCourses,
          tenantCohorts,
          tenantMembers,
          tenantInvitations,
        ] =
          await Promise.all([
            getTenantSettings(currentTenant.id),
            getCoursesForTenant(currentTenant.id),
            getCohortsForTenant(currentTenant.id),
            getTenantMembers(currentTenant.id),
            canInviteTeam(role)
              ? listTeamInvitations(currentTenant.id)
              : Promise.resolve([]),
          ]);

        if (!active) {
          return;
        }

        setCourses(tenantCourses);
        setCohorts(tenantCohorts);
        setMembers(tenantMembers);
        setInvitations(tenantInvitations);
        await loadTrainerAssignments(currentTenant, tenantMembers);

        if (settings) {
          setBrandingForm(createBrandingForm(settings));
          setTenantSettings(settings);
        }
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
  }, [loadInvitations, loadTeam, loadTrainerAssignments, router]);

  async function refreshTeam() {
    if (!tenant) {
      return;
    }

    await loadTeam(tenant);
  }

  async function refreshInvitations() {
    if (!tenant || !canInviteTeam(currentRole)) {
      return;
    }

    await loadInvitations(tenant);
  }

  async function handleCreateInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !canInviteTeam(currentRole)) {
      return;
    }

    setActionError("");
    setInviteMessage("");
    setMutatingInvitationId("new");

    try {
      const invitation = await createTeamInvitation({
        email: inviteEmail,
        role: inviteRole,
        tenantId: tenant.id,
      });

      const inviteLink = buildInvitationLink(invitation.token);
      setInviteEmail("");
      setInviteRole("staff");
      setInviteMessage(
        `Invitation ready for ${invitation.email}. Copy link: ${inviteLink}`,
      );
      await refreshInvitations();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to create invitation."));
    } finally {
      setMutatingInvitationId("");
    }
  }

  async function handleCopyInvitation(invitation: TeamInvitation) {
    setActionError("");

    try {
      await navigator.clipboard.writeText(buildInvitationLink(invitation.token));
      setInviteMessage(`Invite link copied for ${invitation.email}.`);
    } catch {
      setActionError("Unable to copy invite link. Select and copy it manually.");
    }
  }

  async function handleResendInvitation(invitation: TeamInvitation) {
    if (!tenant || !canInviteTeam(currentRole)) {
      return;
    }

    setActionError("");
    setInviteMessage("");
    setMutatingInvitationId(invitation.id);

    try {
      const refreshedInvitation = await resendTeamInvitation(invitation.id);
      setInviteMessage(
        `Invitation refreshed for ${refreshedInvitation.email}. Copy the new secure link.`,
      );
      await refreshInvitations();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to resend invitation."));
    } finally {
      setMutatingInvitationId("");
    }
  }

  async function handleRevokeInvitation(invitation: TeamInvitation) {
    if (!tenant || !canInviteTeam(currentRole)) {
      return;
    }

    const confirmed = window.confirm(
      `Revoke the pending invitation for ${invitation.email}?`,
    );

    if (!confirmed) {
      return;
    }

    setActionError("");
    setInviteMessage("");
    setMutatingInvitationId(invitation.id);

    try {
      await revokeTeamInvitation(invitation.id);
      setInviteMessage(`Invitation revoked for ${invitation.email}.`);
      await refreshInvitations();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to revoke invitation."));
    } finally {
      setMutatingInvitationId("");
    }
  }

  async function handleRoleChange(
    member: TenantMemberWithProfile,
    role: Exclude<MemberRole, "owner">,
  ) {
    if (!tenant || !canManageTeam(currentRole)) {
      return;
    }

    const confirmed = window.confirm(
      `Change ${member.profile?.full_name || member.profile?.email || "this member"} to ${role}?`,
    );

    if (!confirmed) {
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

  async function handleAssignTrainerCourse(member: TenantMemberWithProfile) {
    if (!tenant || !canManageTeam(currentRole)) {
      return;
    }

    const courseId = selectedCourseByTrainer[member.user_id];

    if (!courseId) {
      setActionError("Select a course to assign.");
      return;
    }

    setMutatingMemberId(member.id);
    setActionError("");

    try {
      await assignTrainerToCourse({
        courseId,
        tenantId: tenant.id,
        trainerUserId: member.user_id,
      });
      await loadTrainerAssignments(tenant, members);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to assign course."));
    } finally {
      setMutatingMemberId("");
    }
  }

  async function handleAssignTrainerCohort(member: TenantMemberWithProfile) {
    if (!tenant || !canManageTeam(currentRole)) {
      return;
    }

    const cohortId = selectedCohortByTrainer[member.user_id];

    if (!cohortId) {
      setActionError("Select a cohort to assign.");
      return;
    }

    setMutatingMemberId(member.id);
    setActionError("");

    try {
      await assignTrainerToCohort({
        cohortId,
        tenantId: tenant.id,
        trainerUserId: member.user_id,
      });
      await loadTrainerAssignments(tenant, members);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to assign cohort."));
    } finally {
      setMutatingMemberId("");
    }
  }

  async function handleRemoveTrainerCourse(
    member: TenantMemberWithProfile,
    courseId: string,
  ) {
    if (!tenant || !canManageTeam(currentRole)) {
      return;
    }

    setMutatingMemberId(member.id);
    setActionError("");

    try {
      await removeTrainerFromCourse({
        courseId,
        tenantId: tenant.id,
        trainerUserId: member.user_id,
      });
      await loadTrainerAssignments(tenant, members);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to remove course."));
    } finally {
      setMutatingMemberId("");
    }
  }

  async function handleRemoveTrainerCohort(
    member: TenantMemberWithProfile,
    cohortId: string,
  ) {
    if (!tenant || !canManageTeam(currentRole)) {
      return;
    }

    setMutatingMemberId(member.id);
    setActionError("");

    try {
      await removeTrainerFromCohort({
        cohortId,
        tenantId: tenant.id,
        trainerUserId: member.user_id,
      });
      await loadTrainerAssignments(tenant, members);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to remove cohort."));
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

    if (!tenant || !canManageWorkspace(currentRole)) {
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
  const canManageBranding = canManageWorkspace(currentRole);
  const canInvite = canInviteTeam(currentRole);
  const previewBrandColor = getPreviewBrandColor(brandingForm.brandColor);
  const previewDisplayName =
    brandingForm.workspaceDisplayName.trim() || tenant?.name || "Workspace";

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

      {inviteMessage ? (
        <div className="mt-6 rounded-3xl border border-teal-400/30 bg-teal-400/10 p-4 text-sm text-teal-100">
          {inviteMessage}
        </div>
      ) : null}

      <Card className="mt-8 border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div>
            <Badge className="border-white/15 bg-white/10 text-white">
              Workspace setup
            </Badge>
            <h3 className="mt-4 text-2xl font-semibold">
              Owner control center
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Review identity, team access, invitations, and trainer coverage
              from one owner-facing settings workspace. Changes still use the
              existing save, invite, role, and assignment controls below.
            </p>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:min-w-[28rem]">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-slate-400">Visible members</p>
              <p className="mt-2 text-2xl font-semibold">{members.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-slate-400">Pending invites</p>
              <p className="mt-2 text-2xl font-semibold">
                {
                  invitations.filter(
                    (invitation) => invitation.status === "pending",
                  ).length
                }
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-slate-400">Trainers</p>
              <p className="mt-2 text-2xl font-semibold">
                {members.filter((member) => member.role === "trainer").length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-slate-400">Editable mode</p>
              <p className="mt-2 text-lg font-semibold">
                {canManage ? "Owner/admin" : "Read only"}
              </p>
            </div>
          </div>
        </div>
      </Card>

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
            <div className="flex flex-wrap gap-3">
              <p className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-slate-300">
                {canManageBranding ? "Owner/admin editable" : "Read only"}
              </p>
              {canManageBranding ? (
                <Button href="/app/settings/branding" size="sm" variant="secondary">
                  Advanced Branding
                </Button>
              ) : null}
            </div>
          </div>

          <form className="mt-7 grid gap-5" onSubmit={handleBrandingSubmit}>
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-300">
                Institute / Academy Name
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                  disabled={!canManageBranding || brandingSaving}
                  onChange={(event) =>
                    handleBrandingChange("workspaceDisplayName", event)
                  }
                  placeholder="Nexus Valley Academy"
                  required
                  value={brandingForm.workspaceDisplayName}
                />
              </label>

              <label className="block text-sm font-medium text-slate-300">
                Brand Color
                <div className="mt-2 flex gap-3">
                  <input
                    aria-label="Brand color picker"
                    className="h-11 w-14 rounded-2xl border border-white/10 bg-white/10 p-1 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canManageBranding || brandingSaving}
                    onChange={(event) =>
                      handleBrandingChange("brandColor", event)
                    }
                    type="color"
                    value={previewBrandColor}
                  />
                  <input
                    className="h-11 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                    disabled={!canManageBranding || brandingSaving}
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
                disabled={!canManageBranding || brandingSaving}
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
                  disabled={!canManageBranding || brandingSaving}
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
                  disabled={!canManageBranding || brandingSaving}
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
                  disabled={!canManageBranding || brandingSaving}
                  onChange={(event) => handleBrandingChange("websiteUrl", event)}
                  placeholder="https://example.com"
                  type="url"
                  value={brandingForm.websiteUrl}
                />
              </label>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <label className="block text-sm font-medium text-slate-300">
                WhatsApp Number
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                  disabled={!canManageBranding || brandingSaving}
                  onChange={(event) =>
                    handleBrandingChange("whatsappNumber", event)
                  }
                  placeholder="+91 98765 43210"
                  value={brandingForm.whatsappNumber}
                />
              </label>

              <label className="block text-sm font-medium text-slate-300">
                Certificate Issuer Name
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                  disabled={!canManageBranding || brandingSaving}
                  onChange={(event) =>
                    handleBrandingChange("certificateIssuerName", event)
                  }
                  placeholder="Academy Director"
                  value={brandingForm.certificateIssuerName}
                />
              </label>

              <label className="block text-sm font-medium text-slate-300">
                Receipt Footer Text
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                  disabled={!canManageBranding || brandingSaving}
                  onChange={(event) =>
                    handleBrandingChange("receiptFooterText", event)
                  }
                  placeholder="Thank you for learning with us."
                  value={brandingForm.receiptFooterText}
                />
              </label>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-300">
                Address Line 1
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                  disabled={!canManageBranding || brandingSaving}
                  onChange={(event) =>
                    handleBrandingChange("addressLine1", event)
                  }
                  placeholder="Building, street"
                  value={brandingForm.addressLine1}
                />
              </label>

              <label className="block text-sm font-medium text-slate-300">
                Address Line 2
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                  disabled={!canManageBranding || brandingSaving}
                  onChange={(event) =>
                    handleBrandingChange("addressLine2", event)
                  }
                  placeholder="Area, landmark"
                  value={brandingForm.addressLine2}
                />
              </label>
            </div>

            <div className="grid gap-5 md:grid-cols-4">
              {[
                ["city", "City"],
                ["state", "State"],
                ["country", "Country"],
                ["postalCode", "Postal Code"],
              ].map(([field, label]) => (
                <label
                  className="block text-sm font-medium text-slate-300"
                  key={field}
                >
                  {label}
                  <input
                    className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                    disabled={!canManageBranding || brandingSaving}
                    onChange={(event) =>
                      handleBrandingChange(field as keyof BrandingFormState, event)
                    }
                    value={brandingForm[field as keyof BrandingFormState]}
                  />
                </label>
              ))}
            </div>

            {canManageBranding ? (
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
                alt={`${previewDisplayName} logo`}
                className="h-14 w-14 rounded-2xl border border-white/10 object-cover"
                src={brandingForm.logoUrl}
              />
            ) : (
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl text-sm font-bold text-black"
                style={{ backgroundColor: previewBrandColor }}
              >
                {previewDisplayName.trim().slice(0, 2).toUpperCase() || "CO"}
              </div>
            )}
            <h3 className="mt-5 text-2xl font-semibold">{previewDisplayName}</h3>
            <p className="mt-2 text-sm text-slate-400">
              {tenantSettings?.slug ?? "workspace"} | powered by CoachFort
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
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
              <p>
                {brandingForm.supportEmail ||
                  brandingForm.supportPhone ||
                  brandingForm.whatsappNumber ||
                  "Support contact will appear here."}
              </p>
              <p className="mt-2 text-slate-500">
                {[
                  brandingForm.addressLine1,
                  brandingForm.addressLine2,
                  brandingForm.city,
                  brandingForm.state,
                  brandingForm.postalCode,
                  brandingForm.country,
                ]
                  .filter(Boolean)
                  .join(", ") || "Address will appear on receipts."}
              </p>
            </div>
          </div>
          {!canManageBranding ? (
            <p className="mt-5 text-sm leading-6 text-slate-400">
              Branding can be edited by workspace owners and admins only. Your
              current role can view these settings.
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
            {previewDisplayName}
          </h3>
          <div className="mt-6 rounded-3xl border border-teal-400/30 bg-teal-400/10 p-5">
            <p className="text-sm font-semibold text-teal-300">
              Your role
            </p>
            <div className="mt-3">
              {currentRole ? <RoleBadge role={currentRole} /> : null}
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              {currentRole
                ? getRoleDescription(currentRole)
                : "Your workspace role is loading."}
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

      {canInvite ? (
        <section className="mt-8">
          <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <Badge className="border-white/15 bg-white/10 text-white">
                  Invitations
                </Badge>
                <h3 className="mt-4 text-2xl font-semibold">
                  Invite team members
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Email sending will be connected later. For now, copy and
                  share this secure invite link.
                </p>
              </div>
              <Badge>{invitations.length} invites</Badge>
            </div>

            <form
              className="mt-7 grid gap-3 lg:grid-cols-[1fr_12rem_auto]"
              onSubmit={handleCreateInvitation}
            >
              <label className="block text-sm font-medium text-slate-300">
                Email
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                  disabled={mutatingInvitationId === "new"}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="trainer@academy.com"
                  required
                  type="email"
                  value={inviteEmail}
                />
              </label>
              <label className="block text-sm font-medium text-slate-300">
                Role
                <select
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                  disabled={mutatingInvitationId === "new"}
                  onChange={(event) =>
                    setInviteRole(event.target.value as InvitationRole)
                  }
                  value={inviteRole}
                >
                  {invitationRoles.map((role) => (
                    <option className="text-slate-950" key={role} value={role}>
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  disabled={mutatingInvitationId === "new"}
                  type="submit"
                >
                  {mutatingInvitationId === "new" ? "Creating..." : "Send Invite"}
                </Button>
              </div>
            </form>

            <div className="mt-7 divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10">
              {invitations.length === 0 ? (
                <div className="bg-white/5 p-6 text-sm text-slate-400">
                  No invitations yet. Invite admins, staff, or trainers to this
                  workspace.
                </div>
              ) : (
                invitations.map((invitation) => {
                  const disabled =
                    mutatingInvitationId === invitation.id ||
                    invitation.status === "accepted" ||
                    invitation.status === "revoked";

                  return (
                    <div
                      className="grid gap-4 bg-[#101214] p-4 xl:grid-cols-[1fr_auto_auto] xl:items-center"
                      key={invitation.id}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-white">
                            {invitation.email}
                          </p>
                          <RoleBadge role={invitation.role} />
                          <InvitationStatusBadge status={invitation.status} />
                        </div>
                        <p className="mt-2 text-sm text-slate-400">
                          Expires {formatDate(invitation.expires_at)}
                        </p>
                        {invitation.status === "pending" ? (
                          <p className="mt-2 break-all rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
                            {buildInvitationLink(invitation.token)}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={invitation.status !== "pending"}
                          onClick={() => handleCopyInvitation(invitation)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Copy Link
                        </Button>
                        <Button
                          disabled={
                            mutatingInvitationId === invitation.id ||
                            invitation.status === "accepted" ||
                            invitation.status === "revoked"
                          }
                          onClick={() => handleResendInvitation(invitation)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Resend
                        </Button>
                      </div>

                      <Button
                        className="text-red-300! hover:bg-red-500/10! hover:text-red-200!"
                        disabled={disabled || invitation.status !== "pending"}
                        onClick={() => handleRevokeInvitation(invitation)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Revoke
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </section>
      ) : null}

      {canManage ? (
        <section className="mt-8">
          <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <Badge className="border-white/15 bg-white/10 text-white">
                  Trainer assignments
                </Badge>
                <h3 className="mt-4 text-2xl font-semibold">
                  Course and cohort visibility
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Trainers only see the courses, cohorts, students, and
                  enrollments assigned here.
                </p>
              </div>
              <Badge tone="trainer">
                {members.filter((member) => member.role === "trainer").length}{" "}
                trainers
              </Badge>
            </div>

            <div className="mt-7 space-y-5">
              {members.filter((member) => member.role === "trainer").length ===
              0 ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-slate-400">
                  Change a team member role to Trainer to assign course and
                  cohort visibility.
                </div>
              ) : (
                members
                  .filter((member) => member.role === "trainer")
                  .map((member) => {
                    const assignedCourses =
                      trainerCourseAssignments[member.user_id] ?? [];
                    const assignedCohorts =
                      trainerCohortAssignments[member.user_id] ?? [];
                    const displayName =
                      member.profile?.full_name ||
                      member.profile?.email ||
                      "Trainer";

                    return (
                      <div
                        className="rounded-3xl border border-white/10 bg-white/5 p-5"
                        key={member.id}
                      >
                        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                          <div>
                            <p className="font-semibold text-white">
                              {displayName}
                            </p>
                            <p className="mt-1 text-sm text-slate-400">
                              {member.profile?.email || member.user_id}
                            </p>
                          </div>
                          <RoleBadge role="trainer" />
                        </div>

                        <div className="mt-5 grid gap-5 xl:grid-cols-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-300">
                              Assign Courses
                            </p>
                            <div className="mt-3 flex gap-2">
                              <select
                                className="h-11 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/10 px-3 text-sm text-white outline-none focus:border-teal-400/40 focus:ring-4 focus:ring-teal-400/10"
                                onChange={(event) =>
                                  setSelectedCourseByTrainer((current) => ({
                                    ...current,
                                    [member.user_id]: event.target.value,
                                  }))
                                }
                                value={
                                  selectedCourseByTrainer[member.user_id] ?? ""
                                }
                              >
                                <option className="text-slate-950" value="">
                                  Select course
                                </option>
                                {courses.map((course) => (
                                  <option
                                    className="text-slate-950"
                                    key={course.id}
                                    value={course.id}
                                  >
                                    {course.title}
                                  </option>
                                ))}
                              </select>
                              <Button
                                disabled={mutatingMemberId === member.id}
                                onClick={() => handleAssignTrainerCourse(member)}
                                size="sm"
                                type="button"
                              >
                                Assign
                              </Button>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {assignedCourses.length === 0 ? (
                                <span className="text-sm text-slate-500">
                                  No course assignments.
                                </span>
                              ) : (
                                assignedCourses.map((assignment) => (
                                  <span
                                    className="inline-flex items-center gap-2 rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1 text-xs font-semibold text-teal-200"
                                    key={assignment.id}
                                  >
                                    {assignment.course?.title ?? "Course"}
                                    <button
                                      className="text-teal-100 hover:text-white"
                                      onClick={() =>
                                        handleRemoveTrainerCourse(
                                          member,
                                          assignment.course_id,
                                        )
                                      }
                                      type="button"
                                    >
                                      remove
                                    </button>
                                  </span>
                                ))
                              )}
                            </div>
                          </div>

                          <div>
                            <p className="text-sm font-semibold text-slate-300">
                              Assign Cohorts
                            </p>
                            <div className="mt-3 flex gap-2">
                              <select
                                className="h-11 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/10 px-3 text-sm text-white outline-none focus:border-teal-400/40 focus:ring-4 focus:ring-teal-400/10"
                                onChange={(event) =>
                                  setSelectedCohortByTrainer((current) => ({
                                    ...current,
                                    [member.user_id]: event.target.value,
                                  }))
                                }
                                value={
                                  selectedCohortByTrainer[member.user_id] ?? ""
                                }
                              >
                                <option className="text-slate-950" value="">
                                  Select cohort
                                </option>
                                {cohorts.map((cohort) => (
                                  <option
                                    className="text-slate-950"
                                    key={cohort.id}
                                    value={cohort.id}
                                  >
                                    {cohort.name}
                                  </option>
                                ))}
                              </select>
                              <Button
                                disabled={mutatingMemberId === member.id}
                                onClick={() => handleAssignTrainerCohort(member)}
                                size="sm"
                                type="button"
                              >
                                Assign
                              </Button>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {assignedCohorts.length === 0 ? (
                                <span className="text-sm text-slate-500">
                                  No cohort assignments.
                                </span>
                              ) : (
                                assignedCohorts.map((assignment) => (
                                  <span
                                    className="inline-flex items-center gap-2 rounded-full border border-purple-400/30 bg-purple-400/10 px-3 py-1 text-xs font-semibold text-purple-200"
                                    key={assignment.id}
                                  >
                                    {assignment.cohort?.name ?? "Cohort"}
                                    <button
                                      className="text-purple-100 hover:text-white"
                                      onClick={() =>
                                        handleRemoveTrainerCohort(
                                          member,
                                          assignment.cohort_id,
                                        )
                                      }
                                      type="button"
                                    >
                                      remove
                                    </button>
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </Card>
        </section>
      ) : null}

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

      <section className="mt-8">
        <Card className="border-red-200 bg-red-50 p-6 text-red-950 shadow-xl shadow-red-950/5">
          <Badge tone="danger">Danger Zone</Badge>
          <h3 className="mt-4 text-2xl font-semibold">
            Destructive action controls
          </h3>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-red-800">
            Critical workspace actions are restricted by role, confirmed before
            execution, and written to the audit center. Delete workspace and
            ownership transfer controls are intentionally not exposed in this
            phase.
          </p>
          <div className="mt-5 grid gap-3 text-sm md:grid-cols-3">
            {[
              "Member removal requires owner permission.",
              "Record deletion requires owner or admin permission.",
              "Settings changes are owner-only and logged as critical.",
            ].map((item) => (
              <div
                className="rounded-2xl border border-red-200 bg-white p-4 font-medium text-red-900"
                key={item}
              >
                {item}
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}
