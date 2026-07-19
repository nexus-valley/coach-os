"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { canManageWorkspace } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import {
  defaultTenantBrandColor,
  getSafeTenantBrandColor,
  getTenantSettings,
  getWorkspaceBranding,
  updateTenantSettings,
  type TenantSettings,
  type UpdateTenantSettingsInput,
} from "@/src/lib/tenantSettings";

type BrandingFormState = Required<UpdateTenantSettingsInput>;

const emptyForm: BrandingFormState = {
  accentColor: "",
  addressLine1: "",
  addressLine2: "",
  brandColor: defaultTenantBrandColor,
  brandName: "",
  brandTagline: "",
  certificateIssuerName: "",
  city: "",
  contactCtaText: "",
  country: "",
  iconUrl: "",
  logoUrl: "",
  portalLoginMessage: "",
  portalWelcomeSubtitle: "",
  portalWelcomeTitle: "",
  postalCode: "",
  publicPageDescription: "",
  publicPageTitle: "",
  receiptFooterText: "",
  showPoweredBy: true,
  state: "",
  studentPortalThemeColor: defaultTenantBrandColor,
  supportEmail: "",
  supportPhone: "",
  websiteUrl: "",
  whatsappNumber: "",
  workspaceDisplayName: "",
};

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function createForm(settings: TenantSettings | null, tenant: Tenant): BrandingFormState {
  const branding = getWorkspaceBranding(settings, tenant);

  return {
    accentColor: settings?.accent_color ?? "",
    addressLine1: settings?.address_line_1 ?? "",
    addressLine2: settings?.address_line_2 ?? "",
    brandColor: getSafeTenantBrandColor(settings?.brand_color),
    brandName: settings?.brand_name ?? "",
    brandTagline: settings?.brand_tagline ?? "",
    certificateIssuerName: settings?.certificate_issuer_name ?? "",
    city: settings?.city ?? "",
    contactCtaText: settings?.contact_cta_text ?? "",
    country: settings?.country ?? "",
    iconUrl: settings?.icon_url ?? "",
    logoUrl: settings?.logo_url ?? "",
    portalLoginMessage: settings?.portal_login_message ?? "",
    portalWelcomeSubtitle: settings?.portal_welcome_subtitle ?? "",
    portalWelcomeTitle: settings?.portal_welcome_title ?? "",
    postalCode: settings?.postal_code ?? "",
    publicPageDescription: settings?.public_page_description ?? "",
    publicPageTitle: settings?.public_page_title ?? "",
    receiptFooterText: settings?.receipt_footer_text ?? "",
    showPoweredBy: settings?.show_powered_by ?? true,
    state: settings?.state ?? "",
    studentPortalThemeColor:
      settings?.student_portal_theme_color ?? branding.brandColor,
    supportEmail: settings?.support_email ?? "",
    supportPhone: settings?.support_phone ?? "",
    websiteUrl: settings?.website_url ?? "",
    whatsappNumber: settings?.whatsapp_number ?? "",
    workspaceDisplayName: branding.displayName,
  };
}

function TextField({
  disabled,
  help,
  label,
  name,
  onChange,
  placeholder,
  required,
  type = "text",
  value,
}: {
  disabled: boolean;
  help?: string;
  label: string;
  name: keyof BrandingFormState;
  onChange: (name: keyof BrandingFormState, value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-[#66788F]">{label}</span>
      <input
        className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/15 disabled:bg-[#F3FAFD] disabled:text-[#66788F]"
        disabled={disabled}
        onChange={(event) => onChange(name, event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
      {help ? <p className="mt-1 text-xs leading-5 text-[#66788F]">{help}</p> : null}
    </label>
  );
}

function PreviewLogo({
  displayName,
  logoUrl,
}: {
  displayName: string;
  logoUrl: string;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${displayName} logo`}
        className="h-12 w-12 rounded-2xl object-cover"
        src={logoUrl}
      />
    );
  }

  return <CoachFortBrandAsset className="h-12 w-12" variant="appIcon" />;
}

function BrandPreviewCard({ form }: { form: BrandingFormState }) {
  const displayName = form.workspaceDisplayName.trim() || "CoachFort";
  const brandName = form.brandName.trim() || displayName;
  const brandColor = getSafeTenantBrandColor(form.brandColor);
  const portalColor = getSafeTenantBrandColor(
    form.studentPortalThemeColor || form.brandColor,
  );

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden p-0 shadow-sm">
        <div className="p-5" style={{ borderTop: `6px solid ${brandColor}` }}>
          <Badge>Internal app preview</Badge>
          <div className="mt-5 flex items-center gap-3">
            <PreviewLogo displayName={displayName} logoUrl={form.logoUrl} />
            <div>
              <p className="text-xs font-semibold text-[#66788F]">
                powered by CoachFort
              </p>
              <h3 className="text-xl font-semibold text-[#0B1F33]">
                {displayName}
              </h3>
              <p className="text-sm text-[#425B76]">
                {form.brandTagline || "Workspace operations dashboard"}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden p-0 shadow-sm">
        <div className="p-5" style={{ borderTop: `6px solid ${portalColor}` }}>
          <Badge tone="admin">Student portal preview</Badge>
          <h3 className="mt-5 text-2xl font-semibold text-[#0B1F33]">
            {form.portalWelcomeTitle || `Welcome to ${displayName}`}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[#425B76]">
            {form.portalWelcomeSubtitle ||
              "Track classes, assignments, attendance, certificates, and payments in one place."}
          </p>
          <div className="mt-5 rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
            <p className="font-semibold" style={{ color: portalColor }}>
              {brandName}
            </p>
            <p className="mt-1 text-sm text-[#425B76]">
              {form.portalLoginMessage ||
                "Use your student credentials to open your learning portal."}
            </p>
            {form.showPoweredBy ? (
              <p className="mt-3 text-xs font-semibold text-[#66788F]">
                powered by CoachFort
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

export function BrandingSettingsPage() {
  const [error, setError] = useState("");
  const [form, setForm] = useState<BrandingFormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [role, setRole] = useState<MemberRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const loadBranding = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const currentTenant = await getCurrentTenant();

      if (!currentTenant) {
        setError("Select or create a workspace before editing branding.");
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
        throw new Error("You must be logged in to edit branding.");
      }

      const [currentRole, settings] = await Promise.all([
        getCurrentMemberRole(currentTenant.id, user.id),
        getTenantSettings(currentTenant.id),
      ]);

      setRole(currentRole);
      setTenant(currentTenant);
      setForm(createForm(settings, currentTenant));
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to load branding settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadBranding();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadBranding]);

  const canEdit = canManageWorkspace(role);

  function updateField(name: keyof BrandingFormState, value: string) {
    setMessage("");
    setError("");
    setForm((current) => ({ ...current, [name]: value }));
  }

  function resetToDefaults() {
    setMessage("");
    setError("");
    setForm((current) => ({
      ...current,
      accentColor: "",
      brandColor: defaultTenantBrandColor,
      brandName: tenant?.name ?? "",
      brandTagline: "",
      contactCtaText: "",
      iconUrl: "",
      logoUrl: "",
      portalLoginMessage: "",
      portalWelcomeSubtitle: "",
      portalWelcomeTitle: "",
      publicPageDescription: "",
      publicPageTitle: "",
      showPoweredBy: true,
      studentPortalThemeColor: defaultTenantBrandColor,
      workspaceDisplayName: tenant?.name ?? current.workspaceDisplayName,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !canEdit) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const updatedSettings = await updateTenantSettings(tenant.id, form);
      setTenant((currentTenant) =>
        currentTenant ? { ...currentTenant, name: updatedSettings.name } : null,
      );
      setForm(createForm(updatedSettings, {
        ...tenant,
        name: updatedSettings.name,
      }));
      setMessage("White label branding saved.");
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to save branding settings."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse">
          <span className="sr-only">Loading branding settings</span>
        </Card>
      </div>
    );
  }

  if (role && !canEdit) {
    return (
      <div className="mx-auto max-w-7xl">
        <AccessDeniedCard description="White label branding can be edited by workspace owners and admins only." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <Badge tone="owner">Tenant customization</Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            White Label Branding
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#425B76]">
            Configure your coaching brand identity, portal copy, support
            details, and brand colors for student-facing and workspace-facing
            experiences.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={resetToDefaults} type="button" variant="secondary">
            Reset Defaults
          </Button>
          <Button disabled={saving} form="branding-settings-form" type="submit">
            {saving ? "Saving..." : "Save Branding"}
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="mt-6 border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </Card>
      ) : null}
      {message ? (
        <Card className="mt-6 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {message}
        </Card>
      ) : null}

      <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_0.85fr]">
        <form
          className="space-y-6"
          id="branding-settings-form"
          onSubmit={handleSubmit}
        >
          <Card className="p-6 shadow-sm">
            <Badge>Basic identity</Badge>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <TextField
                disabled={!canEdit || saving}
                label="Institute / Academy Name"
                name="workspaceDisplayName"
                onChange={updateField}
                required
                value={form.workspaceDisplayName}
              />
              <TextField
                disabled={!canEdit || saving}
                label="Short Brand Name"
                name="brandName"
                onChange={updateField}
                placeholder="Anand NEET"
                value={form.brandName}
              />
              <TextField
                disabled={!canEdit || saving}
                label="Tagline"
                name="brandTagline"
                onChange={updateField}
                placeholder="Focused coaching for serious learners"
                value={form.brandTagline}
              />
              <TextField
                disabled={!canEdit || saving}
                label="Contact CTA Text"
                name="contactCtaText"
                onChange={updateField}
                placeholder="Contact admissions"
                value={form.contactCtaText}
              />
            </div>
          </Card>

          <Card className="p-6 shadow-sm">
            <Badge>Visual system</Badge>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <TextField
                disabled={!canEdit || saving}
                help="Use http or https URLs only."
                label="Logo URL"
                name="logoUrl"
                onChange={updateField}
                placeholder="https://example.com/logo.png"
                type="url"
                value={form.logoUrl}
              />
              <TextField
                disabled={!canEdit || saving}
                help="Optional square icon or favicon-style image."
                label="Icon URL"
                name="iconUrl"
                onChange={updateField}
                placeholder="https://example.com/icon.png"
                type="url"
                value={form.iconUrl}
              />
              <TextField
                disabled={!canEdit || saving}
                label="Primary Brand Color"
                name="brandColor"
                onChange={updateField}
                placeholder="#145da0"
                type="color"
                value={form.brandColor}
              />
              <TextField
                disabled={!canEdit || saving}
                label="Accent Color"
                name="accentColor"
                onChange={updateField}
                placeholder="#14b8c6"
                type="color"
                value={form.accentColor || defaultTenantBrandColor}
              />
            </div>
          </Card>

          <Card className="p-6 shadow-sm">
            <Badge>Support and web</Badge>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <TextField
                disabled={!canEdit || saving}
                label="Support Email"
                name="supportEmail"
                onChange={updateField}
                type="email"
                value={form.supportEmail}
              />
              <TextField
                disabled={!canEdit || saving}
                label="Support Phone"
                name="supportPhone"
                onChange={updateField}
                value={form.supportPhone}
              />
              <TextField
                disabled={!canEdit || saving}
                label="WhatsApp Number"
                name="whatsappNumber"
                onChange={updateField}
                value={form.whatsappNumber}
              />
              <TextField
                disabled={!canEdit || saving}
                label="Website URL"
                name="websiteUrl"
                onChange={updateField}
                type="url"
                value={form.websiteUrl}
              />
            </div>
          </Card>

          <Card className="p-6 shadow-sm">
            <Badge>Student portal</Badge>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <TextField
                disabled={!canEdit || saving}
                label="Portal Welcome Title"
                name="portalWelcomeTitle"
                onChange={updateField}
                value={form.portalWelcomeTitle}
              />
              <TextField
                disabled={!canEdit || saving}
                label="Portal Theme Color"
                name="studentPortalThemeColor"
                onChange={updateField}
                type="color"
                value={form.studentPortalThemeColor || form.brandColor}
              />
              <TextField
                disabled={!canEdit || saving}
                label="Portal Subtitle"
                name="portalWelcomeSubtitle"
                onChange={updateField}
                value={form.portalWelcomeSubtitle}
              />
              <TextField
                disabled={!canEdit || saving}
                label="Login Page Message"
                name="portalLoginMessage"
                onChange={updateField}
                value={form.portalLoginMessage}
              />
            </div>
            <label className="mt-5 flex items-center gap-3 rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4 text-sm font-semibold text-[#0B1F33]">
              <input
                checked={form.showPoweredBy}
                disabled={!canEdit || saving}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setForm((current) => ({
                    ...current,
                    showPoweredBy: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Show “powered by CoachFort” in student portal
            </label>
          </Card>

          <Card className="p-6 shadow-sm">
            <Badge>Public page readiness</Badge>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <TextField
                disabled={!canEdit || saving}
                label="Public Page Title"
                name="publicPageTitle"
                onChange={updateField}
                value={form.publicPageTitle}
              />
              <TextField
                disabled={!canEdit || saving}
                label="Public Page Description"
                name="publicPageDescription"
                onChange={updateField}
                value={form.publicPageDescription}
              />
            </div>
          </Card>
        </form>

        <aside className="xl:sticky xl:top-24 xl:self-start">
          <BrandPreviewCard form={form} />
        </aside>
      </div>
    </div>
  );
}
