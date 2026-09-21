import type { LessonType } from "./courses";
import { getSupabaseClient } from "./supabaseClient";
import type { StudentPortalContext } from "./studentPortalAuth";

export type StudentCourseProgressStatus =
  | "not_started"
  | "in_progress"
  | "completed";

export type StudentCourseViewerLesson = {
  completedAt: string | null;
  content: string | null;
  id: string;
  isPreview: boolean;
  lessonType: LessonType;
  progressStatus: StudentCourseProgressStatus;
  resourceUrl: string | null;
  sectionId: string;
  sortOrder: number;
  title: string;
  videoUrl: string | null;
};

export type StudentCourseViewerResult = {
  course: {
    description: string | null;
    id: string;
    status: "published" | "archived";
    title: string;
  };
  progress: {
    completedLessons: number;
    percentage: number;
    totalLessons: number;
  };
  sections: Array<{
    id: string;
    lessons: StudentCourseViewerLesson[];
    sortOrder: number;
    title: string;
  }>;
};

type CourseRow = StudentCourseViewerResult["course"];
type SectionRow = {
  course_id: string;
  id: string;
  sort_order: number;
  title: string;
};
type LessonRow = {
  content: string | null;
  course_id: string;
  id: string;
  is_preview: boolean;
  lesson_type: string;
  resource_url: string | null;
  section_id: string;
  sort_order: number;
  title: string;
  video_url: string | null;
};
type ProgressRow = {
  completed_at: string | null;
  lesson_id: string;
  status: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/;
const maximumResourceUrlLength = 1000;
const lessonTypes = new Set<LessonType>([
  "assignment",
  "pdf",
  "quiz",
  "text",
  "video",
]);
const progressStatuses = new Set<StudentCourseProgressStatus>([
  "completed",
  "in_progress",
  "not_started",
]);

export class StudentCourseViewerReadError extends Error {
  constructor() {
    super("Student course viewer data could not be loaded.");
    this.name = "StudentCourseViewerReadError";
  }
}

function normalizeUuid(value: string) {
  return uuidPattern.test(value) ? value.toLowerCase() : null;
}

function compareOrderedRows(
  left: { id: string; sortOrder: number },
  right: { id: string; sortOrder: number },
) {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
}

function isLessonType(value: string): value is LessonType {
  return lessonTypes.has(value as LessonType);
}

function normalizeProgressStatus(value: string): StudentCourseProgressStatus {
  return progressStatuses.has(value as StudentCourseProgressStatus)
    ? (value as StudentCourseProgressStatus)
    : "not_started";
}

export function getSafeStudentResourceUrl(value: string | null) {
  if (!value || value.length > maximumResourceUrlLength) return null;
  if (controlCharacterPattern.test(value)) return null;

  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function getStudentCourseLessonSelection(
  viewer: StudentCourseViewerResult,
  lessonQuery: string | null,
) {
  const lessons = viewer.sections.flatMap((section) => section.lessons);
  if (lessonQuery === null) return lessons[0] ?? null;

  const normalizedLessonId = normalizeUuid(lessonQuery);
  if (!normalizedLessonId) return null;
  return lessons.find((lesson) => lesson.id === normalizedLessonId) ?? null;
}

export function normalizeStudentCourseViewerRows(input: {
  course: CourseRow;
  lessons: LessonRow[];
  progress: ProgressRow[];
  sections: SectionRow[];
}): StudentCourseViewerResult | null {
  const courseId = normalizeUuid(input.course.id);
  if (
    !courseId ||
    (input.course.status !== "published" && input.course.status !== "archived")
  ) {
    return null;
  }

  const progressByLesson = new Map<string, ProgressRow>();
  for (const progress of input.progress) {
    const lessonId = normalizeUuid(progress.lesson_id);
    if (lessonId) progressByLesson.set(lessonId, progress);
  }

  const sections = input.sections
    .filter(
      (section) =>
        normalizeUuid(section.course_id) === courseId &&
        normalizeUuid(section.id) !== null,
    )
    .map((section) => ({
      id: section.id.toLowerCase(),
      lessons: [] as StudentCourseViewerLesson[],
      sortOrder: section.sort_order,
      title: section.title,
    }))
    .sort(compareOrderedRows);
  const sectionById = new Map(sections.map((section) => [section.id, section]));

  for (const lesson of input.lessons) {
    const lessonId = normalizeUuid(lesson.id);
    const sectionId = normalizeUuid(lesson.section_id);
    if (
      !lessonId ||
      !sectionId ||
      normalizeUuid(lesson.course_id) !== courseId ||
      !isLessonType(lesson.lesson_type)
    ) {
      continue;
    }

    const section = sectionById.get(sectionId);
    if (!section) continue;

    const progress = progressByLesson.get(lessonId);
    const progressStatus = normalizeProgressStatus(
      progress?.status ?? "not_started",
    );
    section.lessons.push({
      completedAt:
        progressStatus === "completed" ? progress?.completed_at ?? null : null,
      content: lesson.content,
      id: lessonId,
      isPreview: lesson.is_preview,
      lessonType: lesson.lesson_type,
      progressStatus,
      resourceUrl: getSafeStudentResourceUrl(lesson.resource_url),
      sectionId,
      sortOrder: lesson.sort_order,
      title: lesson.title,
      videoUrl: lesson.video_url,
    });
  }

  for (const section of sections) section.lessons.sort(compareOrderedRows);

  const lessons = sections.flatMap((section) => section.lessons);
  const completedLessons = lessons.filter(
    (lesson) => lesson.progressStatus === "completed",
  ).length;
  const totalLessons = lessons.length;

  return {
    course: {
      description: input.course.description,
      id: courseId,
      status: input.course.status,
      title: input.course.title,
    },
    progress: {
      completedLessons,
      percentage:
        totalLessons === 0
          ? 0
          : Math.round((completedLessons / totalLessons) * 100),
      totalLessons,
    },
    sections,
  };
}

export async function getStudentCourseViewer(input: {
  context: StudentPortalContext;
  courseId: string;
}) {
  const courseId = normalizeUuid(input.courseId);
  const tenantId = normalizeUuid(input.context.tenant.id);
  const studentId = normalizeUuid(input.context.student.id);
  if (!courseId || !tenantId || !studentId) return null;

  const supabase = getSupabaseClient();
  const courseResult = await supabase
    .from("courses")
    .select("id,title,description,status")
    .eq("tenant_id", tenantId)
    .eq("id", courseId)
    .maybeSingle();

  if (courseResult.error) throw new StudentCourseViewerReadError();
  if (!courseResult.data) return null;

  const [sectionsResult, lessonsResult, progressResult] = await Promise.all([
    supabase
      .from("course_sections")
      .select("id,course_id,title,sort_order")
      .eq("tenant_id", tenantId)
      .eq("course_id", courseId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("lessons")
      .select(
        "id,section_id,course_id,title,lesson_type,content,video_url,resource_url,sort_order,is_preview",
      )
      .eq("tenant_id", tenantId)
      .eq("course_id", courseId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("lesson_progress")
      .select("lesson_id,status,completed_at")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .eq("course_id", courseId),
  ]);

  if (sectionsResult.error || lessonsResult.error || progressResult.error) {
    throw new StudentCourseViewerReadError();
  }

  const finalCourseResult = await supabase
    .from("courses")
    .select("id,title,description,status")
    .eq("tenant_id", tenantId)
    .eq("id", courseId)
    .maybeSingle();

  if (finalCourseResult.error) throw new StudentCourseViewerReadError();
  if (!finalCourseResult.data) return null;

  return normalizeStudentCourseViewerRows({
    course: finalCourseResult.data as CourseRow,
    lessons: (lessonsResult.data ?? []) as LessonRow[],
    progress: (progressResult.data ?? []) as ProgressRow[],
    sections: (sectionsResult.data ?? []) as SectionRow[],
  });
}
