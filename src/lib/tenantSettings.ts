import { logActivity } from "@/src/lib/auditLogger";
import { requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type TenantSettings = {
  address_line_1: string | null;
  address_line_2: string | null;
  brand_color: string | null;
  category: string | null;
  certificate_issuer_name: string | null;
  city: string | null;
  country: string | null;
  id: string;
  logo_url: string | null;
  name: string;
  owner_user_id: string | null;
  postal_code: string | null;
  receipt_footer_text: string | null;
  slug: string;
  state: string | null;
  support_email: string | null;
  support_phone: string | null;
  website_url: string | null;
  whatsapp_number: string | null;
  workspace_display_name: string | null;
};

export type UpdateTenantSettingsInput = {
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

export type WorkspaceBranding = {
  addressLines: string[];
  brandColor: string;
  certificateIssuerName: string;
  displayName: string;
  logoUrl: string | null;
  receiptFooterText: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  supportText: string | null;
  websiteUrl: string | null;
  whatsappNumber: string | null;
};

const tenantSettingsSelect =
  "id,name,slug,category,owner_user_id,workspace_display_name,logo_url,brand_color,support_email,support_phone,whatsapp_number,website_url,address_line_1,address_line_2,city,state,country,postal_code,certificate_issuer_name,receipt_footer_text";

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

function normalizeTenantSettingsPayload(data: UpdateTenantSettingsInput) {
  const displayName = normalizeRequiredText(
    data.workspaceDisplayName,
    "Institute / Academy name",
  );

  return {
    address_line_1: normalizeOptionalText(data.addressLine1),
    address_line_2: normalizeOptionalText(data.addressLine2),
    brand_color: normalizeBrandColor(data.brandColor),
    certificate_issuer_name: normalizeOptionalText(data.certificateIssuerName),
    city: normalizeOptionalText(data.city),
    country: normalizeOptionalText(data.country),
    logo_url: normalizeOptionalUrl(data.logoUrl, "Logo URL"),
    name: displayName,
    postal_code: normalizeOptionalText(data.postalCode),
    receipt_footer_text: normalizeOptionalText(data.receiptFooterText),
    state: normalizeOptionalText(data.state),
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
  const supportItems = [
    settings?.support_email,
    settings?.support_phone,
    settings?.whatsapp_number,
  ].filter((item): item is string => Boolean(item?.trim()));

  return {
    addressLines: compactAddress(settings),
    brandColor: getSafeTenantBrandColor(settings?.brand_color),
    certificateIssuerName:
      settings?.certificate_issuer_name?.trim() || displayName,
    displayName,
    logoUrl: settings?.logo_url?.trim() || null,
    receiptFooterText: settings?.receipt_footer_text?.trim() || null,
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
    "logo_url",
    "brand_color",
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
  ];

  return Object.fromEntries(
    fields
      .filter((field) => (previous?.[field] ?? null) !== (next[field] ?? null))
      .map((field) => [
        field,
        {
          next: next[field] ?? null,
          previous: previous?.[field] ?? null,
        },
      ]),
  );
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
  const payload = normalizeTenantSettingsPayload(data);
  const { data: tenantSettings, error } = await supabase
    .from("tenants")
    .update(payload)
    .eq("id", tenantId)
    .select(tenantSettingsSelect)
    .single();

  if (error) {
    throw error;
  }

  const settings = tenantSettings as TenantSettings;
  const changedFields = getSafeChangedBrandingFields(previousSettings, settings);

  await logActivity({
    action: "workspace_branding_updated",
    description: "Updated workspace branding",
    entityId: settings.id,
    entityName:
      settings.workspace_display_name || settings.name || "Workspace branding",
    entityType: "workspace_settings",
    metadata: {
      changedFields,
      changedFieldNames: Object.keys(changedFields),
    },
    severity: "warning",
    tenantId: settings.id,
  });

  return settings;
}
