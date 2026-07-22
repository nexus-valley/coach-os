"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { canManageWorkspace } from "@/src/lib/permissions";
import {
  getPublicSiteLeads,
  updatePublicSiteSettings,
  type PublicSiteLead,
  type PublicSiteSettingsInput,
} from "@/src/lib/publicSite";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import { getTenantSettings, type TenantSettings } from "@/src/lib/tenantSettings";

type FormState = PublicSiteSettingsInput;

const emptyForm: FormState = {
  contactCtaText: "",
  publicAboutBody: "",
  publicAboutTitle: "",
  publicFooterNote: "",
  publicHeroCtaLabel: "",
  publicHeroSubtitle: "",
  publicHeroTitle: "",
  publicHighlight1Body: "",
  publicHighlight1Title: "",
  publicHighlight2Body: "",
  publicHighlight2Title: "",
  publicHighlight3Body: "",
  publicHighlight3Title: "",
  publicPageDescription: "",
  publicPageTitle: "",
  publicShowContactForm: true,
  publicShowCourses: true,
  publicShowSupportContact: true,
  publicSiteEnabled: false,
  slug: "",
};

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function createForm(settings: TenantSettings | null, tenant: Tenant): FormState {
  return {
    contactCtaText: settings?.contact_cta_text ?? "",
    publicAboutBody: settings?.public_about_body ?? "",
    publicAboutTitle: settings?.public_about_title ?? "",
    publicFooterNote: settings?.public_footer_note ?? "",
    publicHeroCtaLabel: settings?.public_hero_cta_label ?? "",
    publicHeroSubtitle: settings?.public_hero_subtitle ?? "",
    publicHeroTitle: settings?.public_hero_title ?? "",
    publicHighlight1Body: settings?.public_highlight_1_body ?? "",
    publicHighlight1Title: settings?.public_highlight_1_title ?? "",
    publicHighlight2Body: settings?.public_highlight_2_body ?? "",
    publicHighlight2Title: settings?.public_highlight_2_title ?? "",
    publicHighlight3Body: settings?.public_highlight_3_body ?? "",
    publicHighlight3Title: settings?.public_highlight_3_title ?? "",
    publicPageDescription: settings?.public_page_description ?? "",
    publicPageTitle: settings?.public_page_title ?? "",
    publicShowContactForm: settings?.public_show_contact_form ?? true,
    publicShowCourses: settings?.public_show_courses ?? true,
    publicShowSupportContact: settings?.public_show_support_contact ?? true,
    publicSiteEnabled: settings?.public_site_enabled ?? false,
    slug: settings?.slug ?? tenant.slug,
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function TextField(props: {
  label: string;
  maxLength?: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold text-[#0B1F33]">
      {props.label}
      <input
        className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm outline-none transition placeholder:text-[#66788F] focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
        maxLength={props.maxLength}
        onChange={props.onChange}
        placeholder={props.placeholder}
        required={props.required}
        value={props.value}
      />
    </label>
  );
}

function TextAreaField(props: {
  label: string;
  maxLength?: number;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold text-[#0B1F33]">
      {props.label}
      <textarea
        className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 outline-none transition placeholder:text-[#66788F] focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
        maxLength={props.maxLength}
        onChange={props.onChange}
        placeholder={props.placeholder}
        value={props.value}
      />
    </label>
  );
}

function ToggleField(props: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
      <input
        checked={props.checked}
        className="mt-1 h-4 w-4 accent-[#145DA0]"
        onChange={(event) => props.onChange(event.target.checked)}
        type="checkbox"
      />
      <span>
        <span className="block text-sm font-semibold text-[#0B1F33]">
          {props.label}
        </span>
        <span className="mt-1 block text-xs leading-5 text-[#66788F]">
          {props.description}
        </span>
      </span>
    </label>
  );
}

export function PublicSiteSettingsPage() {
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [leads, setLeads] = useState<PublicSiteLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [role, setRole] = useState<MemberRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const currentTenant = await getCurrentTenant();

      if (!currentTenant) {
        setError("Select or create a workspace before editing public site settings.");
        return;
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
        throw new Error("You must be logged in to edit public site settings.");
      }

      const currentRole = await getCurrentMemberRole(currentTenant.id, user.id);
      const settings = await getTenantSettings(currentTenant.id);

      setRole(currentRole);
      setTenant(currentTenant);
      setForm(createForm(settings, currentTenant));

      if (canManageWorkspace(currentRole)) {
        setLeads(await getPublicSiteLeads(currentTenant.id));
      }
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to load public site settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [load]);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setError("");
    setMessage("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !canManageWorkspace(role)) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await updatePublicSiteSettings(tenant.id, form);
      setMessage("Public page settings saved.");
      await load();
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to save public site settings."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-80 animate-pulse">
          <span className="sr-only">Loading public site settings</span>
        </Card>
      </div>
    );
  }

  if (role && !canManageWorkspace(role)) {
    return (
      <div className="mx-auto max-w-7xl">
        <AccessDeniedCard description="Public page settings can be edited by workspace owners and admins only." />
      </div>
    );
  }

  const publicUrl =
    typeof window === "undefined"
      ? `/site/${form.slug}`
      : `${window.location.origin}/site/${form.slug}`;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <Badge tone="owner">Public page</Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Public Page Builder
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#425B76]">
            Publish a CoachFort-hosted branded page with program previews and
            safe inquiry capture for prospects.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button href={`/site/${form.slug}`} type="button" variant="secondary">
            Open public page
          </Button>
          <Button disabled={saving} form="public-site-form" type="submit">
            {saving ? "Saving..." : "Save Public Page"}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <form className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]" id="public-site-form" onSubmit={handleSubmit}>
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <h2 className="text-xl font-semibold">Publishing</h2>
                <p className="mt-2 text-sm leading-6 text-[#425B76]">
                  The CoachFort-hosted public page is unavailable until
                  publishing is enabled.
                </p>
              </div>
              <Badge tone={form.publicSiteEnabled ? "success" : "warning"}>
                {form.publicSiteEnabled ? "Published" : "Disabled"}
              </Badge>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ToggleField
                checked={form.publicSiteEnabled}
                description="Allow public visitors to load this CoachFort-hosted coaching page."
                label="Enable public site"
                onChange={(checked) => updateField("publicSiteEnabled", checked)}
              />
              <TextField
                label="Public slug"
                onChange={(event) => updateField("slug", event.target.value)}
                placeholder="your-coaching-brand"
                required
                value={form.slug}
              />
            </div>
            <p className="mt-4 break-all rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] px-4 py-3 text-sm font-semibold text-[#0B2A3D]">
              {publicUrl}
            </p>
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold">Hero and page copy</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <TextField
                label="Page title"
                maxLength={120}
                onChange={(event) => updateField("publicPageTitle", event.target.value)}
                value={form.publicPageTitle}
              />
              <TextField
                label="CTA label"
                maxLength={60}
                onChange={(event) => updateField("publicHeroCtaLabel", event.target.value)}
                placeholder="Send inquiry"
                value={form.publicHeroCtaLabel}
              />
            </div>
            <div className="mt-4 grid gap-4">
              <TextField
                label="Hero headline"
                maxLength={140}
                onChange={(event) => updateField("publicHeroTitle", event.target.value)}
                value={form.publicHeroTitle}
              />
              <TextAreaField
                label="Hero subheadline"
                maxLength={320}
                onChange={(event) => updateField("publicHeroSubtitle", event.target.value)}
                value={form.publicHeroSubtitle}
              />
              <TextAreaField
                label="Page description"
                maxLength={220}
                onChange={(event) => updateField("publicPageDescription", event.target.value)}
                value={form.publicPageDescription}
              />
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold">About and highlights</h2>
            <div className="mt-5 grid gap-4">
              <TextField
                label="About title"
                maxLength={120}
                onChange={(event) => updateField("publicAboutTitle", event.target.value)}
                value={form.publicAboutTitle}
              />
              <TextAreaField
                label="About body"
                maxLength={1200}
                onChange={(event) => updateField("publicAboutBody", event.target.value)}
                value={form.publicAboutBody}
              />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {[1, 2, 3].map((number) => {
                const titleField = `publicHighlight${number}Title` as keyof FormState;
                const bodyField = `publicHighlight${number}Body` as keyof FormState;

                return (
                  <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4" key={number}>
                    <TextField
                      label={`Highlight ${number}`}
                      maxLength={90}
                      onChange={(event) =>
                        updateField(titleField, event.target.value as never)
                      }
                      value={String(form[titleField] ?? "")}
                    />
                    <div className="mt-4">
                      <TextAreaField
                        label="Body"
                        maxLength={320}
                        onChange={(event) =>
                          updateField(bodyField, event.target.value as never)
                        }
                        value={String(form[bodyField] ?? "")}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-xl font-semibold">Display options</h2>
            <div className="mt-5 space-y-3">
              <ToggleField
                checked={form.publicShowCourses}
                description="Show only published program preview cards."
                label="Show program previews"
                onChange={(checked) => updateField("publicShowCourses", checked)}
              />
              <ToggleField
                checked={form.publicShowContactForm}
                description="Allow visitors to submit inquiries into CoachFort."
                label="Show inquiry form"
                onChange={(checked) => updateField("publicShowContactForm", checked)}
              />
              <ToggleField
                checked={form.publicShowSupportContact}
                description="Display configured support email, phone, and website."
                label="Show support contact"
                onChange={(checked) =>
                  updateField("publicShowSupportContact", checked)
                }
              />
            </div>
            <div className="mt-4">
              <TextAreaField
                label="Footer note"
                maxLength={240}
                onChange={(event) => updateField("publicFooterNote", event.target.value)}
                value={form.publicFooterNote}
              />
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold">Preview</h2>
            <div className="mt-5 rounded-3xl border border-[#D8E8F0] bg-[#F6FBFE] p-5">
              <Badge tone={form.publicSiteEnabled ? "success" : "warning"}>
                {form.publicSiteEnabled ? "Public" : "Private"}
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                {form.publicHeroTitle ||
                  form.publicPageTitle ||
                  tenant?.name ||
                  "Public coaching page"}
              </h3>
              <p className="mt-3 text-sm leading-6 text-[#425B76]">
                {form.publicHeroSubtitle ||
                  form.publicPageDescription ||
                  "Add public page copy to preview the CoachFort-hosted page."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  form.publicShowCourses ? "Programs visible" : "Programs hidden",
                  form.publicShowContactForm ? "Inquiry form" : "No form",
                  form.publicShowSupportContact ? "Support shown" : "Support hidden",
                ].map((item) => (
                  <span
                    className="rounded-full border border-[#D8E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#425B76]"
                    key={item}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Recent inquiries</h2>
              <Badge>{leads.length}</Badge>
            </div>
            <div className="mt-5 space-y-3">
              {leads.length === 0 ? (
                <p className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4 text-sm text-[#425B76]">
                  Public inquiries will appear here after visitors submit the
                  form.
                </p>
              ) : (
                leads.map((lead) => (
                  <div
                    className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                    key={lead.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[#0B1F33]">
                          {lead.name}
                        </p>
                        <p className="mt-1 text-xs text-[#66788F]">
                          {formatDate(lead.created_at)}
                        </p>
                      </div>
                      <Badge tone="success">{lead.status}</Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[#425B76]">
                      {[lead.email, lead.phone].filter(Boolean).join(" | ") ||
                        "No contact detail"}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </form>
    </div>
  );
}
