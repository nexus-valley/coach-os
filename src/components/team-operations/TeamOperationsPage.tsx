"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import {
  addTeamMemberNote,
  formatTeamOpsDate,
  formatTeamOpsLabel,
  getTeamMemberOperationsDetail,
  getTeamOperationsDashboard,
  upsertTeamMemberProfile,
  type TeamEmploymentStatus,
  type TeamEmploymentType,
  type TeamMemberOperationsDetail,
  type TeamMemberOperationsRow,
  type TeamMemberProfileInput,
  type TeamOperationsDashboard,
  type TeamWorkLocation,
} from "@/src/lib/teamOperations";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

const employmentTypes: Array<{ label: string; value: TeamEmploymentType | "" }> = [
  { label: "Not set", value: "" },
  { label: "Full time", value: "full_time" },
  { label: "Part time", value: "part_time" },
  { label: "Contract", value: "contract" },
  { label: "Visiting", value: "visiting" },
  { label: "Intern", value: "intern" },
  { label: "Consultant", value: "consultant" },
];

const employmentStatuses: Array<{ label: string; value: TeamEmploymentStatus }> = [
  { label: "Active", value: "active" },
  { label: "Onboarding", value: "onboarding" },
  { label: "On leave", value: "on_leave" },
  { label: "Suspended", value: "suspended" },
  { label: "Exited", value: "exited" },
];

const workLocations: Array<{ label: string; value: TeamWorkLocation | "" }> = [
  { label: "Not set", value: "" },
  { label: "Onsite", value: "onsite" },
  { label: "Remote", value: "remote" },
  { label: "Hybrid", value: "hybrid" },
];

const noteTypes = [
  "general",
  "performance",
  "onboarding",
  "follow_up",
  "exit",
  "risk",
];

const emptyDashboard: TeamOperationsDashboard = {
  members: [],
  summary: {
    active_members: 0,
    exited_members: 0,
    on_leave_members: 0,
    onboarding_members: 0,
    staff_admin_count: 0,
    total_members: 0,
    trainer_count: 0,
  },
};

type ProfileFormState = Omit<TeamMemberProfileInput, "tenantId" | "userId">;

const emptyProfileForm: ProfileFormState = {
  department: "",
  designation: "",
  displayName: "",
  employmentStatus: "active",
  employmentType: "",
  exitDate: "",
  joiningDate: "",
  notes: "",
  staffCode: "",
  workLocation: "",
};

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function getMemberName(member: Pick<TeamMemberOperationsRow, "display_name" | "email" | "full_name">) {
  return member.display_name || member.full_name || member.email || "Team member";
}

function statusTone(status: TeamEmploymentStatus) {
  if (status === "active") return "success" as const;
  if (status === "onboarding") return "admin" as const;
  if (status === "on_leave") return "warning" as const;
  if (status === "exited") return "staff" as const;
  return "danger" as const;
}

function roleTone(role: MemberRole) {
  if (role === "owner") return "owner" as const;
  if (role === "admin") return "admin" as const;
  if (role === "trainer") return "trainer" as const;
  return "staff" as const;
}

function createProfileForm(detail: TeamMemberOperationsDetail | null): ProfileFormState {
  if (!detail) {
    return emptyProfileForm;
  }

  return {
    department: detail.profile.department ?? "",
    designation: detail.profile.designation ?? "",
    displayName: detail.profile.display_name ?? "",
    employmentStatus: detail.profile.employment_status ?? "active",
    employmentType: detail.profile.employment_type ?? "",
    exitDate: detail.profile.exit_date ?? "",
    joiningDate: detail.profile.joining_date ?? "",
    notes: detail.profile.notes ?? "",
    staffCode: detail.profile.staff_code ?? "",
    workLocation: detail.profile.work_location ?? "",
  };
}

export function TeamOperationsPage() {
  const [actionError, setActionError] = useState("");
  const [dashboard, setDashboard] = useState<TeamOperationsDashboard>(emptyDashboard);
  const [detail, setDetail] = useState<TeamMemberOperationsDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [employmentStatusFilter, setEmploymentStatusFilter] =
    useState<TeamEmploymentStatus | "all">("all");
  const [employmentTypeFilter, setEmploymentTypeFilter] =
    useState<TeamEmploymentType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [noteType, setNoteType] = useState("general");
  const [profileForm, setProfileForm] = useState<ProfileFormState>(emptyProfileForm);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [roleFilter, setRoleFilter] = useState<MemberRole | "all">("all");
  const [saving, setSaving] = useState("");
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const canAccess = role === "owner" || role === "admin";

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return dashboard.members.filter((member) => {
      const text = [
        member.display_name,
        member.full_name,
        member.email,
        member.staff_code,
        member.designation,
        member.department,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return (
        (!query || text.includes(query)) &&
        (roleFilter === "all" || member.role === roleFilter) &&
        (employmentStatusFilter === "all" ||
          member.employment_status === employmentStatusFilter) &&
        (employmentTypeFilter === "all" ||
          member.employment_type === employmentTypeFilter)
      );
    });
  }, [
    dashboard.members,
    employmentStatusFilter,
    employmentTypeFilter,
    roleFilter,
    search,
  ]);

  async function loadDashboard(currentTenant: Tenant) {
    setActionError("");
    setLoading(true);

    try {
      const nextDashboard = await getTeamOperationsDashboard(currentTenant.id);
      setDashboard(nextDashboard);
      const nextSelected =
        selectedUserId &&
        nextDashboard.members.some((member) => member.user_id === selectedUserId)
          ? selectedUserId
          : nextDashboard.members[0]?.user_id ?? null;

      setSelectedUserId(nextSelected);

      if (nextSelected) {
        await loadDetail(currentTenant.id, nextSelected);
      } else {
        setDetail(null);
      }
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load team operations."));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(tenantId: string, userId: string) {
    setDetailLoading(true);

    try {
      const nextDetail = await getTeamMemberOperationsDetail({ tenantId, userId });
      setDetail(nextDetail);
      setProfileForm(createProfileForm(nextDetail));
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load team member detail."));
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitial() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) return;

        if (!currentTenant) {
          setActionError("Workspace context was not found.");
          return;
        }

        const supabase = getSupabaseClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) throw userError;
        if (!user) throw new Error("You must be logged in.");

        const currentRole = await getCurrentMemberRole(currentTenant.id, user.id);

        if (!active) return;

        setTenant(currentTenant);
        setRole(currentRole);

        if (currentRole !== "owner" && currentRole !== "admin") {
          setLoading(false);
          return;
        }

        const nextDashboard = await getTeamOperationsDashboard(currentTenant.id);

        if (!active) return;

        setDashboard(nextDashboard);
        const firstUserId = nextDashboard.members[0]?.user_id ?? null;
        setSelectedUserId(firstUserId);

        if (firstUserId) {
          const nextDetail = await getTeamMemberOperationsDetail({
            tenantId: currentTenant.id,
            userId: firstUserId,
          });

          if (!active) return;

          setDetail(nextDetail);
          setProfileForm(createProfileForm(nextDetail));
        }
      } catch (caught) {
        if (active) {
          setActionError(getErrorMessage(caught, "Unable to load team operations."));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitial();

    return () => {
      active = false;
    };
  }, []);

  async function handleSelectMember(userId: string) {
    if (!tenant) return;

    setSelectedUserId(userId);
    setSuccess("");
    setActionError("");
    await loadDetail(tenant.id, userId);
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !selectedUserId) return;

    setSaving("profile");
    setActionError("");
    setSuccess("");

    try {
      await upsertTeamMemberProfile({
        ...profileForm,
        tenantId: tenant.id,
        userId: selectedUserId,
      });
      setSuccess("Team profile saved.");
      await loadDashboard(tenant);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to save team profile."));
    } finally {
      setSaving("");
    }
  }

  async function handleAddNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !selectedUserId) return;

    setSaving("note");
    setActionError("");
    setSuccess("");

    try {
      await addTeamMemberNote({
        note,
        noteType,
        tenantId: tenant.id,
        userId: selectedUserId,
      });
      setNote("");
      setSuccess("Internal note added.");
      await loadDetail(tenant.id, selectedUserId);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to add internal note."));
    } finally {
      setSaving("");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-[#D8E8F0] bg-white">
          <span className="sr-only">Loading team operations</span>
        </Card>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-4xl">
        <FeedbackAlert>
          Team Operations is available only to institute owners and admins.
        </FeedbackAlert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
            Owner/admin only
          </Badge>
          <h1 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Team Operations
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#425B76]">
            Maintain operational team profiles, trainer workload summaries, and
            private HR notes without changing system roles or login access.
          </p>
        </div>
        <Button
          onClick={() => tenant && loadDashboard(tenant)}
          type="button"
          variant="secondary"
        >
          Refresh
        </Button>
      </div>

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
        {[
          ["Total", dashboard.summary.total_members],
          ["Active", dashboard.summary.active_members],
          ["Onboarding", dashboard.summary.onboarding_members],
          ["On leave", dashboard.summary.on_leave_members],
          ["Exited", dashboard.summary.exited_members],
          ["Trainers", dashboard.summary.trainer_count],
          ["Staff/Admin", dashboard.summary.staff_admin_count],
        ].map(([label, value]) => (
          <Card className="p-5" key={label}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#66788F]">
              {label}
            </p>
            <p className="mt-3 text-3xl font-semibold text-[#0B1F33]">{value}</p>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_220px_220px]">
          <input
            className="h-11 rounded-2xl border border-[#D8E8F0] px-4 text-sm outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, staff code, designation, department"
            value={search}
          />
          <select
            className="h-11 rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm"
            onChange={(event) => setRoleFilter(event.target.value as MemberRole | "all")}
            value={roleFilter}
          >
            <option value="all">All roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="staff">Staff</option>
            <option value="trainer">Trainer</option>
          </select>
          <select
            className="h-11 rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm"
            onChange={(event) =>
              setEmploymentStatusFilter(
                event.target.value as TeamEmploymentStatus | "all",
              )
            }
            value={employmentStatusFilter}
          >
            <option value="all">All statuses</option>
            {employmentStatuses.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            className="h-11 rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm"
            onChange={(event) =>
              setEmploymentTypeFilter(event.target.value as TeamEmploymentType | "all")
            }
            value={employmentTypeFilter}
          >
            <option value="all">All employment types</option>
            {employmentTypes
              .filter((item) => item.value)
              .map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
          </select>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="space-y-3">
          {filteredMembers.length === 0 ? (
            <EmptyState
              description="No team members match the selected filters."
              icon="TM"
              title="No team members"
            />
          ) : (
            filteredMembers.map((member) => {
              const selected = selectedUserId === member.user_id;

              return (
                <button
                  className={[
                    "w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition",
                    selected
                      ? "border-[#2ECBEA] shadow-[#2ECBEA]/15"
                      : "border-[#D8E8F0] hover:border-[#2ECBEA]/60",
                  ].join(" ")}
                  key={member.user_id}
                  onClick={() => handleSelectMember(member.user_id)}
                  type="button"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-[#0B1F33]">
                        {getMemberName(member)}
                      </h2>
                      <p className="mt-1 text-sm text-[#66788F]">
                        {member.email || "Email unavailable"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={roleTone(member.role)}>
                        {formatTeamOpsLabel(member.role)}
                      </Badge>
                      <Badge tone={statusTone(member.employment_status)}>
                        {formatTeamOpsLabel(member.employment_status)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm text-[#425B76] sm:grid-cols-3">
                    <span>{member.designation || "No designation"}</span>
                    <span>{member.assigned_courses_count} courses</span>
                    <span>{member.assigned_cohorts_count} cohorts</span>
                  </div>
                  <p className="mt-3 text-xs font-medium text-[#66788F]">
                    Joined {formatTeamOpsDate(member.joining_date || member.member_created_at)}
                  </p>
                </button>
              );
            })
          )}
        </section>

        <section className="space-y-6">
          {detailLoading ? (
            <Card className="h-72 animate-pulse border-[#D8E8F0] bg-white">
              <span className="sr-only">Loading team member detail</span>
            </Card>
          ) : !detail ? (
            <EmptyState
              description="Select a team member to manage their operational profile."
              icon="HR"
              title="No member selected"
            />
          ) : (
            <>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold text-[#0B1F33]">
                      {profileForm.displayName ||
                        detail.member.full_name ||
                        detail.member.email ||
                        "Team member"}
                    </h2>
                    <p className="mt-1 text-sm text-[#66788F]">
                      {detail.member.email || "Email unavailable"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={roleTone(detail.member.role)}>
                      {formatTeamOpsLabel(detail.member.role)}
                    </Badge>
                    <Badge tone={statusTone(profileForm.employmentStatus)}>
                      {formatTeamOpsLabel(profileForm.employmentStatus)}
                    </Badge>
                  </div>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-4">
                  {[
                    ["Courses", detail.workload.assigned_courses_count],
                    ["Cohorts", detail.workload.assigned_cohorts_count],
                    ["Upcoming", detail.workload.upcoming_sessions_count],
                    ["Students", detail.workload.active_students_count],
                  ].map(([label, value]) => (
                    <div
                      className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                      key={label}
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#66788F]">
                        {label}
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-[#0B1F33]">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <h3 className="text-xl font-semibold text-[#0B1F33]">
                  Operational Profile
                </h3>
                <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={handleSaveProfile}>
                  <label className="block">
                    <span className="text-sm font-medium text-[#425B76]">
                      Display name override
                    </span>
                    <input
                      className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] px-4 text-sm"
                      maxLength={180}
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          displayName: event.target.value,
                        }))
                      }
                      value={profileForm.displayName}
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-[#425B76]">
                      Staff code
                    </span>
                    <input
                      className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] px-4 text-sm"
                      maxLength={60}
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          staffCode: event.target.value,
                        }))
                      }
                      value={profileForm.staffCode}
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-[#425B76]">
                      Designation
                    </span>
                    <input
                      className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] px-4 text-sm"
                      maxLength={160}
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          designation: event.target.value,
                        }))
                      }
                      value={profileForm.designation}
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-[#425B76]">
                      Department
                    </span>
                    <input
                      className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] px-4 text-sm"
                      maxLength={120}
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          department: event.target.value,
                        }))
                      }
                      value={profileForm.department}
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-[#425B76]">
                      Employment type
                    </span>
                    <select
                      className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm"
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          employmentType: event.target.value as TeamEmploymentType | "",
                        }))
                      }
                      value={profileForm.employmentType}
                    >
                      {employmentTypes.map((item) => (
                        <option key={item.value || "none"} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-[#425B76]">
                      Employment status
                    </span>
                    <select
                      className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm"
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          employmentStatus: event.target.value as TeamEmploymentStatus,
                        }))
                      }
                      value={profileForm.employmentStatus}
                    >
                      {employmentStatuses.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-[#425B76]">
                      Work location
                    </span>
                    <select
                      className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm"
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          workLocation: event.target.value as TeamWorkLocation | "",
                        }))
                      }
                      value={profileForm.workLocation}
                    >
                      {workLocations.map((item) => (
                        <option key={item.value || "none"} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-medium text-[#425B76]">
                        Joining date
                      </span>
                      <input
                        className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] px-4 text-sm"
                        onChange={(event) =>
                          setProfileForm((current) => ({
                            ...current,
                            joiningDate: event.target.value,
                          }))
                        }
                        type="date"
                        value={profileForm.joiningDate}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-[#425B76]">
                        Exit date
                      </span>
                      <input
                        className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] px-4 text-sm"
                        onChange={(event) =>
                          setProfileForm((current) => ({
                            ...current,
                            exitDate: event.target.value,
                          }))
                        }
                        type="date"
                        value={profileForm.exitDate}
                      />
                    </label>
                  </div>
                  <label className="block md:col-span-2">
                    <span className="text-sm font-medium text-[#425B76]">
                      Profile notes
                    </span>
                    <textarea
                      className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm leading-6"
                      maxLength={3000}
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      value={profileForm.notes}
                    />
                  </label>
                  <div className="flex justify-end md:col-span-2">
                    <Button disabled={saving === "profile"} type="submit">
                      {saving === "profile" ? "Saving..." : "Save Profile"}
                    </Button>
                  </div>
                </form>
              </Card>

              <Card className="p-5">
                <h3 className="text-xl font-semibold text-[#0B1F33]">
                  Assignments
                </h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm font-semibold text-[#425B76]">
                      Assigned courses
                    </p>
                    <div className="mt-3 space-y-2">
                      {detail.courses.length ? (
                        detail.courses.map((course) => (
                          <div
                            className="rounded-2xl border border-[#D8E8F0] p-3 text-sm"
                            key={course.id}
                          >
                            {course.title}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-[#66788F]">No assigned courses.</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#425B76]">
                      Assigned cohorts
                    </p>
                    <div className="mt-3 space-y-2">
                      {detail.cohorts.length ? (
                        detail.cohorts.map((cohort) => (
                          <div
                            className="rounded-2xl border border-[#D8E8F0] p-3 text-sm"
                            key={cohort.id}
                          >
                            {cohort.name}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-[#66788F]">No assigned cohorts.</p>
                      )}
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-5">
                <h3 className="text-xl font-semibold text-[#0B1F33]">
                  Internal Notes
                </h3>
                <form className="mt-5 space-y-4" onSubmit={handleAddNote}>
                  <select
                    className="h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm"
                    onChange={(event) => setNoteType(event.target.value)}
                    value={noteType}
                  >
                    {noteTypes.map((item) => (
                      <option key={item} value={item}>
                        {formatTeamOpsLabel(item)}
                      </option>
                    ))}
                  </select>
                  <textarea
                    className="min-h-28 w-full resize-none rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm leading-6"
                    maxLength={3000}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Owner/admin-only internal note. Do not store salary, bank, government ID, health, or address data."
                    required
                    value={note}
                  />
                  <div className="flex justify-end">
                    <Button disabled={saving === "note"} type="submit">
                      {saving === "note" ? "Adding..." : "Add Note"}
                    </Button>
                  </div>
                </form>
                <div className="mt-5 space-y-3">
                  {detail.notes.length ? (
                    detail.notes.map((item) => (
                      <div
                        className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                        key={item.id}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge tone="warning">{formatTeamOpsLabel(item.note_type)}</Badge>
                          <span className="text-xs text-[#66788F]">
                            {formatTeamOpsDate(item.created_at)}
                          </span>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#0B1F33]">
                          {item.note}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-[#66788F]">
                      No internal notes for this team member.
                    </p>
                  )}
                </div>
              </Card>

              <Card className="p-5">
                <h3 className="text-xl font-semibold text-[#0B1F33]">
                  Lifecycle Timeline
                </h3>
                <div className="mt-4 space-y-3">
                  {detail.activity.length ? (
                    detail.activity.map((item) => (
                      <div
                        className="rounded-2xl border border-[#D8E8F0] p-4"
                        key={item.id}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge tone="light">{formatTeamOpsLabel(item.action)}</Badge>
                          <span className="text-xs text-[#66788F]">
                            {formatTeamOpsDate(item.created_at)}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-[#66788F]">
                          Metadata only. Note bodies are not copied here.
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-[#66788F]">
                      No lifecycle events recorded yet.
                    </p>
                  )}
                </div>
              </Card>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
