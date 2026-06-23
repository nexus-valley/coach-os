import { logActivity } from "@/src/lib/auditLogger";
import { requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type TenantSettings = {
  accent_color: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  brand_name: string | null;
  brand_tagline: string | null;
  brand_color: string | null;
  branding_json: Record<string, unknown> | null;
  category: string | null;
  certificate_issuer_name: string | null;
  city: string | null;
  contact_cta_text: string | null;
  country: string | null;
  icon_url: string | null;
  id: string;
  logo_url: string | null;
  name: string;
  owner_user_id: string | null;
  postal_code: string | null;
  portal_login_message: string | null;
  portal_welcome_subtitle: string | null;
  portal_welcome_title: string | null;
  public_about_body: string | null;
  public_about_title: string | null;
  public_footer_note: string | null;
  public_hero_cta_label: string | null;
  public_hero_subtitle: string | null;
  public_hero_title: string | null;
  public_highlight_1_body: string | null;
  public_highlight_1_title: string | null;
  public_highlight_2_body: string | null;
  public_highlight_2_title: string | null;
  public_highlight_3_body: string | null;
  public_highlight_3_title: string | null;
  public_page_description: string | null;
  public_page_title: string | null;
  public_show_contact_form: boolean | null;
  public_show_courses: boolean | null;
  public_show_support_contact: boolean | null;
  public_site_enabled: boolean | null;
  receipt_footer_text: string | null;
  show_powered_by: boolean | null;
  slug: string;
  state: string | null;
  student_portal_theme_color: string | null;
  support_email: string | null;
  support_phone: string | null;
  website_url: string | null;
  whatsapp_number: string | null;
  workspace_display_name: string | null;
};

export type UpdateTenantSettingsInput = {
  accentColor?: string;
  addressLine1: string;
  addressLine2: string;
  brandName?: string;
  brandTagline?: string;
  brandColor: string;
  certificateIssuerName: string;
  city: string;
  contactCtaText?: string;
  country: string;
  iconUrl?: string;
  logoUrl: string;
  postalCode: string;
  portalLoginMessage?: string;
  portalWelcomeSubtitle?: string;
  portalWelcomeTitle?: string;
  publicPageDescription?: string;
  publicPageTitle?: string;
  receiptFooterText: string;
  showPoweredBy?: boolean;
  state: string;
  studentPortalThemeColor?: string;
  supportEmail: string;
  supportPhone: string;
  websiteUrl: string;
  whatsappNumber: string;
  workspaceDisplayName: string;
};

export type WorkspaceBranding = {
  accentColor: string;
  addressLines: string[];
  brandName: string;
  brandColor: string;
  brandTagline: string | null;
  certificateIssuerName: string;
  contactCtaText: string;
  displayName: string;
  iconUrl: string | null;
  logoUrl: string | null;
  portalLoginMessage: string | null;
  portalWelcomeSubtitle: string;
  portalWelcomeTitle: string;
  publicPageDescription: string | null;
  publicPageTitle: string | null;
  receiptFooterText: string | null;
  showPoweredBy: boolean;
  studentPortalThemeColor: string;
  supportEmail: string | null;
  supportPhone: string | null;
  supportText: string | null;
  websiteUrl: string | null;
  whatsappNumber: string | null;
};

const tenantSettingsSelect =
  "id,name,slug,category,owner_user_id,workspace_display_name,brand_name,brand_tagline,logo_url,icon_url,brand_color,accent_color,student_portal_theme_color,support_email,support_phone,whatsapp_number,website_url,address_line_1,address_line_2,city,state,country,postal_code,certificate_issuer_name,receipt_footer_text,portal_welcome_title,portal_welcome_subtitle,portal_login_message,show_powered_by,public_site_enabled,public_page_title,public_page_description,contact_cta_text,public_hero_title,public_hero_subtitle,public_hero_cta_label,public_about_title,public_about_body,public_highlight_1_title,public_highlight_1_body,public_highlight_2_title,public_highlight_2_body,public_highlight_3_title,public_highlight_3_body,public_show_courses,public_show_contact_form,public_show_support_contact,public_footer_note,branding_json";

export const defaultTenantBrandColor = "#145da0";

const hexColorPattern = /^#[0-9a-f]{6}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[+0-9()\-\s]{7,24}$/;

function normalizeOptionalText(value: string) {
  const trimmed = value.trim();

  return trimmed || null;
}

function normalizeRequiredText(value: string, label: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function normalizeBrandColor(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return defaultTenantBrandColor;
  }

  if (!hexColorPattern.test(trimmed)) {
    throw new Error("Brand color must be a valid hex value like #14b8a6.");
  }

  return trimmed.toLowerCase();
}

function normalizeOptionalBrandColor(value: string | undefined, fallback: string | null) {
  if (typeof value === "undefined") {
    return fallback;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (!hexColorPattern.test(trimmed)) {
    throw new Error("Color values must be valid hex values like #14b8a6.");
  }

  return trimmed.toLowerCase();
}

export function getSafeTenantBrandColor(value: string | null | undefined) {
  return value && hexColorPattern.test(value) ? value : defaultTenantBrandColor;
}

function normalizeOptionalEmail(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (!emailPattern.test(trimmed)) {
    throw new Error("Support email must be a valid email address.");
  }

  return trimmed;
}

function normalizeOptionalUrl(value: string, label: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmed);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error();
    }

    return parsedUrl.toString();
  } catch {
    throw new Error(`${label} must be a valid http or https URL.`);
  }
}

function normalizeOptionalUrlValue(
  value: string | undefined,
  fallback: string | null,
  label: string,
) {
  if (typeof value === "undefined") {
    return fallback;
  }

  return normalizeOptionalUrl(value, label);
}

function normalizeOptionalInputText(value: string | undefined, fallback: string | null) {
  if (typeof value === "undefined") {
    return fallback;
  }

  return normalizeOptionalText(value);
}

function normalizeOptionalPhone(value: string, label: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (!phonePattern.test(trimmed)) {
    throw new Error(`${label} must be a valid phone number.`);
  }

  return trimmed;
}

function normalizeTenantSettingsPayload(
  data: UpdateTenantSettingsInput,
  previous: TenantSettings | null,
) {
  const displayName = normalizeRequiredText(
    data.workspaceDisplayName,
    "Institute / Academy name",
  );
  const brandColor = normalizeBrandColor(data.brandColor);

  return {
    accent_color: normalizeOptionalBrandColor(
      data.accentColor,
      previous?.accent_color ?? null,
    ),
    address_line_1: normalizeOptionalText(data.addressLine1),
    address_line_2: normalizeOptionalText(data.addressLine2),
    brand_color: brandColor,
    brand_name: normalizeOptionalInputText(
      data.brandName,
      previous?.brand_name ?? null,
    ),
    brand_tagline: normalizeOptionalInputText(
      data.brandTagline,
      previous?.brand_tagline ?? null,
    ),
    certificate_issuer_name: normalizeOptionalText(data.certificateIssuerName),
    city: normalizeOptionalText(data.city),
    contact_cta_text: normalizeOptionalInputText(
      data.contactCtaText,
      previous?.contact_cta_text ?? null,
    ),
    country: normalizeOptionalText(data.country),
    icon_url: normalizeOptionalUrlValue(
      data.iconUrl,
      previous?.icon_url ?? null,
      "Icon URL",
    ),
    logo_url: normalizeOptionalUrl(data.logoUrl, "Logo URL"),
    name: displayName,
    postal_code: normalizeOptionalText(data.postalCode),
    portal_login_message: normalizeOptionalInputText(
      data.portalLoginMessage,
      previous?.portal_login_message ?? null,
    ),
    portal_welcome_subtitle: normalizeOptionalInputText(
      data.portalWelcomeSubtitle,
      previous?.portal_welcome_subtitle ?? null,
    ),
    portal_welcome_title: normalizeOptionalInputText(
      data.portalWelcomeTitle,
      previous?.portal_welcome_title ?? null,
    ),
    public_page_description: normalizeOptionalInputText(
      data.publicPageDescription,
      previous?.public_page_description ?? null,
    ),
    public_page_title: normalizeOptionalInputText(
      data.publicPageTitle,
      previous?.public_page_title ?? null,
    ),
    receipt_footer_text: normalizeOptionalText(data.receiptFooterText),
    show_powered_by: data.showPoweredBy ?? previous?.show_powered_by ?? true,
    state: normalizeOptionalText(data.state),
    student_portal_theme_color:
      normalizeOptionalBrandColor(
        data.studentPortalThemeColor,
        previous?.student_portal_theme_color ?? null,
      ) ?? brandColor,
    support_email: normalizeOptionalEmail(data.supportEmail),
    support_phone: normalizeOptionalPhone(data.supportPhone, "Support phone"),
    website_url: normalizeOptionalUrl(data.websiteUrl, "Website URL"),
    whatsapp_number: normalizeOptionalPhone(
      data.whatsappNumber,
      "WhatsApp number",
    ),
    workspace_display_name: displayName,
  };
}

function compactAddress(settings: TenantSettings | null | undefined) {
  return [
    settings?.address_line_1,
    settings?.address_line_2,
    [settings?.city, settings?.state, settings?.postal_code]
      .filter(Boolean)
      .join(", "),
    settings?.country,
  ].filter((line): line is string => Boolean(line?.trim()));
}

export function getWorkspaceBranding(
  settings: TenantSettings | null | undefined,
  fallbackTenant?: { name?: string | null } | null,
): WorkspaceBranding {
  const displayName =
    settings?.workspace_display_name?.trim() ||
    settings?.name?.trim() ||
    fallbackTenant?.name?.trim() ||
    "CoachFort";
  const brandName = settings?.brand_name?.trim() || displayName;
  const brandColor = getSafeTenantBrandColor(settings?.brand_color);
  const accentColor = getSafeTenantBrandColor(
    settings?.accent_color || settings?.brand_color,
  );
  const portalThemeColor = getSafeTenantBrandColor(
    settings?.student_portal_theme_color || settings?.brand_color,
  );
  const supportItems = [
    settings?.support_email,
    settings?.support_phone,
    settings?.whatsapp_number,
  ].filter((item): item is string => Boolean(item?.trim()));

  return {
    accentColor,
    addressLines: compactAddress(settings),
    brandColor,
    brandName,
    brandTagline: settings?.brand_tagline?.trim() || null,
    certificateIssuerName:
      settings?.certificate_issuer_name?.trim() || displayName,
    contactCtaText: settings?.contact_cta_text?.trim() || "Contact support",
    displayName,
    iconUrl: settings?.icon_url?.trim() || null,
    logoUrl: settings?.logo_url?.trim() || null,
    portalLoginMessage:
      settings?.portal_login_message?.trim() ||
      "Use your student credentials to open your learning portal.",
    portalWelcomeSubtitle:
      settings?.portal_welcome_subtitle?.trim() ||
      "Track classes, assignments, attendance, certificates, and payments in one place.",
    portalWelcomeTitle:
      settings?.portal_welcome_title?.trim() || `Welcome to ${displayName}`,
    publicPageDescription: settings?.public_page_description?.trim() || null,
    publicPageTitle: settings?.public_page_title?.trim() || null,
    receiptFooterText: settings?.receipt_footer_text?.trim() || null,
    showPoweredBy: settings?.show_powered_by ?? true,
    studentPortalThemeColor: portalThemeColor,
    supportEmail: settings?.support_email ?? null,
    supportPhone: settings?.support_phone ?? null,
    supportText: supportItems.length > 0 ? supportItems.join(" | ") : null,
    websiteUrl: settings?.website_url ?? null,
    whatsappNumber: settings?.whatsapp_number ?? null,
  };
}

function getSafeChangedBrandingFields(
  previous: TenantSettings | null,
  next: TenantSettings,
) {
  const fields: (keyof TenantSettings)[] = [
    "workspace_display_name",
    "brand_name",
    "brand_tagline",
    "logo_url",
    "icon_url",
    "brand_color",
    "accent_color",
    "student_portal_theme_color",
    "support_email",
    "support_phone",
    "whatsapp_number",
    "website_url",
    "address_line_1",
    "address_line_2",
    "city",
    "state",
    "country",
    "postal_code",
    "certificate_issuer_name",
    "receipt_footer_text",
    "portal_welcome_title",
    "portal_welcome_subtitle",
    "portal_login_message",
    "show_powered_by",
    "public_page_title",
    "public_page_description",
    "contact_cta_text",
  ];

  return fields.filter((field) => (previous?.[field] ?? null) !== (next[field] ?? null));
}

export async function getTenantSettings(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenants")
    .select(tenantSettingsSelect)
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as TenantSettings | null) ?? null;
}

export async function updateTenantSettings(
  tenantId: string,
  data: UpdateTenantSettingsInput,
) {
  await requireTenantPermission({
    description: "Blocked workspace branding/settings update without owner permission.",
    permission: "manage_workspace",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const previousSettings = await getTenantSettings(tenantId);
  const payload = normalizeTenantSettingsPayload(data, previousSettings);
  const { data: tenantSettings, error } = await supabase
    .rpc("update_tenant_branding_settings", {
      p_accent_color: payload.accent_color,
      p_address_line_1: payload.address_line_1,
      p_address_line_2: payload.address_line_2,
      p_brand_color: payload.brand_color,
      p_brand_name: payload.brand_name,
      p_brand_tagline: payload.brand_tagline,
      p_certificate_issuer_name: payload.certificate_issuer_name,
      p_city: payload.city,
      p_contact_cta_text: payload.contact_cta_text,
      p_country: payload.country,
      p_icon_url: payload.icon_url,
      p_logo_url: payload.logo_url,
      p_portal_login_message: payload.portal_login_message,
      p_portal_welcome_subtitle: payload.portal_welcome_subtitle,
      p_portal_welcome_title: payload.portal_welcome_title,
      p_postal_code: payload.postal_code,
      p_public_page_description: payload.public_page_description,
      p_public_page_title: payload.public_page_title,
      p_receipt_footer_text: payload.receipt_footer_text,
      p_show_powered_by: payload.show_powered_by,
      p_state: payload.state,
      p_student_portal_theme_color: payload.student_portal_theme_color,
      p_support_email: payload.support_email,
      p_support_phone: payload.support_phone,
      p_tenant_id: tenantId,
      p_website_url: payload.website_url,
      p_whatsapp_number: payload.whatsapp_number,
      p_workspace_display_name: payload.workspace_display_name,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  const settings = tenantSettings as TenantSettings;
  const changedFieldNames = getSafeChangedBrandingFields(
    previousSettings,
    settings,
  );

  await logActivity({
    action: "branding_updated",
    description: "Updated workspace branding",
    entityId: settings.id,
    entityName:
      settings.workspace_display_name || settings.name || "Workspace branding",
    entityType: "tenant",
    metadata: {
      changedFieldCount: changedFieldNames.length,
      changedFieldNames,
    },
    severity: "warning",
    tenantId: settings.id,
  });

  return settings;
}
