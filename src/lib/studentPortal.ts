import type {
  Course,
  CourseSection,
  Lesson,
} from "@/src/lib/courses";
import type { Enrollment, EnrollmentStatus } from "@/src/lib/enrollments";
import type { Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type LessonProgressStatus =
  | "not_started"
  | "in_progress"
  | "completed";

export type LessonProgress = {
  id: string;
  tenant_id: string;
  student_id: string;
  course_id: string;
  lesson_id: string;
  status: LessonProgressStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PortalStudentSummary = {
  completedLessonsCount: number;
  enrolledCourseCount: number;
  progressRecordCount: number;
  student: Student;
};

export type StudentPortalCourse = {
  completedLessonsCount: number;
  course: Course;
  enrollment: Pick<Enrollment, "id" | "status" | "enrolled_at" | "completed_at">;
  lessonCount: number;
  progressPercentage: number;
  sectionCount: number;
};

export type PortalLesson = Lesson & {
  progress: LessonProgress | null;
  progressStatus: LessonProgressStatus;
};

export type PortalSection = CourseSection & {
  lessons: PortalLesson[];
};

export type StudentCourseAccess = {
  course: Course;
  sections: PortalSection[];
};

const studentSelect =
  "id,tenant_id,full_name,email,phone,status,source,notes,created_by,created_at,updated_at";

const courseSelect =
  "id,tenant_id,title,slug,description,status,thumbnail_url,created_by,created_at,updated_at";

const enrollmentSelect =
  "id,tenant_id,student_id,course_id,status,enrolled_at,completed_at,created_by,created_at,updated_at";

const progressSelect =
  "id,tenant_id,student_id,course_id,lesson_id,status,completed_at,created_at,updated_at";

function getProgressPercentage(completed: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Math.round((completed / total) * 100);
}

async function getLessonCountsForCourses(tenantId: string, courseIds: string[]) {
  if (courseIds.length === 0) {
    return new Map<string, { lessonCount: number; sectionCount: number }>();
  }

  const supabase = getSupabaseClient();
  const [sectionsResult, lessonsResult] = await Promise.all([
    supabase
      .from("course_sections")
      .select("id,course_id")
      .eq("tenant_id", tenantId)
      .in("course_id", courseIds),
    supabase
      .from("lessons")
      .select("id,course_id")
      .eq("tenant_id", tenantId)
      .in("course_id", courseIds),
  ]);

  if (sectionsResult.error) {
    throw sectionsResult.error;
  }

  if (lessonsResult.error) {
    throw lessonsResult.error;
  }

  const counts = new Map<string, { lessonCount: number; sectionCount: number }>();

  for (const courseId of courseIds) {
    counts.set(courseId, { lessonCount: 0, sectionCount: 0 });
  }

  for (const section of (sectionsResult.data ?? []) as {
    course_id: string;
    id: string;
  }[]) {
    const current = counts.get(section.course_id) ?? {
      lessonCount: 0,
      sectionCount: 0,
    };
    current.sectionCount += 1;
    counts.set(section.course_id, current);
  }

  for (const lesson of (lessonsResult.data ?? []) as {
    course_id: string;
    id: string;
  }[]) {
    const current = counts.get(lesson.course_id) ?? {
      lessonCount: 0,
      sectionCount: 0,
    };
    current.lessonCount += 1;
    counts.set(lesson.course_id, current);
  }

  return counts;
}

export async function getPortalStudentsForTenant(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data: enrollmentsData, error: enrollmentsError } = await supabase
    .from("enrollments")
    .select(enrollmentSelect)
    .eq("tenant_id", tenantId)
    .order("enrolled_at", { ascending: false });

  if (enrollmentsError) {
    throw enrollmentsError;
  }

  const enrollments = (enrollmentsData ?? []) as Enrollment[];
  const studentIds = Array.from(
    new Set(enrollments.map((enrollment) => enrollment.student_id)),
  );

  if (studentIds.length === 0) {
    return [];
  }

  const [studentsResult, progressResult] = await Promise.all([
    supabase
      .from("students")
      .select(studentSelect)
      .eq("tenant_id", tenantId)
      .in("id", studentIds),
    supabase
      .from("lesson_progress")
      .select(progressSelect)
      .eq("tenant_id", tenantId)
      .in("student_id", studentIds),
  ]);

  if (studentsResult.error) {
    throw studentsResult.error;
  }

  if (progressResult.error) {
    throw progressResult.error;
  }

  const students = (studentsResult.data ?? []) as Student[];
  const progressRows = (progressResult.data ?? []) as LessonProgress[];
  const enrollmentsByStudent = new Map<string, Set<string>>();
  const progressByStudent = new Map<
    string,
    { completedLessonsCount: number; progressRecordCount: number }
  >();

  for (const enrollment of enrollments) {
    const current =
      enrollmentsByStudent.get(enrollment.student_id) ?? new Set<string>();
    current.add(enrollment.course_id);
    enrollmentsByStudent.set(enrollment.student_id, current);
  }

  for (const progress of progressRows) {
    const current = progressByStudent.get(progress.student_id) ?? {
      completedLessonsCount: 0,
      progressRecordCount: 0,
    };
    current.progressRecordCount += 1;

    if (progress.status === "completed") {
      current.completedLessonsCount += 1;
    }

    progressByStudent.set(progress.student_id, current);
  }

  return students.map((student) => {
    const progress = progressByStudent.get(student.id);

    return {
      completedLessonsCount: progress?.completedLessonsCount ?? 0,
      enrolledCourseCount: enrollmentsByStudent.get(student.id)?.size ?? 0,
      progressRecordCount: progress?.progressRecordCount ?? 0,
      student,
    };
  }) as PortalStudentSummary[];
}

export async function getStudentPortalOverview(params: {
  studentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data: studentData, error: studentError } = await supabase
    .from("students")
    .select(studentSelect)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.studentId)
    .maybeSingle();

  if (studentError) {
    throw studentError;
  }

  if (!studentData) {
    return null;
  }

  const { data: enrollmentsData, error: enrollmentsError } = await supabase
    .from("enrollments")
    .select(enrollmentSelect)
    .eq("tenant_id", params.tenantId)
    .eq("student_id", params.studentId)
    .order("enrolled_at", { ascending: false });

  if (enrollmentsError) {
    throw enrollmentsError;
  }

  const enrollments = (enrollmentsData ?? []) as Enrollment[];
  const courseIds = Array.from(
    new Set(enrollments.map((enrollment) => enrollment.course_id)),
  );

  const [coursesResult, progressResult, lessonCounts] = await Promise.all([
    courseIds.length
      ? supabase
          .from("courses")
          .select(courseSelect)
          .eq("tenant_id", params.tenantId)
          .in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    courseIds.length
      ? supabase
          .from("lesson_progress")
          .select(progressSelect)
          .eq("tenant_id", params.tenantId)
          .eq("student_id", params.studentId)
          .in("course_id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    getLessonCountsForCourses(params.tenantId, courseIds),
  ]);

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  if (progressResult.error) {
    throw progressResult.error;
  }

  const courses = (coursesResult.data ?? []) as Course[];
  const progressRows = (progressResult.data ?? []) as LessonProgress[];
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const completedByCourse = new Map<string, number>();

  for (const progress of progressRows) {
    if (progress.status !== "completed") {
      continue;
    }

    completedByCourse.set(
      progress.course_id,
      (completedByCourse.get(progress.course_id) ?? 0) + 1,
    );
  }

  const coursesSummary = enrollments
    .map((enrollment) => {
      const course = courseById.get(enrollment.course_id);

      if (!course) {
        return null;
      }

      const counts = lessonCounts.get(course.id) ?? {
        lessonCount: 0,
        sectionCount: 0,
      };
      const completedLessonsCount = completedByCourse.get(course.id) ?? 0;

      return {
        completedLessonsCount,
        course,
        enrollment: {
          completed_at: enrollment.completed_at,
          enrolled_at: enrollment.enrolled_at,
          id: enrollment.id,
          status: enrollment.status as EnrollmentStatus,
        },
        lessonCount: counts.lessonCount,
        progressPercentage: getProgressPercentage(
          completedLessonsCount,
          counts.lessonCount,
        ),
        sectionCount: counts.sectionCount,
      } satisfies StudentPortalCourse;
    })
    .filter(Boolean) as StudentPortalCourse[];

  return {
    courses: coursesSummary,
    student: studentData as Student,
  };
}

export async function getStudentCourseAccess(params: {
  courseId: string;
  studentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const [{ data: courseData, error: courseError }, sectionsResult, lessonsResult, progressResult] =
    await Promise.all([
      supabase
        .from("courses")
        .select(courseSelect)
        .eq("tenant_id", params.tenantId)
        .eq("id", params.courseId)
        .maybeSingle(),
      supabase
        .from("course_sections")
        .select("id,course_id,tenant_id,title,sort_order,created_at,updated_at")
        .eq("tenant_id", params.tenantId)
        .eq("course_id", params.courseId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("lessons")
        .select(
          "id,section_id,course_id,tenant_id,title,lesson_type,content,video_url,resource_url,sort_order,is_preview,created_at,updated_at",
        )
        .eq("tenant_id", params.tenantId)
        .eq("course_id", params.courseId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("lesson_progress")
        .select(progressSelect)
        .eq("tenant_id", params.tenantId)
        .eq("student_id", params.studentId)
        .eq("course_id", params.courseId),
    ]);

  if (courseError) {
    throw courseError;
  }

  if (sectionsResult.error) {
    throw sectionsResult.error;
  }

  if (lessonsResult.error) {
    throw lessonsResult.error;
  }

  if (progressResult.error) {
    throw progressResult.error;
  }

  if (!courseData) {
    return null;
  }

  const sections = (sectionsResult.data ?? []) as CourseSection[];
  const lessons = (lessonsResult.data ?? []) as Lesson[];
  const progressRows = (progressResult.data ?? []) as LessonProgress[];
  const progressByLesson = new Map(
    progressRows.map((progress) => [progress.lesson_id, progress]),
  );
  const lessonsBySection = lessons.reduce<Record<string, PortalLesson[]>>(
    (accumulator, lesson) => {
      const progress = progressByLesson.get(lesson.id) ?? null;
      accumulator[lesson.section_id] = accumulator[lesson.section_id] ?? [];
      accumulator[lesson.section_id].push({
        ...lesson,
        progress,
        progressStatus: progress?.status ?? "not_started",
      });
      return accumulator;
    },
    {},
  );

  return {
    course: courseData as Course,
    sections: sections.map((section) => ({
      ...section,
      lessons: lessonsBySection[section.id] ?? [],
    })),
  } satisfies StudentCourseAccess;
}

export async function updateLessonProgress(params: {
  courseId: string;
  lessonId: string;
  status: LessonProgressStatus;
  studentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const completedAt =
    params.status === "completed" ? new Date().toISOString() : null;

  const { data, error } = await supabase
    .from("lesson_progress")
    .upsert(
      {
        completed_at: completedAt,
        course_id: params.courseId,
        lesson_id: params.lessonId,
        status: params.status,
        student_id: params.studentId,
        tenant_id: params.tenantId,
      },
      {
        onConflict: "tenant_id,student_id,course_id,lesson_id",
      },
    )
    .select(progressSelect)
    .eq("tenant_id", params.tenantId)
    .eq("student_id", params.studentId)
    .eq("course_id", params.courseId)
    .eq("lesson_id", params.lessonId)
    .single();

  if (error) {
    throw error;
  }

  return data as LessonProgress;
}
