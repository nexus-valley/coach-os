"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { LessonVideoPlayer } from "@/src/components/video/LessonVideoPlayer";
import { Badge } from "@/src/components/ui/Badge";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  getStudentCourseLessonSelection,
  getStudentCourseViewer,
  type StudentCourseViewerLesson,
  type StudentCourseViewerResult,
} from "@/src/lib/studentCourseViewer";

type ViewerState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; viewer: StudentCourseViewerResult };

const lessonTypeLabels: Record<StudentCourseViewerLesson["lessonType"], string> = {
  assignment: "Assignment",
  pdf: "PDF resource",
  quiz: "Quiz",
  text: "Reading",
  video: "Video",
};

function LessonContent({
  context,
  lesson,
}: {
  context: StudentPortalContext;
  lesson: StudentCourseViewerLesson;
}) {
  const showsVideo = lesson.lessonType === "video" || Boolean(lesson.videoUrl);

  return (
    <article className="min-w-0 space-y-6" aria-labelledby="lesson-title">
      <header className="border-b border-[#D8E8F0] pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">{lessonTypeLabels[lesson.lessonType]}</Badge>
          {lesson.progressStatus === "completed" ? (
            <Badge tone="success">Completed</Badge>
          ) : null}
          {lesson.isPreview ? <Badge tone="outline">Preview</Badge> : null}
        </div>
        <h2 className="mt-3 text-2xl font-semibold text-[#0B2A3D]" id="lesson-title">
          {lesson.title}
        </h2>
      </header>

      {showsVideo ? (
        <LessonVideoPlayer
          externalVideoUrl={lesson.videoUrl}
          lessonId={lesson.id}
          lessonTitle={lesson.title}
          tenantId={context.tenant.id}
        />
      ) : null}

      {lesson.content ? (
        <div className="whitespace-pre-wrap text-sm leading-7 text-[#334E68]">
          {lesson.content}
        </div>
      ) : null}

      {lesson.resourceUrl ? (
        <a
          className="inline-flex min-h-10 items-center font-semibold text-[#145DA0] hover:underline"
          href={lesson.resourceUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open lesson resource
        </a>
      ) : null}
    </article>
  );
}

function StudentCourseViewerForIdentity({
  context,
  courseId,
}: {
  context: StudentPortalContext;
  courseId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<ViewerState>({ kind: "loading" });

  useEffect(() => {
    let active = true;

    getStudentCourseViewer({ context, courseId })
      .then((viewer) => {
        if (!active) return;
        setState(viewer ? { kind: "ready", viewer } : { kind: "unavailable" });
      })
      .catch(() => {
        if (active) setState({ kind: "error" });
      });

    return () => {
      active = false;
    };
  }, [context, courseId]);

  const lessonQuery = searchParams.get("lesson");
  const selectedLesson = useMemo(
    () =>
      state.kind === "ready"
        ? getStudentCourseLessonSelection(state.viewer, lessonQuery)
        : null,
    [lessonQuery, state],
  );

  function selectLesson(lessonId: string) {
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.set("lesson", lessonId);
    router.push(`${pathname}?${nextSearchParams.toString()}`);
  }

  if (state.kind === "loading") {
    return (
      <div className="h-72 animate-pulse rounded-lg border border-[#D8E8F0] bg-white">
        <span className="sr-only">Loading program</span>
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <div className="space-y-4">
        <FeedbackAlert>This program is not available in your portal.</FeedbackAlert>
        <Link className="font-semibold text-[#145DA0] hover:underline" href="/portal/courses">
          Back to My Programs
        </Link>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="space-y-4">
        <FeedbackAlert tone="warning">
          Unable to load this program right now. Please try again.
        </FeedbackAlert>
        <Link className="font-semibold text-[#145DA0] hover:underline" href="/portal/courses">
          Back to My Programs
        </Link>
      </div>
    );
  }

  const { viewer } = state;
  const hasLessons = viewer.progress.totalLessons > 0;
  const invalidLessonQuery = lessonQuery !== null && selectedLesson === null;

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#145DA0] hover:underline" href="/portal/courses">
        Back to My Programs
      </Link>

      <header className="border-b border-[#D8E8F0] pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-semibold uppercase text-[#0B6F87]">Learning</p>
          {viewer.course.status === "archived" ? (
            <Badge tone="neutral">Archived</Badge>
          ) : null}
        </div>
        <h1 className="mt-2 text-3xl font-semibold text-[#0B2A3D]">
          {viewer.course.title}
        </h1>
        {viewer.course.description ? (
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#425B76]">
            {viewer.course.description}
          </p>
        ) : null}
        <div className="mt-5 max-w-xl">
          <div className="flex items-center justify-between gap-4 text-sm font-medium text-[#425B76]">
            <span>
              {viewer.progress.completedLessons}/{viewer.progress.totalLessons} lessons complete
            </span>
            <span>{viewer.progress.percentage}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#EAF7FC]">
            <div
              className="h-full rounded-full bg-[#145DA0]"
              style={{ width: `${viewer.progress.percentage}%` }}
            />
          </div>
        </div>
      </header>

      {!hasLessons ? (
        <p className="rounded-lg border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-5 text-sm text-[#425B76]">
          This program does not have any lessons yet.
        </p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]">
          <nav
            aria-label="Program lessons"
            className="overflow-hidden rounded-lg border border-[#D8E8F0] bg-white lg:sticky lg:top-24"
          >
            {viewer.sections.map((section) => (
              <section className="border-b border-[#E5EEF4] p-4 last:border-b-0" key={section.id}>
                <h2 className="text-sm font-semibold text-[#0B2A3D]">{section.title}</h2>
                {section.lessons.length === 0 ? (
                  <p className="mt-2 text-xs text-[#66788F]">No lessons in this section yet.</p>
                ) : (
                  <div className="mt-2 space-y-1">
                    {section.lessons.map((lesson) => {
                      const active = selectedLesson?.id === lesson.id;
                      return (
                        <button
                          aria-current={active ? "page" : undefined}
                          className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
                            active
                              ? "bg-[#EAF7FC] font-semibold text-[#0B2A3D]"
                              : "text-[#425B76] hover:bg-[#F6FBFE] hover:text-[#0B2A3D]"
                          }`}
                          key={lesson.id}
                          onClick={() => selectLesson(lesson.id)}
                          type="button"
                        >
                          <span>{lesson.title}</span>
                          {lesson.progressStatus === "completed" ? (
                            <span className="text-xs font-semibold text-[#047857]">Done</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            ))}
          </nav>

          <main className="min-h-72 rounded-lg border border-[#D8E8F0] bg-white p-5 sm:p-6">
            {invalidLessonQuery ? (
              <FeedbackAlert>This lesson is not available in this program.</FeedbackAlert>
            ) : selectedLesson ? (
              <LessonContent context={context} lesson={selectedLesson} />
            ) : null}
          </main>
        </div>
      )}
    </div>
  );
}

export function StudentCourseViewer(props: {
  context: StudentPortalContext;
  courseId: string;
}) {
  const viewerIdentity = JSON.stringify([
    props.context.tenant.id,
    props.context.student.id,
    props.courseId,
  ]);

  return <StudentCourseViewerForIdentity key={viewerIdentity} {...props} />;
}
