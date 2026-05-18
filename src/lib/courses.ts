import { logActivity } from "@/src/lib/auditLogger";
import { requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type CourseStatus = "draft" | "published" | "archived";
export type LessonType = "text" | "video" | "pdf" | "quiz" | "assignment";

export type Course = {
  id: string;
  tenant_id: string;
  title: string;
  slug: string;
  description: string | null;
  status: CourseStatus;
  thumbnail_url: string | null;
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

function createSlug(title: string) {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 64) || "course"
  );
}

export async function getCoursesForTenant(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("courses")
    .select(
      "id,tenant_id,title,slug,description,status,thumbnail_url,created_by,created_at,updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Course[];
}

export async function createCourse(input: CreateCourseInput) {
  await requireTenantPermission({
    description: "Blocked course creation without course management permission.",
    permission: "manage_courses",
    tenantId: input.tenantId,
  });

  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("You must be logged in to create a course.");
  }

  const title = input.title.trim();

  if (!title) {
    throw new Error("Course title is required.");
  }

  const { data, error } = await supabase
    .from("courses")
    .insert({
      created_by: user.id,
      description: input.description.trim() || null,
      slug: createSlug(title),
      status: input.status,
      tenant_id: input.tenantId,
      title,
    })
    .select(
      "id,tenant_id,title,slug,description,status,thumbnail_url,created_by,created_at,updated_at",
    )
    .single();

  if (error) {
    throw error;
  }

  const course = data as Course;

  await logActivity({
    action: "course_created",
    description: "Created new course",
    entityId: course.id,
    entityName: course.title,
    entityType: "course",
    metadata: { status: course.status },
    tenantId: course.tenant_id,
  });

  return course;
}

export async function getCourseById(params: {
  courseId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("courses")
    .select(
      "id,tenant_id,title,slug,description,status,thumbnail_url,created_by,created_at,updated_at",
    )
    .eq("tenant_id", params.tenantId)
    .eq("id", params.courseId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Course | null) ?? null;
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
  await requireTenantPermission({
    description: "Blocked course section creation without course management permission.",
    permission: "manage_courses",
    tenantId: input.tenantId,
  });

  const title = input.title.trim();

  if (!title) {
    throw new Error("Section title is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("course_sections")
    .insert({
      course_id: input.courseId,
      sort_order: input.sortOrder ?? 0,
      tenant_id: input.tenantId,
      title,
    })
    .select("id,course_id,tenant_id,title,sort_order,created_at,updated_at")
    .single();

  if (error) {
    throw error;
  }

  const section = data as CourseSection;

  await logActivity({
    action: "course_section_created",
    description: "Added course section",
    entityId: section.id,
    entityName: section.title,
    entityType: "course_section",
    metadata: { courseId: section.course_id },
    tenantId: section.tenant_id,
  });

  return section;
}

export async function updateCourseSection(input: UpdateCourseSectionInput) {
  await requireTenantPermission({
    description: "Blocked course section update without course management permission.",
    permission: "manage_courses",
    tenantId: input.tenantId,
  });

  const title = input.title.trim();

  if (!title) {
    throw new Error("Section title is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("course_sections")
    .update({ title })
    .eq("tenant_id", input.tenantId)
    .eq("course_id", input.courseId)
    .eq("id", input.sectionId)
    .select("id,course_id,tenant_id,title,sort_order,created_at,updated_at")
    .single();

  if (error) {
    throw error;
  }

  const section = data as CourseSection;

  await logActivity({
    action: "course_section_updated",
    description: "Updated course section",
    entityId: section.id,
    entityName: section.title,
    entityType: "course_section",
    metadata: { courseId: section.course_id },
    tenantId: section.tenant_id,
  });

  return section;
}

export async function deleteCourseSection(input: DeleteCourseSectionInput) {
  await requireTenantPermission({
    description: "Blocked course section deletion without delete permission.",
    permission: "delete_records",
    tenantId: input.tenantId,
  });

  const supabase = getSupabaseClient();
  const { data: existingSection, error: existingError } = await supabase
    .from("course_sections")
    .select("id,course_id,tenant_id,title,sort_order,created_at,updated_at")
    .eq("tenant_id", input.tenantId)
    .eq("course_id", input.courseId)
    .eq("id", input.sectionId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const { error } = await supabase
    .from("course_sections")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("course_id", input.courseId)
    .eq("id", input.sectionId);

  if (error) {
    throw error;
  }

  if (existingSection) {
    const section = existingSection as CourseSection;
    await logActivity({
      action: "course_section_deleted",
      description: "Deleted course section",
      entityId: section.id,
      entityName: section.title,
      entityType: "course_section",
      metadata: { courseId: section.course_id },
      severity: "warning",
      tenantId: section.tenant_id,
    });
  }
}

export async function createLesson(input: LessonInput) {
  await requireTenantPermission({
    description: "Blocked lesson creation without course management permission.",
    permission: "manage_courses",
    tenantId: input.tenantId,
  });

  const title = input.title.trim();

  if (!title) {
    throw new Error("Lesson title is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("lessons")
    .insert({
      content: input.content.trim() || null,
      course_id: input.courseId,
      is_preview: input.isPreview,
      lesson_type: input.lessonType,
      resource_url: input.resourceUrl.trim() || null,
      section_id: input.sectionId,
      sort_order: input.sortOrder ?? 0,
      tenant_id: input.tenantId,
      title,
      video_url: input.videoUrl.trim() || null,
    })
    .select(
      "id,section_id,course_id,tenant_id,title,lesson_type,content,video_url,resource_url,sort_order,is_preview,created_at,updated_at",
    )
    .single();

  if (error) {
    throw error;
  }

  const lesson = data as Lesson;

  await logActivity({
    action: "lesson_created",
    description: "Added course lesson",
    entityId: lesson.id,
    entityName: lesson.title,
    entityType: "lesson",
    metadata: { courseId: lesson.course_id, lessonType: lesson.lesson_type },
    tenantId: lesson.tenant_id,
  });

  return lesson;
}

export async function updateLesson(input: UpdateLessonInput) {
  await requireTenantPermission({
    description: "Blocked lesson update without course management permission.",
    permission: "manage_courses",
    tenantId: input.tenantId,
  });

  const title = input.title.trim();

  if (!title) {
    throw new Error("Lesson title is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("lessons")
    .update({
      content: input.content.trim() || null,
      is_preview: input.isPreview,
      lesson_type: input.lessonType,
      resource_url: input.resourceUrl.trim() || null,
      title,
      video_url: input.videoUrl.trim() || null,
    })
    .eq("tenant_id", input.tenantId)
    .eq("course_id", input.courseId)
    .eq("section_id", input.sectionId)
    .eq("id", input.lessonId)
    .select(
      "id,section_id,course_id,tenant_id,title,lesson_type,content,video_url,resource_url,sort_order,is_preview,created_at,updated_at",
    )
    .single();

  if (error) {
    throw error;
  }

  const lesson = data as Lesson;

  await logActivity({
    action: "lesson_updated",
    description: "Updated course lesson",
    entityId: lesson.id,
    entityName: lesson.title,
    entityType: "lesson",
    metadata: { courseId: lesson.course_id, lessonType: lesson.lesson_type },
    tenantId: lesson.tenant_id,
  });

  return lesson;
}

export async function deleteLesson(input: DeleteLessonInput) {
  await requireTenantPermission({
    description: "Blocked lesson deletion without delete permission.",
    permission: "delete_records",
    tenantId: input.tenantId,
  });

  const supabase = getSupabaseClient();
  const { data: existingLesson, error: existingError } = await supabase
    .from("lessons")
    .select(
      "id,section_id,course_id,tenant_id,title,lesson_type,content,video_url,resource_url,sort_order,is_preview,created_at,updated_at",
    )
    .eq("tenant_id", input.tenantId)
    .eq("course_id", input.courseId)
    .eq("section_id", input.sectionId)
    .eq("id", input.lessonId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const { error } = await supabase
    .from("lessons")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("course_id", input.courseId)
    .eq("section_id", input.sectionId)
    .eq("id", input.lessonId);

  if (error) {
    throw error;
  }

  if (existingLesson) {
    const lesson = existingLesson as Lesson;
    await logActivity({
      action: "lesson_deleted",
      description: "Deleted course lesson",
      entityId: lesson.id,
      entityName: lesson.title,
      entityType: "lesson",
      metadata: { courseId: lesson.course_id, lessonType: lesson.lesson_type },
      severity: "warning",
      tenantId: lesson.tenant_id,
    });
  }
}
