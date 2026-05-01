import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type TenantSettings = {
  brand_color: string | null;
  category: string | null;
  id: string;
  logo_url: string | null;
  name: string;
  owner_user_id: string | null;
  slug: string;
  support_email: string | null;
  support_phone: string | null;
  website_url: string | null;
};

export type UpdateTenantSettingsInput = {
  brandColor: string;
  logoUrl: string;
  name: string;
  supportEmail: string;
  supportPhone: string;
  websiteUrl: string;
};

const tenantSettingsSelect =
  "id,name,slug,category,owner_user_id,logo_url,brand_color,support_email,support_phone,website_url";

export const defaultTenantBrandColor = "#145da0";

const hexColorPattern = /^#[0-9a-f]{6}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeOptionalText(value: string) {
  const trimmed = value.trim();

  return trimmed || null;
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

function normalizeTenantSettingsPayload(data: UpdateTenantSettingsInput) {
  const name = data.name.trim();

  if (!name) {
    throw new Error("Workspace name is required.");
  }

  return {
    brand_color: normalizeBrandColor(data.brandColor),
    logo_url: normalizeOptionalUrl(data.logoUrl, "Logo URL"),
    name,
    support_email: normalizeOptionalEmail(data.supportEmail),
    support_phone: normalizeOptionalText(data.supportPhone),
    website_url: normalizeOptionalUrl(data.websiteUrl, "Website URL"),
  };
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
  const supabase = getSupabaseClient();
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

  return tenantSettings as TenantSettings;
}
