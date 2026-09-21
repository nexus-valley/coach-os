import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

type ViewerModule = typeof import("../../src/lib/studentCourseViewer");
let getSafeStudentResourceUrl: ViewerModule["getSafeStudentResourceUrl"];
let getStudentCourseLessonSelection: ViewerModule["getStudentCourseLessonSelection"];
let normalizeStudentCourseViewerRows: ViewerModule["normalizeStudentCourseViewerRows"];

test.beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "public-test-key";
  const viewerModule = await import("../../src/lib/studentCourseViewer");
  getSafeStudentResourceUrl = viewerModule.getSafeStudentResourceUrl;
  getStudentCourseLessonSelection = viewerModule.getStudentCourseLessonSelection;
  normalizeStudentCourseViewerRows = viewerModule.normalizeStudentCourseViewerRows;
});

const courseId = "11111111-1111-4111-8111-111111111111";
const firstSectionId = "22222222-2222-4222-8222-222222222222";
const secondSectionId = "33333333-3333-4333-8333-333333333333";
const firstLessonId = "44444444-4444-4444-8444-444444444444";
const secondLessonId = "55555555-5555-4555-8555-555555555555";
const foreignLessonId = "66666666-6666-4666-8666-666666666666";

const helperPath = "src/lib/studentCourseViewer.ts";
const viewerPath = "src/components/portal/StudentCourseViewer.tsx";
const pagePath = "app/portal/courses/[courseId]/page.tsx";
const listPath = "src/components/portal/StudentPortalCourses.tsx";
const playerPath = "src/components/video/LessonVideoPlayer.tsx";

function viewerRows() {
  return {
    course: {
      description: "A safe program description.",
      id: courseId,
      status: "published" as const,
      title: "Student program",
    },
    lessons: [
      {
        content: "Second lesson",
        course_id: courseId,
        id: secondLessonId,
        is_preview: false,
        lesson_type: "video",
        resource_url: null,
        section_id: firstSectionId,
        sort_order: 20,
        title: "Second lesson",
        video_url: null,
      },
      {
        content: "First lesson\nSecond line",
        course_id: courseId,
        id: firstLessonId,
        is_preview: true,
        lesson_type: "text",
        resource_url: "https://resources.example.com/lesson.pdf",
        section_id: firstSectionId,
        sort_order: 10,
        title: "First lesson",
        video_url: null,
      },
      {
        content: "Foreign structure",
        course_id: courseId,
        id: foreignLessonId,
        is_preview: false,
        lesson_type: "text",
        resource_url: null,
        section_id: "77777777-7777-4777-8777-777777777777",
        sort_order: 1,
        title: "Orphan lesson",
        video_url: null,
      },
    ],
    progress: [
      {
        completed_at: "2027-01-15T08:00:00.000Z",
        lesson_id: firstLessonId,
        status: "completed",
      },
      {
        completed_at: "2027-01-15T09:00:00.000Z",
        lesson_id: secondLessonId,
        status: "unexpected",
      },
    ],
    sections: [
      {
        course_id: courseId,
        id: secondSectionId,
        sort_order: 20,
        title: "Later section",
      },
      {
        course_id: courseId,
        id: firstSectionId,
        sort_order: 10,
        title: "First section",
      },
    ],
  };
}

test.describe("VIDEO-2C2B Student authority and projection", () => {
  test("1. route reuses existing portal context without browser Student authority", () => {
    const page = read(pagePath);
    const viewer = read(viewerPath);

    expect(page).toContain("<StudentPortalGuard>");
    expect(page).toContain("<StudentPortalLayout context={context}>");
    expect(page).toContain("<StudentCourseViewer context={context} courseId={courseId}");
    expect(page).not.toMatch(/studentId|tenantId/);
    expect(viewer).not.toMatch(/useSearchParams\(\).*student/i);
    expect(viewer).not.toContain("localStorage");
  });

  test("2. helper uses authenticated RLS tables with explicit minimal projections", () => {
    const source = read(helperPath);

    expect(source).toContain('getSupabaseClient()');
    expect(source).toContain('.from("courses")');
    expect(source).toContain('.select("id,title,description,status")');
    expect(source).toContain('.from("course_sections")');
    expect(source).toContain('.select("id,course_id,title,sort_order")');
    expect(source).toContain('.from("lessons")');
    expect(source).toContain(
      '"id,section_id,course_id,title,lesson_type,content,video_url,resource_url,sort_order,is_preview"',
    );
    expect(source).toContain('.from("lesson_progress")');
    expect(source).toContain('.select("lesson_id,status,completed_at")');
    expect(source).not.toContain('select("*")');
  });

  test("3. helper does not recreate team, service, enrollment, or video authority", () => {
    const source = read(helperPath);

    for (const forbidden of [
      "getStudentCourseAccess",
      "getCurrentUserAndRole",
      "tenant_members",
      "service_role",
      "video_assets",
      "video_asset_attachments",
      "provider_asset",
      "student_portal_access_allowed",
      '.from("enrollments")',
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
  });

  test("4. repository RLS retains the canonical active/completed course-read matrix", () => {
    const lifecycleSql = read(
      "supabase/bundle_ux8g1b_subscription_operational_enforcement.sql",
    );
    const enrollmentSql = read(
      "supabase/bundle_ux4b_enrollment_access_permission_hardening.sql",
    );

    expect(lifecycleSql).toContain("enrollment.status = 'active' and course.status = 'published'");
    expect(lifecycleSql).toContain("enrollment.status = 'completed'");
    expect(lifecycleSql).toContain("course.status in ('published','archived')");
    expect(lifecycleSql).toContain("tenant_operational_access_allowed(p_tenant_id)");
    expect(enrollmentSql).toContain('create policy "Linked students can read enrolled courses"');
    expect(enrollmentSql).toContain("spa.user_id = auth.uid()");
    expect(enrollmentSql).toContain("'course_read'");
  });

  test("5. malformed or RLS-empty course results fail closed without a denial-reason lookup", () => {
    const source = read(helperPath);
    const courseQueryEnd = source.indexOf("const [sectionsResult");
    const courseQuery = source.slice(source.indexOf("const courseResult"), courseQueryEnd);

    expect(courseQuery).toContain("if (!courseResult.data) return null");
    expect(source).toContain("throw new StudentCourseViewerReadError()");
    expect(source).not.toMatch(/foreign tenant|cancelled enrollment|draft course/i);
    expect(read(viewerPath)).toContain("This program is not available in your portal.");
  });

  test("6. final course authority is rechecked after subordinate reads", () => {
    const source = read(helperPath);
    const initialCourseIndex = source.indexOf("const courseResult = await supabase");
    const subordinateIndex = source.indexOf(
      "const [sectionsResult, lessonsResult, progressResult]",
    );
    const subordinateErrorIndex = source.indexOf(
      "if (sectionsResult.error || lessonsResult.error || progressResult.error)",
    );
    const finalCourseIndex = source.indexOf(
      "const finalCourseResult = await supabase",
    );
    const normalizeIndex = source.indexOf(
      "return normalizeStudentCourseViewerRows",
    );
    const finalCourseContract = source.slice(finalCourseIndex, normalizeIndex);

    expect(initialCourseIndex).toBeGreaterThan(-1);
    expect(subordinateIndex).toBeGreaterThan(initialCourseIndex);
    expect(finalCourseIndex).toBeGreaterThan(subordinateErrorIndex);
    expect(normalizeIndex).toBeGreaterThan(finalCourseIndex);
    expect(finalCourseContract).toContain('.from("courses")');
    expect(finalCourseContract).toContain(
      '.select("id,title,description,status")',
    );
    expect(finalCourseContract).toContain('.eq("tenant_id", tenantId)');
    expect(finalCourseContract).toContain('.eq("id", courseId)');
    expect(finalCourseContract).toContain(".maybeSingle()");
    expect(finalCourseContract).toContain(
      "if (finalCourseResult.error) throw new StudentCourseViewerReadError()",
    );
    expect(finalCourseContract).toContain(
      "if (!finalCourseResult.data) return null",
    );
    expect(source).toContain("course: finalCourseResult.data as CourseRow");
    expect(source).not.toContain("course: courseResult.data as CourseRow");
  });
});

test.describe("VIDEO-2C2B structure, navigation, and progress", () => {
  test("7. normalization sorts sections and lessons deterministically and drops orphan relationships", () => {
    const viewer = normalizeStudentCourseViewerRows(viewerRows());
    expect(viewer).not.toBeNull();
    expect(viewer?.sections.map((section) => section.id)).toEqual([
      firstSectionId,
      secondSectionId,
    ]);
    expect(viewer?.sections[0].lessons.map((lesson) => lesson.id)).toEqual([
      firstLessonId,
      secondLessonId,
    ]);
    expect(viewer?.sections.flatMap((section) => section.lessons)).toHaveLength(2);
  });

  test("8. missing progress is not_started and completed progress is read-only", () => {
    const viewer = normalizeStudentCourseViewerRows(viewerRows());
    expect(viewer?.sections[0].lessons[0]).toMatchObject({
      completedAt: "2027-01-15T08:00:00.000Z",
      progressStatus: "completed",
    });
    expect(viewer?.sections[0].lessons[1]).toMatchObject({
      completedAt: null,
      progressStatus: "not_started",
    });
    expect(viewer?.progress).toEqual({
      completedLessons: 1,
      percentage: 50,
      totalLessons: 2,
    });

    const sources = `${read(helperPath)}\n${read(viewerPath)}`;
    expect(sources).not.toContain("updateLessonProgress");
    expect(sources).not.toContain("mark_lesson_progress_secure");
    expect(sources).not.toContain("Mark complete");
  });

  test("9. zero lessons produces a zero percentage without division drift", () => {
    const rows = viewerRows();
    rows.lessons = [];
    rows.progress = [];
    const viewer = normalizeStudentCourseViewerRows(rows);
    expect(viewer?.progress).toEqual({
      completedLessons: 0,
      percentage: 0,
      totalLessons: 0,
    });
  });

  test("10. missing lesson query selects first authorized lesson", () => {
    const viewer = normalizeStudentCourseViewerRows(viewerRows());
    expect(viewer && getStudentCourseLessonSelection(viewer, null)?.id).toBe(
      firstLessonId,
    );
  });

  test("11. valid query selects only a lesson in the authorized projection", () => {
    const viewer = normalizeStudentCourseViewerRows(viewerRows());
    expect(
      viewer && getStudentCourseLessonSelection(viewer, secondLessonId)?.id,
    ).toBe(secondLessonId);
  });

  test("12. malformed or foreign lesson query remains unavailable without fallback", () => {
    const viewer = normalizeStudentCourseViewerRows(viewerRows());
    expect(viewer && getStudentCourseLessonSelection(viewer, "not-a-uuid")).toBeNull();
    expect(viewer && getStudentCourseLessonSelection(viewer, foreignLessonId)).toBeNull();

    const source = read(viewerPath);
    expect(source).toContain("This lesson is not available in this program.");
    expect(source).toContain('router.push(`${pathname}?${nextSearchParams.toString()}`)');
    expect(source).toContain('nextSearchParams.set("lesson", lessonId)');
    expect(source).not.toMatch(/get.*Lesson.*\(lessonQuery|from\("lessons"\)/);
  });
});

test.describe("VIDEO-2C2B content and media safety", () => {
  test("13. resource validator accepts only bounded credential-free HTTPS URLs", () => {
    expect(getSafeStudentResourceUrl("https://resources.example.com/file.pdf")).toBe(
      "https://resources.example.com/file.pdf",
    );
    for (const value of [
      "http://resources.example.com/file.pdf",
      "javascript:alert(1)",
      "data:text/plain,hello",
      "blob:https://resources.example.com/value",
      "/relative/file.pdf",
      "https://user:password@resources.example.com/file.pdf",
      "https://resources.example.com:8443/file.pdf",
      "https://resources.example.com/file.pdf\n",
      "not-a-url",
    ]) {
      expect(getSafeStudentResourceUrl(value)).toBeNull();
    }
    expect(getSafeStudentResourceUrl(`https://example.com/${"a".repeat(1000)}`)).toBeNull();
  });

  test("14. lesson content is React text with preserved whitespace and no HTML injection", () => {
    const source = read(viewerPath);
    expect(source).toContain("whitespace-pre-wrap");
    expect(source).toContain("{lesson.content}");
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).not.toMatch(/ReactMarkdown|remark|rehype/);
  });

  test("15. rendered resources use safe external-link behavior", () => {
    const source = read(viewerPath);
    expect(source).toContain("href={lesson.resourceUrl}");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).not.toContain("download=");
  });

  test("16. shared player is reused with only the public lesson contract", () => {
    const source = read(viewerPath);
    expect(source).toContain('import { LessonVideoPlayer }');
    expect(source).toContain("<LessonVideoPlayer");
    expect(source).toContain("externalVideoUrl={lesson.videoUrl}");
    expect(source).toContain("lessonId={lesson.id}");
    expect(source).toContain("lessonTitle={lesson.title}");
    expect(source).toContain("tenantId={context.tenant.id}");
    expect(source).not.toMatch(/assetId|providerAssetId|providerUid|media-state/);
    expect(read(playerPath)).toContain("requestNativeLessonPlayback");
  });

  test("17. current lesson types remain presentation-only outside video playback", () => {
    const source = read(viewerPath);
    for (const label of ["Assignment", "PDF resource", "Quiz", "Reading", "Video"]) {
      expect(source).toContain(label);
    }
    expect(source).not.toMatch(/submitAssignment|gradeQuiz|pdfjs|iframe.*resourceUrl/);
  });
});

test.describe("VIDEO-2C2B portal integration and safe states", () => {
  test("18. canonical course cards gain only the authorized course-ID link", () => {
    const source = read(listPath);
    expect(source).toContain("Open program");
    expect(source).toContain('href={`/portal/courses/${course.course.id}`}');
    expect(source).not.toMatch(/studentId|tenantId/);
  });

  test("19. viewer implements responsive navigation and required empty states", () => {
    const source = read(viewerPath);
    expect(source).toContain("lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]");
    expect(source).toContain('aria-label="Program lessons"');
    expect(source).toContain("This program does not have any lessons yet.");
    expect(source).toContain("No lessons in this section yet.");
    expect(source).toContain("Back to My Programs");
  });

  test("20. browser errors remain customer-safe and raw Supabase errors are not rendered", () => {
    const source = read(viewerPath);
    expect(source).toContain("Unable to load this program right now. Please try again.");
    expect(source).toContain(".catch(() =>");
    expect(source).not.toMatch(/SQLSTATE|policy name|stack|error\.message|console\./i);
  });

  test("21. implementation scope leaves team viewer and prior video authorities untouched", () => {
    const page = read(pagePath);
    const helper = read(helperPath);
    expect(page).not.toContain("StudentCourseAccessClient");
    expect(helper).not.toContain("getStudentCourseAccess");
    expect(read("src/lib/studentPortal.ts")).toContain(
      "export async function getStudentCourseAccess",
    );
    expect(read("src/components/video/LessonVideoPlayer.tsx")).toBe(read(playerPath));
  });
});
