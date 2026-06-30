import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentTrainerScope } from "@/src/lib/trainerAssignments";
import {
  enforceWorkspaceLimit,
  refreshWorkspaceUsageSnapshot,
} from "@/src/lib/usage";

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

export async function getCoursesForTenant(tenantId: string) {
  const supabase = getSupabaseClient();
  const trainerScope = await getCurrentTrainerScope(tenantId);

  if (trainerScope && trainerScope.courseIds.length === 0) {
    return [];
  }

  let query = supabase
    .from("courses")
    .select(
      "id,tenant_id,title,slug,description,status,thumbnail_url,created_by,created_at,updated_at",
    )
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

  const course = data as Course;

  await refreshWorkspaceUsageSnapshot(course.tenant_id);

  return course;
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
