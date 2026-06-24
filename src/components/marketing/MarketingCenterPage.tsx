"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  addLeadsToMarketingCampaign,
  createMarketingCampaign,
  createMarketingTemplate,
  getMarketingCenterData,
  logMarketingTouch,
  marketingAssignedRoles,
  marketingCampaignLeadStatuses,
  marketingCampaignStatuses,
  marketingCampaignTypes,
  marketingChannels,
  marketingTemplateChannels,
  marketingTemplateStatuses,
  marketingTemplateTypes,
  updateMarketingCampaign,
  updateMarketingCampaignLead,
  updateMarketingTemplate,
  type MarketingAssignedRole,
  type MarketingCampaign,
  type MarketingCampaignLead,
  type MarketingCampaignLeadStatus,
  type MarketingCampaignStatus,
  type MarketingCampaignType,
  type MarketingCenterData,
  type MarketingChannel,
  type MarketingTemplate,
  type MarketingTemplateChannel,
  type MarketingTemplateStatus,
  type MarketingTemplateType,
} from "@/src/lib/marketing";
import { canAccessMarketing } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant } from "@/src/lib/tenant";

type CampaignFormState = {
  assignedRole: MarketingAssignedRole;
  budget: string;
  campaignType: MarketingCampaignType;
  channel: MarketingChannel;
  description: string;
  endAt: string;
  goal: string;
  name: string;
  startAt: string;
};

type TemplateFormState = {
  body: string;
  channel: MarketingTemplateChannel;
  name: string;
  status: MarketingTemplateStatus;
  subject: string;
  templateType: MarketingTemplateType;
};

type TouchFormState = {
  channel: MarketingChannel;
  leadId: string;
  note: string;
  templateId: string;
};

const emptyCampaignForm: CampaignFormState = {
  assignedRole: "owner",
  budget: "",
  campaignType: "lead_nurture",
  channel: "manual",
  description: "",
  endAt: "",
  goal: "",
  name: "",
  startAt: "",
};

const emptyTemplateForm: TemplateFormState = {
  body: "Hi {{lead_name}}, this is {{tenant_name}} following up about {{course_name}}.",
  channel: "manual",
  name: "",
  status: "draft",
  subject: "",
  templateType: "lead_nurture",
};

const emptyTouchForm: TouchFormState = {
  channel: "manual",
  leadId: "",
  note: "",
  templateId: "",
};

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

function formatDate(value: string | null) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return fallback;
}

function statusTone(status: MarketingCampaignStatus) {
  if (status === "active" || status === "completed") return "success" as const;
  if (status === "archived" || status === "paused") return "danger" as const;
  if (status === "planned") return "warning" as const;
  return "light" as const;
}

function campaignLeadTone(status: MarketingCampaignLeadStatus) {
  if (status === "converted" || status === "interested") return "success" as const;
  if (status === "not_interested" || status === "removed") return "danger" as const;
  if (status === "responded") return "warning" as const;
  return "light" as const;
}

function templateTone(status: MarketingTemplateStatus) {
  if (status === "active") return "success" as const;
  if (status === "archived") return "danger" as const;
  return "light" as const;
}

export function MarketingCenterPage() {
  const [actionError, setActionError] = useState<string | null>(null);
  const [campaignForm, setCampaignForm] =
    useState<CampaignFormState>(emptyCampaignForm);
  const [campaignStatus, setCampaignStatus] =
    useState<MarketingCampaignStatus>("draft");
  const [data, setData] = useState<MarketingCenterData | null>(null);
  const [leadSelection, setLeadSelection] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [templateForm, setTemplateForm] =
    useState<TemplateFormState>(emptyTemplateForm);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [touchForm, setTouchForm] = useState<TouchFormState>(emptyTouchForm);
  const initialLoadStarted = useRef(false);

  const isOwnerAdmin = role === "owner" || role === "admin";
  const canAccess = canAccessMarketing(role);

  const campaigns = useMemo(() => data?.campaigns ?? [], [data?.campaigns]);
  const selectedCampaign = useMemo(
    () =>
      campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [campaigns, selectedCampaignId],
  );

  const campaignLeads = useMemo(
    () =>
      (data?.campaignLeads ?? []).filter(
        (lead) => lead.campaign_id === selectedCampaignId,
      ),
    [data?.campaignLeads, selectedCampaignId],
  );

  const campaignLeadIds = useMemo(
    () => new Set(campaignLeads.map((lead) => lead.lead_id)),
    [campaignLeads],
  );

  const selectableLeads = useMemo(
    () => (data?.crmLeads ?? []).filter((lead) => !campaignLeadIds.has(lead.id)),
    [campaignLeadIds, data?.crmLeads],
  );

  const activity = useMemo(
    () =>
      (data?.activities ?? [])
        .filter((item) => item.campaign_id === selectedCampaignId)
        .slice(0, 16),
    [data?.activities, selectedCampaignId],
  );

  const loadMarketing = useCallback(async () => {
    setActionError(null);
    setLoading(true);

    try {
      const supabase = getSupabaseClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("You must be logged in to view marketing.");

      const tenant = await getCurrentTenant();
      if (!tenant) throw new Error("No workspace found for this user.");

      const memberRole = await getCurrentMemberRole(tenant.id, user.id);
      setRole(memberRole);
      setTenantId(tenant.id);

      if (!canAccessMarketing(memberRole)) {
        setData(null);
        return;
      }

      const marketingData = await getMarketingCenterData(tenant.id);
      const nextSelectedId =
        selectedCampaignId &&
        marketingData.campaigns.some((campaign) => campaign.id === selectedCampaignId)
          ? selectedCampaignId
          : marketingData.campaigns[0]?.id ?? null;
      const nextCampaign =
        marketingData.campaigns.find((campaign) => campaign.id === nextSelectedId) ??
        null;

      setData(marketingData);
      setSelectedCampaignId(nextSelectedId);
      setCampaignStatus(nextCampaign?.status ?? "draft");
      setTouchForm((current) => ({
        ...current,
        leadId: "",
        templateId: "",
      }));
      setLeadSelection([]);
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to load Marketing Center."));
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void Promise.resolve().then(loadMarketing);
  }, [loadMarketing]);

  const stats = {
    active: campaigns.filter((campaign) => campaign.status === "active").length,
    audience: data?.campaignLeads.length ?? 0,
    campaigns: campaigns.length,
    templates: data?.templates.length ?? 0,
  };

  function handleSelectCampaign(campaign: MarketingCampaign) {
    setSelectedCampaignId(campaign.id);
    setCampaignStatus(campaign.status);
    setLeadSelection([]);
    setTouchForm(emptyTouchForm);
  }

  async function handleCreateCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) return;

    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const campaignId = await createMarketingCampaign({
        assignedRole: isOwnerAdmin ? campaignForm.assignedRole : null,
        budget: campaignForm.budget ? Number(campaignForm.budget) : null,
        campaignType: campaignForm.campaignType,
        channel: campaignForm.channel,
        description: campaignForm.description || null,
        endAt: campaignForm.endAt || null,
        goal: campaignForm.goal || null,
        name: campaignForm.name,
        startAt: campaignForm.startAt || null,
        tenantId,
      });

      setCampaignForm(emptyCampaignForm);
      setSelectedCampaignId(campaignId);
      setSuccess("Campaign draft created. No messages were sent.");
      await loadMarketing();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to create campaign."));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCampaign) return;

    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await updateMarketingCampaign({
        campaignId: selectedCampaign.id,
        status: campaignStatus,
      });
      setSuccess("Campaign status updated. No messages were sent.");
      await loadMarketing();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to update campaign."));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) return;

    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await createMarketingTemplate({
        body: templateForm.body,
        channel: templateForm.channel,
        name: templateForm.name,
        status: templateForm.status,
        subject: templateForm.subject || null,
        templateType: templateForm.templateType,
        tenantId,
      });

      setTemplateForm(emptyTemplateForm);
      setSuccess("Template saved. It is not connected to external sending.");
      await loadMarketing();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to create template."));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveTemplate(template: MarketingTemplate) {
    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await updateMarketingTemplate({
        status: template.status === "archived" ? "draft" : "archived",
        templateId: template.id,
      });
      setSuccess("Template status updated.");
      await loadMarketing();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to update template."));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddAudience() {
    if (!selectedCampaign || leadSelection.length === 0) return;

    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const count = await addLeadsToMarketingCampaign({
        campaignId: selectedCampaign.id,
        leadIds: leadSelection,
      });
      setSuccess(`${count} lead${count === 1 ? "" : "s"} added to campaign.`);
      setLeadSelection([]);
      await loadMarketing();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to add campaign audience."));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateCampaignLead(
    campaignLead: MarketingCampaignLead,
    status: MarketingCampaignLeadStatus,
  ) {
    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await updateMarketingCampaignLead({
        campaignLeadId: campaignLead.id,
        status,
      });
      setSuccess("Campaign lead status updated.");
      await loadMarketing();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to update campaign lead."));
    } finally {
      setSaving(false);
    }
  }

  async function handleLogTouch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCampaign || !touchForm.leadId) return;

    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await logMarketingTouch({
        campaignId: selectedCampaign.id,
        channel: touchForm.channel,
        leadId: touchForm.leadId,
        note: touchForm.note || null,
        templateId: touchForm.templateId || null,
      });

      setTouchForm(emptyTouchForm);
      setSuccess("Manual touch logged. No external message was sent.");
      await loadMarketing();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to log marketing touch."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <span className="sr-only">Loading Marketing Center</span>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#9ADDEA] border-t-[#145DA0]" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <AccessDeniedCard description="Marketing access is available to workspace team members only." />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Badge tone="light">Marketing foundation</Badge>
          <h1 className="mt-3 text-3xl font-semibold text-[#0B2A3D]">
            Marketing Center
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-[#425B76]">
            Plan campaigns, organize templates, select CRM audiences, and log
            manual touches. This module does not send WhatsApp, SMS, or email.
          </p>
        </div>
        <Button onClick={loadMarketing} type="button" variant="secondary">
          Refresh
        </Button>
      </div>

      <FeedbackAlert tone="warning">
        No external messages are sent from this module yet. Use “Log Touch” to
        record manual outreach only.
      </FeedbackAlert>
      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Campaigns", stats.campaigns],
          ["Active", stats.active],
          ["Audience leads", stats.audience],
          ["Templates", stats.templates],
        ].map(([label, value]) => (
          <Card className="p-5" key={label}>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5D7185]">
              {label}
            </p>
            <p className="mt-3 text-3xl font-semibold text-[#0B2A3D]">
              {value}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.45fr)]">
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-[#0B2A3D]">Campaigns</h2>
            <div className="mt-5 space-y-3">
              {campaigns.length ? (
                campaigns.map((campaign) => (
                  <button
                    className={[
                      "w-full rounded-2xl border p-4 text-left transition",
                      campaign.id === selectedCampaignId
                        ? "border-[#145DA0] bg-[#EAF8FC]"
                        : "border-[#D8E8F0] bg-white hover:border-[#9ADDEA]",
                    ].join(" ")}
                    key={campaign.id}
                    onClick={() => handleSelectCampaign(campaign)}
                    type="button"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="mr-auto font-semibold text-[#0B2A3D]">
                        {campaign.name}
                      </p>
                      <Badge tone={statusTone(campaign.status)}>
                        {formatLabel(campaign.status)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-[#5D7185]">
                      {formatLabel(campaign.campaign_type)} |{" "}
                      {formatLabel(campaign.channel)}
                    </p>
                  </button>
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
                  No campaigns yet. Create a draft to start planning.
                </p>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-[#0B2A3D]">
              Create campaign draft
            </h2>
            <form className="mt-5 space-y-4" onSubmit={handleCreateCampaign}>
              <input
                className="w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                maxLength={180}
                onChange={(event) =>
                  setCampaignForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Campaign name"
                required
                value={campaignForm.name}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                  onChange={(event) =>
                    setCampaignForm((current) => ({
                      ...current,
                      campaignType: event.target.value as MarketingCampaignType,
                    }))
                  }
                  value={campaignForm.campaignType}
                >
                  {marketingCampaignTypes.map((type) => (
                    <option key={type} value={type}>
                      {formatLabel(type)}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                  onChange={(event) =>
                    setCampaignForm((current) => ({
                      ...current,
                      channel: event.target.value as MarketingChannel,
                    }))
                  }
                  value={campaignForm.channel}
                >
                  {marketingChannels.map((channel) => (
                    <option key={channel} value={channel}>
                      {formatLabel(channel)}
                    </option>
                  ))}
                </select>
                {isOwnerAdmin ? (
                  <select
                    className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    onChange={(event) =>
                      setCampaignForm((current) => ({
                        ...current,
                        assignedRole: event.target.value as MarketingAssignedRole,
                      }))
                    }
                    value={campaignForm.assignedRole}
                  >
                    {marketingAssignedRoles.map((assignedRole) => (
                      <option key={assignedRole} value={assignedRole}>
                        Assign {formatLabel(assignedRole)}
                      </option>
                    ))}
                  </select>
                ) : null}
                <input
                  className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                  min="0"
                  onChange={(event) =>
                    setCampaignForm((current) => ({
                      ...current,
                      budget: event.target.value,
                    }))
                  }
                  placeholder="Budget"
                  type="number"
                  value={campaignForm.budget}
                />
              </div>
              <textarea
                className="min-h-24 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                maxLength={1500}
                onChange={(event) =>
                  setCampaignForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Campaign description"
                value={campaignForm.description}
              />
              <Button disabled={saving} type="submit">
                Create Draft
              </Button>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          {selectedCampaign ? (
            <>
              <Card className="p-6">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="mr-auto">
                    <p className="text-sm font-semibold text-[#5D7185]">
                      Campaign detail
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold text-[#0B2A3D]">
                      {selectedCampaign.name}
                    </h2>
                    <p className="mt-2 text-sm text-[#5D7185]">
                      {selectedCampaign.description || "No description added."}
                    </p>
                  </div>
                  <Badge tone={statusTone(selectedCampaign.status)}>
                    {formatLabel(selectedCampaign.status)}
                  </Badge>
                </div>
                <form
                  className="mt-5 flex flex-col gap-3 sm:flex-row"
                  onSubmit={handleUpdateCampaign}
                >
                  <select
                    className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    onChange={(event) =>
                      setCampaignStatus(
                        event.target.value as MarketingCampaignStatus,
                      )
                    }
                    value={campaignStatus}
                  >
                    {marketingCampaignStatuses
                      .filter(
                        (status) =>
                          isOwnerAdmin ||
                          !["completed", "archived"].includes(status),
                      )
                      .map((status) => (
                        <option key={status} value={status}>
                          {formatLabel(status)}
                        </option>
                      ))}
                  </select>
                  <Button disabled={saving} type="submit">
                    Update Status
                  </Button>
                </form>
              </Card>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="p-6">
                  <h3 className="text-lg font-semibold text-[#0B2A3D]">
                    Audience
                  </h3>
                  <div className="mt-4 space-y-3">
                    {campaignLeads.length ? (
                      campaignLeads.map((campaignLead) => {
                        const lead = data?.crmLeads.find(
                          (item) => item.id === campaignLead.lead_id,
                        );
                        return (
                          <div
                            className="rounded-2xl border border-[#D8E8F0] p-4"
                            key={campaignLead.id}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="mr-auto font-semibold text-[#0B2A3D]">
                                {lead?.name ?? "Visible CRM lead"}
                              </p>
                              <Badge tone={campaignLeadTone(campaignLead.status)}>
                                {formatLabel(campaignLead.status)}
                              </Badge>
                            </div>
                            <p className="mt-2 text-xs text-[#7B8EA3]">
                              Last touch {formatDate(campaignLead.last_touch_at)}
                            </p>
                            <select
                              className="mt-3 rounded-2xl border border-[#D8E8F0] px-3 py-2 text-sm"
                              onChange={(event) =>
                                void handleUpdateCampaignLead(
                                  campaignLead,
                                  event.target.value as MarketingCampaignLeadStatus,
                                )
                              }
                              value={campaignLead.status}
                            >
                              {marketingCampaignLeadStatuses.map((status) => (
                                <option key={status} value={status}>
                                  {formatLabel(status)}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })
                    ) : (
                      <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
                        No CRM leads have been added to this campaign.
                      </p>
                    )}
                  </div>
                  <div className="mt-5 space-y-3">
                    <p className="text-sm font-semibold text-[#0B2A3D]">
                      Add visible CRM leads
                    </p>
                    <div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-[#D8E8F0] p-3">
                      {selectableLeads.length ? (
                        selectableLeads.map((lead) => (
                          <label
                            className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm text-[#425B76]"
                            key={lead.id}
                          >
                            <input
                              checked={leadSelection.includes(lead.id)}
                              onChange={(event) =>
                                setLeadSelection((current) =>
                                  event.target.checked
                                    ? [...current, lead.id]
                                    : current.filter((id) => id !== lead.id),
                                )
                              }
                              type="checkbox"
                            />
                            {lead.name}
                          </label>
                        ))
                      ) : (
                        <p className="text-sm text-[#5D7185]">
                          No visible CRM leads are available to add.
                        </p>
                      )}
                    </div>
                    <Button
                      disabled={saving || leadSelection.length === 0}
                      onClick={() => void handleAddAudience()}
                      size="sm"
                      type="button"
                    >
                      Add Audience
                    </Button>
                  </div>
                </Card>

                <Card className="p-6">
                  <h3 className="text-lg font-semibold text-[#0B2A3D]">
                    Log touch
                  </h3>
                  <form className="mt-4 space-y-3" onSubmit={handleLogTouch}>
                    <select
                      className="w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                      onChange={(event) =>
                        setTouchForm((current) => ({
                          ...current,
                          leadId: event.target.value,
                        }))
                      }
                      required
                      value={touchForm.leadId}
                    >
                      <option value="">Choose campaign lead</option>
                      {campaignLeads.map((campaignLead) => {
                        const lead = data?.crmLeads.find(
                          (item) => item.id === campaignLead.lead_id,
                        );
                        return (
                          <option key={campaignLead.id} value={campaignLead.lead_id}>
                            {lead?.name ?? campaignLead.lead_id.slice(0, 8)}
                          </option>
                        );
                      })}
                    </select>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <select
                        className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                        onChange={(event) =>
                          setTouchForm((current) => ({
                            ...current,
                            channel: event.target.value as MarketingChannel,
                          }))
                        }
                        value={touchForm.channel}
                      >
                        {marketingChannels.map((channel) => (
                          <option key={channel} value={channel}>
                            {formatLabel(channel)}
                          </option>
                        ))}
                      </select>
                      <select
                        className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                        onChange={(event) =>
                          setTouchForm((current) => ({
                            ...current,
                            templateId: event.target.value,
                          }))
                        }
                        value={touchForm.templateId}
                      >
                        <option value="">No template</option>
                        {(data?.templates ?? []).map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      className="min-h-28 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                      maxLength={1500}
                      onChange={(event) =>
                        setTouchForm((current) => ({
                          ...current,
                          note: event.target.value,
                        }))
                      }
                      placeholder="Record manual outreach notes"
                      value={touchForm.note}
                    />
                    <Button disabled={saving || !touchForm.leadId} type="submit">
                      Log Touch
                    </Button>
                  </form>
                </Card>
              </div>

              <Card className="p-6">
                <h3 className="text-lg font-semibold text-[#0B2A3D]">
                  Campaign activity
                </h3>
                <div className="mt-4 space-y-3">
                  {activity.length ? (
                    activity.map((item) => (
                      <div
                        className="rounded-2xl border border-[#D8E8F0] p-4"
                        key={item.id}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="mr-auto font-semibold text-[#0B2A3D]">
                            {formatLabel(item.activity_type)}
                          </p>
                          {item.channel ? (
                            <Badge tone="light">{formatLabel(item.channel)}</Badge>
                          ) : null}
                        </div>
                        {item.note ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-[#425B76]">
                            {item.note}
                          </p>
                        ) : null}
                        <p className="mt-2 text-xs text-[#7B8EA3]">
                          {formatDate(item.created_at)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
                      Campaign activity will appear after audience or touch
                      actions.
                    </p>
                  )}
                </div>
              </Card>
            </>
          ) : (
            <Card className="p-6">
              <p className="text-lg font-semibold text-[#0B2A3D]">
                No campaign selected
              </p>
              <p className="mt-2 text-sm text-[#5D7185]">
                Create or select a campaign to manage audience and activity.
              </p>
            </Card>
          )}

          <Card className="p-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="mr-auto">
                <h3 className="text-lg font-semibold text-[#0B2A3D]">
                  Message templates
                </h3>
                <p className="text-sm text-[#5D7185]">
                  Placeholder library only. Templates are not sent externally.
                </p>
              </div>
            </div>
            {isOwnerAdmin ? (
              <form className="mt-5 space-y-3" onSubmit={handleCreateTemplate}>
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    maxLength={180}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Template name"
                    required
                    value={templateForm.name}
                  />
                  <input
                    className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    maxLength={180}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        subject: event.target.value,
                      }))
                    }
                    placeholder="Subject"
                    value={templateForm.subject}
                  />
                  <select
                    className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        channel: event.target.value as MarketingTemplateChannel,
                      }))
                    }
                    value={templateForm.channel}
                  >
                    {marketingTemplateChannels.map((channel) => (
                      <option key={channel} value={channel}>
                        {formatLabel(channel)}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        templateType: event.target.value as MarketingTemplateType,
                      }))
                    }
                    value={templateForm.templateType}
                  >
                    {marketingTemplateTypes.map((type) => (
                      <option key={type} value={type}>
                        {formatLabel(type)}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        status: event.target.value as MarketingTemplateStatus,
                      }))
                    }
                    value={templateForm.status}
                  >
                    {marketingTemplateStatuses.map((status) => (
                      <option key={status} value={status}>
                        {formatLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  className="min-h-28 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                  maxLength={3000}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      body: event.target.value,
                    }))
                  }
                  required
                  value={templateForm.body}
                />
                <p className="text-xs text-[#5D7185]">
                  Safe placeholders supported: {"{{lead_name}}"},{" "}
                  {"{{course_name}}"}, {"{{tenant_name}}"}.
                </p>
                <Button disabled={saving} size="sm" type="submit">
                  Save Template
                </Button>
              </form>
            ) : null}
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {(data?.templates ?? []).length ? (
                (data?.templates ?? []).map((template) => (
                  <div
                    className="rounded-2xl border border-[#D8E8F0] p-4"
                    key={template.id}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="mr-auto font-semibold text-[#0B2A3D]">
                        {template.name}
                      </p>
                      <Badge tone={templateTone(template.status)}>
                        {formatLabel(template.status)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-[#5D7185]">
                      {formatLabel(template.channel)} |{" "}
                      {formatLabel(template.template_type)}
                    </p>
                    <p className="mt-2 line-clamp-3 text-sm text-[#425B76]">
                      {template.body}
                    </p>
                    {isOwnerAdmin ? (
                      <Button
                        className="mt-3"
                        disabled={saving}
                        onClick={() => void handleArchiveTemplate(template)}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        {template.status === "archived" ? "Restore" : "Archive"}
                      </Button>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-[#D8E8F0] p-4 text-sm text-[#5D7185]">
                  No templates have been created yet.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
