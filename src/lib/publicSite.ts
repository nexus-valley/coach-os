import { logActivity } from "@/src/lib/auditLogger";
import {
  getMemberRoleForTenant,
  requireTenantPermission,
} from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type PublicSiteCoursePreview = {
  access_duration_label: string | null;
  description: string | null;
  id: string;
  price_amount: number | null;
  pricing_type: "free" | "paid" | null;
  public_sales_enabled: boolean;
  sales_currency: string | null;
  slug: string;
  thumbnail_url: string | null;
  title: string;
};

export type PublicSiteTenant = {
  accent_color: string | null;
  brand_color: string | null;
  brand_name: string | null;
  brand_tagline: string | null;
  icon_url: string | null;
  id: string;
  logo_url: string | null;
  name: string;
  show_powered_by: boolean | null;
  slug: string;
  support_email: string | null;
  support_phone: string | null;
  website_url: string | null;
  workspace_display_name: string | null;
};

export type PublicSiteSettings = {
  contact_cta_text: string | null;
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
  public_show_contact_form: boolean;
  public_show_courses: boolean;
  public_show_support_contact: boolean;
  public_site_enabled: boolean;
};

export type PublicSitePayload = {
  courses: PublicSiteCoursePreview[];
  site: PublicSiteSettings;
  tenant: PublicSiteTenant;
};

export type PublicProgramSalesProgram = {
  access_duration_label: string | null;
  description: string | null;
  external_payment_url: string | null;
  id: string;
  payment_instructions: string | null;
  price_amount: number | null;
  pricing_type: "free" | "paid";
  sales_currency: string;
  sales_headline: string | null;
  sales_payment_mode: "external" | "manual";
  sales_summary: string | null;
  slug: string;
  thumbnail_url: string | null;
  title: string;
};

export type PublicProgramSalesPagePayload = {
  program: PublicProgramSalesProgram;
  registration: {
    enabled: boolean;
    interested_course_id: string;
  };
  site: Pick<
    PublicSiteSettings,
    | "contact_cta_text"
    | "public_footer_note"
    | "public_hero_cta_label"
    | "public_hero_subtitle"
    | "public_hero_title"
    | "public_page_description"
    | "public_page_title"
    | "public_show_contact_form"
    | "public_show_support_contact"
    | "public_site_enabled"
  >;
  tenant: PublicSiteTenant;
};

export type PublicSiteLead = {
  approval_enrollment_action?: "created" | "reused" | null;
  approval_student_action?: "created" | "matched" | "selected" | null;
  converted_at?: string | null;
  converted_enrollment_id?: string | null;
  converted_student_id?: string | null;
  conversion_note?: string | null;
  created_at: string;
  email: string | null;
  enrollment_request_status?:
    | "enrolled"
    | "needs_attention"
    | "new"
    | "processing"
    | "rejected";
  id: string;
  interested_course_id: string | null;
  metadata_json?: Record<string, unknown> | null;
  message: string | null;
  name: string;
  phone: string | null;
  source: string | null;
  status: "new" | "contacted" | "converted" | "closed";
};

export type EnrollmentRequestStudentCandidate = {
  email: string | null;
  full_name: string;
  id: string;
  phone: string | null;
  status: "active";
};

export type ApprovePublicProgramEnrollmentRequestInput = {
  conversionNote?: string;
  existingStudentId?: null | string;
  leadId: string;
  studentAction: "create" | "existing";
  studentEmail?: string;
  studentName?: string;
  studentPhone?: string;
  tenantId: string;
};

export type ApprovePublicProgramEnrollmentRequestResult = {
  enrollment_action?: "created" | "reused";
  enrollment_request_status: "enrolled" | "needs_attention";
  error_code?: string;
  message?: string;
  portal_access_status: "not_started";
  replayed: boolean;
  request_id: string;
  enrollment?: {
    id: string;
    status: string;
  };
  student?: {
    id: string;
    status: string;
  };
  student_action?: "created" | "matched" | "selected";
};

export type PublicSiteSettingsInput = {
  contactCtaText: string;
  publicAboutBody: string;
  publicAboutTitle: string;
  publicFooterNote: string;
  publicHeroCtaLabel: string;
  publicHeroSubtitle: string;
  publicHeroTitle: string;
  publicHighlight1Body: string;
  publicHighlight1Title: string;
  publicHighlight2Body: string;
  publicHighlight2Title: string;
  publicHighlight3Body: string;
  publicHighlight3Title: string;
  publicPageDescription: string;
  publicPageTitle: string;
  publicShowContactForm: boolean;
  publicShowCourses: boolean;
  publicShowSupportContact: boolean;
  publicSiteEnabled: boolean;
  slug: string;
};

export type SubmitPublicSiteLeadInput = {
  email: string;
  interestedCourseId?: string | null;
  metadata?: {
    course_slug?: string;
    page_path?: string;
    source?: "program_sales_page" | "public_site";
  };
  message: string;
  name: string;
  phone: string;
  slug: string;
};

const textMaxLengths: Record<keyof Omit<PublicSiteSettingsInput,
  | "publicShowContactForm"
  | "publicShowCourses"
  | "publicShowSupportContact"
  | "publicSiteEnabled"
  | "slug"
>, number> = {
  contactCtaText: 80,
  publicAboutBody: 1200,
  publicAboutTitle: 120,
  publicFooterNote: 240,
  publicHeroCtaLabel: 60,
  publicHeroSubtitle: 320,
  publicHeroTitle: 140,
  publicHighlight1Body: 320,
  publicHighlight1Title: 90,
  publicHighlight2Body: 320,
  publicHighlight2Title: 90,
  publicHighlight3Body: 320,
  publicHighlight3Title: 90,
  publicPageDescription: 220,
  publicPageTitle: 120,
};

const slugPattern = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const unsafeTextPattern = /[<>]/;
function normalizeOptionalText(value: string, label: string, maxLength: number) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }

  if (unsafeTextPattern.test(trimmed)) {
    throw new Error(`${label} must be plain text only.`);
  }

  return trimmed;
}

function normalizeSlug(value: string) {
  const slug = value.trim().toLowerCase();

  if (!slugPattern.test(slug)) {
    throw new Error(
      "Public slug must use lowercase letters, numbers, and hyphens.",
    );
  }

  return slug;
}

function getErrorMessage(caught: unknown, fallback: string) {
  if (caught instanceof Error) {
    return caught.message;
  }

  if (caught && typeof caught === "object" && "message" in caught) {
    const message = (caught as { message?: unknown }).message;

    if (typeof message === "string") {
      return message;
    }
  }

  return fallback;
}

function normalizeSettingsInput(input: PublicSiteSettingsInput) {
  const normalizedText = Object.fromEntries(
    Object.entries(textMaxLengths).map(([key, maxLength]) => [
      key,
      normalizeOptionalText(
        input[key as keyof typeof textMaxLengths],
        key.replace(/([A-Z])/g, " $1").toLowerCase(),
        maxLength,
      ),
    ]),
  ) as Record<keyof typeof textMaxLengths, string | null>;

  return {
    contact_cta_text: normalizedText.contactCtaText,
    public_about_body: normalizedText.publicAboutBody,
    public_about_title: normalizedText.publicAboutTitle,
    public_footer_note: normalizedText.publicFooterNote,
    public_hero_cta_label: normalizedText.publicHeroCtaLabel,
    public_hero_subtitle: normalizedText.publicHeroSubtitle,
    public_hero_title: normalizedText.publicHeroTitle,
    public_highlight_1_body: normalizedText.publicHighlight1Body,
    public_highlight_1_title: normalizedText.publicHighlight1Title,
    public_highlight_2_body: normalizedText.publicHighlight2Body,
    public_highlight_2_title: normalizedText.publicHighlight2Title,
    public_highlight_3_body: normalizedText.publicHighlight3Body,
    public_highlight_3_title: normalizedText.publicHighlight3Title,
    public_page_description: normalizedText.publicPageDescription,
    public_page_title: normalizedText.publicPageTitle,
    public_show_contact_form: input.publicShowContactForm,
    public_show_courses: input.publicShowCourses,
    public_show_support_contact: input.publicShowSupportContact,
    public_site_enabled: input.publicSiteEnabled,
    slug: normalizeSlug(input.slug),
  };
}

function getChangedFields(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
) {
  return Object.keys(next).filter((field) => {
    if (field === "id" || field === "updated_at") {
      return false;
    }

    return (previous?.[field] ?? null) !== (next[field] ?? null);
  });
}

export async function getPublicSite(slug: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_site", {
    p_slug: slug,
  });

  if (error) {
    throw error;
  }

  return (data as PublicSitePayload | null) ?? null;
}

export async function getPublicProgramSalesPage(
  tenantSlug: string,
  courseSlug: string,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_program_sales_page", {
    p_course_slug: courseSlug,
    p_tenant_slug: tenantSlug,
  });

  if (error) {
    throw error;
  }

  return (data as PublicProgramSalesPagePayload | null) ?? null;
}

export async function submitPublicSiteLead(input: SubmitPublicSiteLeadInput) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("submit_public_site_lead", {
    p_email: input.email.trim() || null,
    p_interested_course_id: input.interestedCourseId || null,
    p_metadata_json: input.metadata ?? {},
    p_message: input.message.trim() || null,
    p_name: input.name.trim(),
    p_phone: input.phone.trim() || null,
    p_slug: input.slug,
  });

  if (error) {
    throw new Error(getErrorMessage(error, "Unable to submit inquiry."));
  }

  return data as { created_at: string; id: string; status: string };
}

export async function updatePublicSiteSettings(
  tenantId: string,
  input: PublicSiteSettingsInput,
) {
  await requireTenantPermission({
    description: "Blocked public website settings update without owner/admin permission.",
    permission: "manage_workspace",
    tenantId,
  });

  const payload = normalizeSettingsInput(input);
  const supabase = getSupabaseClient();
  const { data: previous } = await supabase
    .from("tenants")
    .select(
      "id,slug,public_site_enabled,public_page_title,public_page_description,contact_cta_text,public_hero_title,public_hero_subtitle,public_hero_cta_label,public_about_title,public_about_body,public_highlight_1_title,public_highlight_1_body,public_highlight_2_title,public_highlight_2_body,public_highlight_3_title,public_highlight_3_body,public_show_courses,public_show_contact_form,public_show_support_contact,public_footer_note",
    )
    .eq("id", tenantId)
    .maybeSingle();

  const { data, error } = await supabase
    .rpc("update_public_site_settings", {
      p_contact_cta_text: payload.contact_cta_text,
      p_public_about_body: payload.public_about_body,
      p_public_about_title: payload.public_about_title,
      p_public_footer_note: payload.public_footer_note,
      p_public_hero_cta_label: payload.public_hero_cta_label,
      p_public_hero_subtitle: payload.public_hero_subtitle,
      p_public_hero_title: payload.public_hero_title,
      p_public_highlight_1_body: payload.public_highlight_1_body,
      p_public_highlight_1_title: payload.public_highlight_1_title,
      p_public_highlight_2_body: payload.public_highlight_2_body,
      p_public_highlight_2_title: payload.public_highlight_2_title,
      p_public_highlight_3_body: payload.public_highlight_3_body,
      p_public_highlight_3_title: payload.public_highlight_3_title,
      p_public_page_description: payload.public_page_description,
      p_public_page_title: payload.public_page_title,
      p_public_show_contact_form: payload.public_show_contact_form,
      p_public_show_courses: payload.public_show_courses,
      p_public_show_support_contact: payload.public_show_support_contact,
      p_public_site_enabled: payload.public_site_enabled,
      p_slug: payload.slug,
      p_tenant_id: tenantId,
    })
    .select()
    .single();

  if (error) {
    throw new Error(getErrorMessage(error, "Unable to save public site."));
  }

  const updated = data as Record<string, unknown>;
  const changedFieldNames = getChangedFields(previous, updated);

  await logActivity({
    action: "public_site_updated",
    description: "Updated public website settings",
    entityId: tenantId,
    entityName:
      typeof updated.name === "string" ? updated.name : "Public website",
    entityType: "tenant",
    metadata: {
      changedFieldCount: changedFieldNames.length,
      changedFieldNames,
    },
    severity: payload.public_site_enabled ? "warning" : "info",
    tenantId,
  });

  return updated;
}

export async function getPublicSiteLeads(tenantId: string, limit = 20) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("public_site_leads")
    .select(
      "id,source,name,email,phone,message,interested_course_id,status,created_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as PublicSiteLead[];
}

export async function getPublicSiteLeadsForCourse(params: {
  courseId: string;
  limit?: number;
  tenantId: string;
}) {
  await requireTenantPermission({
    description:
      "Blocked program enrollment request read without course management permission.",
    permission: "manage_courses",
    tenantId: params.tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("public_site_leads")
    .select(
      "id,source,name,email,phone,message,interested_course_id,status,enrollment_request_status,metadata_json,converted_student_id,converted_enrollment_id,converted_at,conversion_note,approval_student_action,approval_enrollment_action,created_at",
    )
    .eq("tenant_id", params.tenantId)
    .eq("interested_course_id", params.courseId)
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 8);

  if (error) {
    throw error;
  }

  return (data ?? []) as PublicSiteLead[];
}

export async function getEnrollmentRequestStudentCandidates(params: {
  limit?: number;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("You must be logged in to review enrollment requests.");
  }

  const role = await getMemberRoleForTenant(params.tenantId, user.id);

  if (role !== "owner" && role !== "admin") {
    throw new Error("Only owners and admins can review enrollment requests.");
  }

  const { data, error } = await supabase
    .from("students")
    .select("id,full_name,email,phone,status")
    .eq("tenant_id", params.tenantId)
    .eq("status", "active")
    .order("full_name", { ascending: true })
    .limit(params.limit ?? 75);

  if (error) {
    throw error;
  }

  return (data ?? []) as EnrollmentRequestStudentCandidate[];
}

export async function approvePublicProgramEnrollmentRequest(
  input: ApprovePublicProgramEnrollmentRequestInput,
) {
  if (input.studentAction !== "create" && input.studentAction !== "existing") {
    throw new Error("Choose whether to create or link a student.");
  }

  if (input.studentAction === "existing" && !input.existingStudentId) {
    throw new Error("Select an existing active student.");
  }

  if (input.studentAction === "create") {
    const hasContact =
      Boolean(input.studentEmail?.trim()) || Boolean(input.studentPhone?.trim());

    if (!input.studentName?.trim()) {
      throw new Error("Student name is required.");
    }

    if (!hasContact) {
      throw new Error("Student email or phone is required.");
    }
  }

  const conversionNote = input.conversionNote?.trim() ?? "";

  if (
    conversionNote &&
    (conversionNote.length > 1000 || unsafeTextPattern.test(conversionNote))
  ) {
    throw new Error("Internal note must be plain text under 1000 characters.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "approve_public_program_enrollment_request_v2",
    {
      p_existing_student_id: input.existingStudentId ?? null,
      p_idempotency_key: `enrollment-request:${input.leadId}`,
      p_lead_id: input.leadId,
      p_note: conversionNote || null,
      p_student_email: input.studentEmail?.trim() || null,
      p_student_name: input.studentName?.trim() || null,
      p_student_phone: input.studentPhone?.trim() || null,
      p_tenant_id: input.tenantId,
    },
  );

  if (error) {
    throw new Error(
      getErrorMessage(error, "Unable to approve enrollment request."),
    );
  }

  const result = data as ApprovePublicProgramEnrollmentRequestResult;

  if (result.enrollment_request_status !== "enrolled") {
    throw new Error(
      result.message ||
        "This request needs attention before the student can be enrolled.",
    );
  }

  return result;
}
