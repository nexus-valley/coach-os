import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentTrainerScope } from "@/src/lib/trainerAssignments";
import {
  enforceWorkspaceLimit,
  refreshWorkspaceUsageSnapshot,
} from "@/src/lib/usage";

export type CourseStatus = "draft" | "published" | "archived";
export type LessonType = "text" | "video" | "pdf" | "quiz" | "assignment";
export type CoursePricingType = "free" | "paid";
export type CourseSalesPaymentMode = "external" | "manual";

export type Course = {
  id: string;
  tenant_id: string;
  title: string;
  slug: string;
  description: string | null;
  status: CourseStatus;
  thumbnail_url: string | null;
  pricing_type: CoursePricingType;
  price_amount: number | null;
  sales_currency: "INR";
  public_sales_enabled: boolean;
  sales_payment_mode: CourseSalesPaymentMode;
  payment_instructions: string | null;
  external_payment_url: string | null;
  sales_headline: string | null;
  sales_summary: string | null;
  access_duration_label: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateCourseInput = {
  description: string;
  status: Exclude<CourseStatus, "archived">;
  tenantId: string;
  title: string;
};

export type PublishCourseResult = {
  courseId: string;
  tenantId: string;
  title: string;
  slug: string;
  status: "published";
  updatedAt: string;
  publicationResult: "already_published" | "published";
};

export type UpdateCourseSalesSettingsInput = {
  accessDurationLabel: string;
  courseId: string;
  externalPaymentUrl: string;
  paymentInstructions: string;
  priceAmount: number | null;
  pricingType: CoursePricingType;
  publicSalesEnabled: boolean;
  salesCurrency: "INR";
  salesHeadline: string;
  salesPaymentMode: CourseSalesPaymentMode;
  salesSummary: string;
  tenantId: string;
};

export type CourseSection = {
  id: string;
  course_id: string;
  tenant_id: string;
  title: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Lesson = {
  id: string;
  section_id: string;
  course_id: string;
  tenant_id: string;
  title: string;
  lesson_type: LessonType;
  content: string | null;
  video_url: string | null;
  resource_url: string | null;
  sort_order: number;
  is_preview: boolean;
  created_at: string;
  updated_at: string;
};

export type CourseSectionWithLessons = CourseSection & {
  lessons: Lesson[];
};

export type CourseSectionInput = {
  courseId: string;
  sortOrder?: number;
  tenantId: string;
  title: string;
};

export type UpdateCourseSectionInput = {
  courseId: string;
  sectionId: string;
  tenantId: string;
  title: string;
};

export type DeleteCourseSectionInput = {
  courseId: string;
  sectionId: string;
  tenantId: string;
};

export type LessonInput = {
  content: string;
  courseId: string;
  isPreview: boolean;
  lessonType: LessonType;
  resourceUrl: string;
  sectionId: string;
  sortOrder?: number;
  tenantId: string;
  title: string;
  videoUrl: string;
};

export type UpdateLessonInput = LessonInput & {
  lessonId: string;
};

export type DeleteLessonInput = {
  courseId: string;
  lessonId: string;
  sectionId: string;
  tenantId: string;
};

const courseSelect =
  "id,tenant_id,title,slug,description,status,thumbnail_url,pricing_type,price_amount,sales_currency,public_sales_enabled,sales_payment_mode,payment_instructions,external_payment_url,sales_headline,sales_summary,access_duration_label,created_by,created_at,updated_at";

const unsafeTextPattern = /[<>]/;

type CoursePublishErrorLike = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

type RawPublishCourseResult = {
  course_id?: unknown;
  publication_result?: unknown;
  slug?: unknown;
  status?: unknown;
  tenant_id?: unknown;
  title?: unknown;
  updated_at?: unknown;
};

const publishCourseFallbackMessage =
  "We could not confirm the final result. Refresh the page to check whether the program is now published before trying again.";

function getPublishCourseErrorMessage(caught: CoursePublishErrorLike) {
  const normalizedMessage = [
    caught.message,
    caught.details,
    caught.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    caught.code === "42501" ||
    normalizedMessage.includes("authentication required") ||
    normalizedMessage.includes("membership is required") ||
    normalizedMessage.includes("permission")
  ) {
    return "You do not have permission to publish this program.";
  }

  if (normalizedMessage.includes("archived programs cannot be published")) {
    return "Archived programs cannot be published.";
  }

  if (normalizedMessage.includes("program not found")) {
    return "This program could not be found. Refresh the page and try again.";
  }

  return publishCourseFallbackMessage;
}

function normalizeSalesText(value: string, label: string, maxLength: number) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }

  if (unsafeTextPattern.test(trimmed)) {
    throw new Error(`${label} must be plain text only.`);
  }

  return trimmed;
}

function validateCourseSalesSettings(input: UpdateCourseSalesSettingsInput) {
  if (!["free", "paid"].includes(input.pricingType)) {
    throw new Error("Choose whether this program is free or paid.");
  }

  if (input.salesCurrency !== "INR") {
    throw new Error("Only INR pricing is supported right now.");
  }

  if (!["manual", "external"].includes(input.salesPaymentMode)) {
    throw new Error("Choose manual instructions or an external payment link.");
  }

  if (input.pricingType === "paid") {
    if (!input.priceAmount || input.priceAmount <= 0) {
      throw new Error("Paid programs require a price greater than zero.");
    }
  }

  if (
    input.salesPaymentMode === "external" &&
    input.externalPaymentUrl.trim() &&
    !input.externalPaymentUrl.trim().startsWith("https://")
  ) {
    throw new Error("External payment links must start with https://.");
  }

  normalizeSalesText(input.paymentInstructions, "Payment instructions", 2000);
  normalizeSalesText(input.salesHeadline, "Sales headline", 140);
  normalizeSalesText(input.salesSummary, "Sales summary", 600);
  normalizeSalesText(input.accessDurationLabel, "Access duration label", 80);

  if (input.externalPaymentUrl.trim().length > 500) {
    throw new Error("External payment URL must be 500 characters or fewer.");
  }
}

export async function getCoursesForTenant(tenantId: string) {
  const supabase = getSupabaseClient();
  const trainerScope = await getCurrentTrainerScope(tenantId);

  if (trainerScope && trainerScope.courseIds.length === 0) {
    return [];
  }

  let query = supabase
    .from("courses")
    .select(courseSelect)
    .eq("tenant_id", tenantId);

  if (trainerScope) {
    query = query.in("id", trainerScope.courseIds);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Course[];
}

export async function createCourse(input: CreateCourseInput) {
  await enforceWorkspaceLimit(input.tenantId, "courses");

  const supabase = getSupabaseClient();
  const title = input.title.trim();

  if (!title) {
    throw new Error("Course title is required.");
  }

  const { data, error } = await supabase
    .rpc("create_course_secure", {
      p_description: input.description,
      p_status: input.status,
      p_tenant_id: input.tenantId,
      p_title: title,
    })
    .single();

  if (error) {
    throw error;
  }

  const createdCourse = data as Pick<Course, "id" | "tenant_id">;
  const course = await getCourseById({
    courseId: createdCourse.id,
    tenantId: createdCourse.tenant_id,
  });

  if (!course) {
    throw new Error("Program was created, but its sales settings could not be loaded.");
  }

  await refreshWorkspaceUsageSnapshot(course.tenant_id);

  return course;
}

export async function publishCourse(courseId: string): Promise<PublishCourseResult> {
  const normalizedCourseId = courseId.trim();

  if (!normalizedCourseId) {
    throw new Error("Program id is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("publish_course_secure", {
      p_course_id: normalizedCourseId,
    })
    .single();

  if (error) {
    throw new Error(getPublishCourseErrorMessage(error));
  }

  const result = data as RawPublishCourseResult | null;
  const publicationResult = result?.publication_result;

  if (
    !result ||
    result.course_id !== normalizedCourseId ||
    typeof result.tenant_id !== "string" ||
    typeof result.title !== "string" ||
    typeof result.slug !== "string" ||
    result.status !== "published" ||
    typeof result.updated_at !== "string" ||
    (publicationResult !== "published" &&
      publicationResult !== "already_published")
  ) {
    throw new Error(publishCourseFallbackMessage);
  }

  return {
    courseId: result.course_id,
    publicationResult,
    slug: result.slug,
    status: result.status,
    tenantId: result.tenant_id,
    title: result.title,
    updatedAt: result.updated_at,
  };
}

export async function getCourseById(params: {
  courseId: string;
  tenantId: string;
}) {
  const trainerScope = await getCurrentTrainerScope(params.tenantId);

  if (trainerScope && !trainerScope.courseIds.includes(params.courseId)) {
    return null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("courses")
    .select(courseSelect)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.courseId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Course | null) ?? null;
}

export async function updateCourseSalesSettings(
  input: UpdateCourseSalesSettingsInput,
) {
  validateCourseSalesSettings(input);

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "update_course_sales_settings_secure",
    {
      p_access_duration_label: normalizeSalesText(
        input.accessDurationLabel,
        "Access duration label",
        80,
      ),
      p_course_id: input.courseId,
      p_external_payment_url:
        input.salesPaymentMode === "external"
          ? input.externalPaymentUrl.trim() || null
          : null,
      p_payment_instructions: normalizeSalesText(
        input.paymentInstructions,
        "Payment instructions",
        2000,
      ),
      p_price_amount:
        input.pricingType === "paid" ? input.priceAmount : null,
      p_pricing_type: input.pricingType,
      p_public_sales_enabled: input.publicSalesEnabled,
      p_sales_currency: input.salesCurrency,
      p_sales_headline: normalizeSalesText(
        input.salesHeadline,
        "Sales headline",
        140,
      ),
      p_sales_payment_mode: input.salesPaymentMode,
      p_sales_summary: normalizeSalesText(
        input.salesSummary,
        "Sales summary",
        600,
      ),
      p_tenant_id: input.tenantId,
    },
  );

  if (error) {
    throw error;
  }

  return data as Course;
}

export async function getCourseStructure(courseId: string, tenantId: string) {
  const supabase = getSupabaseClient();
  const { data: sectionsData, error: sectionsError } = await supabase
    .from("course_sections")
    .select("id,course_id,tenant_id,title,sort_order,created_at,updated_at")
    .eq("tenant_id", tenantId)
    .eq("course_id", courseId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (sectionsError) {
    throw sectionsError;
  }

  const { data: lessonsData, error: lessonsError } = await supabase
    .from("lessons")
    .select(
      "id,section_id,course_id,tenant_id,title,lesson_type,content,video_url,resource_url,sort_order,is_preview,created_at,updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("course_id", courseId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (lessonsError) {
    throw lessonsError;
  }

  const sections = (sectionsData ?? []) as CourseSection[];
  const lessons = (lessonsData ?? []) as Lesson[];
  const lessonsBySection = lessons.reduce<Record<string, Lesson[]>>(
    (accumulator, lesson) => {
      accumulator[lesson.section_id] = accumulator[lesson.section_id] ?? [];
      accumulator[lesson.section_id].push(lesson);
      return accumulator;
    },
    {},
  );

  return sections.map((section) => ({
    ...section,
    lessons: lessonsBySection[section.id] ?? [],
  })) as CourseSectionWithLessons[];
}

export async function createCourseSection(input: CourseSectionInput) {
  const title = input.title.trim();

  if (!title) {
    throw new Error("Section title is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("create_course_section_secure", {
      p_course_id: input.courseId,
      p_sort_order: input.sortOrder ?? 0,
      p_tenant_id: input.tenantId,
      p_title: title,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as CourseSection;
}

export async function updateCourseSection(input: UpdateCourseSectionInput) {
  const title = input.title.trim();

  if (!title) {
    throw new Error("Section title is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_course_section_secure", {
      p_course_id: input.courseId,
      p_section_id: input.sectionId,
      p_tenant_id: input.tenantId,
      p_title: title,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as CourseSection;
}

export async function deleteCourseSection(input: DeleteCourseSectionInput) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("delete_course_section_secure", {
    p_course_id: input.courseId,
    p_section_id: input.sectionId,
    p_tenant_id: input.tenantId,
  });

  if (error) {
    throw error;
  }
}

export async function createLesson(input: LessonInput) {
  const title = input.title.trim();

  if (!title) {
    throw new Error("Lesson title is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("create_lesson_secure", {
      p_content: input.content,
      p_course_id: input.courseId,
      p_is_preview: input.isPreview,
      p_lesson_type: input.lessonType,
      p_resource_url: input.resourceUrl,
      p_section_id: input.sectionId,
      p_sort_order: input.sortOrder ?? 0,
      p_tenant_id: input.tenantId,
      p_title: title,
      p_video_url: input.videoUrl,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as Lesson;
}

export async function updateLesson(input: UpdateLessonInput) {
  const title = input.title.trim();

  if (!title) {
    throw new Error("Lesson title is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("update_lesson_secure", {
      p_content: input.content,
      p_course_id: input.courseId,
      p_is_preview: input.isPreview,
      p_lesson_id: input.lessonId,
      p_lesson_type: input.lessonType,
      p_resource_url: input.resourceUrl,
      p_section_id: input.sectionId,
      p_tenant_id: input.tenantId,
      p_title: title,
      p_video_url: input.videoUrl,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as Lesson;
}

export async function deleteLesson(input: DeleteLessonInput) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("delete_lesson_secure", {
    p_course_id: input.courseId,
    p_lesson_id: input.lessonId,
    p_section_id: input.sectionId,
    p_tenant_id: input.tenantId,
  });

  if (error) {
    throw error;
  }
}
