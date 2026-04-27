"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EnrollmentStatusBadge } from "@/src/components/enrollments/EnrollmentStatusBadge";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  createCourseSection,
  createLesson,
  deleteCourseSection,
  deleteLesson,
  getCourseById,
  getCourseStructure,
  updateCourseSection,
  updateLesson,
  type Course,
  type CourseSectionWithLessons,
  type Lesson,
  type LessonType,
} from "@/src/lib/courses";
import {
  getEnrollmentsForCourse,
  type EnrollmentWithRelations,
} from "@/src/lib/enrollments";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type CourseDetailClientProps = {
  courseId: string;
};

type SectionModalState = {
  mode: "create" | "edit";
  sectionId?: string;
  title: string;
};

type LessonModalState = {
  content: string;
  isPreview: boolean;
  lessonId?: string;
  lessonType: LessonType;
  mode: "create" | "edit";
  resourceUrl: string;
  sectionId: string;
  title: string;
  videoUrl: string;
};

type DeleteTarget =
  | {
      kind: "section";
      sectionId: string;
      title: string;
    }
  | {
      kind: "lesson";
      lessonId: string;
      sectionId: string;
      title: string;
    };

const lessonTypes: LessonType[] = ["text", "video", "pdf", "quiz", "assignment"];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function CourseStatusBadge({ status }: { status: Course["status"] }) {
  if (status === "published") {
    return <Badge tone="success">Published</Badge>;
  }

  return <Badge className="border-white/10 bg-white/10 text-white">Draft</Badge>;
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

export function CourseDetailClient({ courseId }: CourseDetailClientProps) {
  const [actionError, setActionError] = useState("");
  const [course, setCourse] = useState<Course | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentWithRelations[]>([]);
  const [error, setError] = useState("");
  const [lessonModal, setLessonModal] = useState<LessonModalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [sectionModal, setSectionModal] = useState<SectionModalState | null>(
    null,
  );
  const [sections, setSections] = useState<CourseSectionWithLessons[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCourse() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          setError("Workspace context is not available.");
          return;
        }

        const [currentCourse, currentStructure, courseEnrollments] =
          await Promise.all([
          getCourseById({
            courseId,
            tenantId: currentTenant.id,
          }),
          getCourseStructure(courseId, currentTenant.id),
          getEnrollmentsForCourse({
            courseId,
            tenantId: currentTenant.id,
          }),
        ]);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setCourse(currentCourse);
        setSections(currentCourse ? currentStructure : []);
        setEnrollments(currentCourse ? courseEnrollments : []);

        if (!currentCourse) {
          setError("Course not found in this workspace.");
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(
          getErrorMessage(caught, "Unable to load this course right now."),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadCourse();

    return () => {
      active = false;
    };
  }, [courseId]);

  async function refreshStructure() {
    if (!tenant) {
      return;
    }

    setSections(await getCourseStructure(courseId, tenant.id));
  }

  function getNextSectionOrder() {
    if (sections.length === 0) {
      return 0;
    }

    return Math.max(...sections.map((section) => section.sort_order)) + 1;
  }

  function getNextLessonOrder(sectionId: string) {
    const section = sections.find((item) => item.id === sectionId);

    if (!section || section.lessons.length === 0) {
      return 0;
    }

    return Math.max(...section.lessons.map((lesson) => lesson.sort_order)) + 1;
  }

  function openCreateLesson(sectionId: string) {
    setLessonModal({
      content: "",
      isPreview: false,
      lessonType: "text",
      mode: "create",
      resourceUrl: "",
      sectionId,
      title: "",
      videoUrl: "",
    });
  }

  function openEditLesson(lesson: Lesson) {
    setLessonModal({
      content: lesson.content ?? "",
      isPreview: lesson.is_preview,
      lessonId: lesson.id,
      lessonType: lesson.lesson_type,
      mode: "edit",
      resourceUrl: lesson.resource_url ?? "",
      sectionId: lesson.section_id,
      title: lesson.title,
      videoUrl: lesson.video_url ?? "",
    });
  }

  async function handleSectionSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !sectionModal) {
      return;
    }

    setActionError("");
    setMutating(true);

    try {
      if (sectionModal.mode === "edit" && sectionModal.sectionId) {
        await updateCourseSection({
          courseId,
          sectionId: sectionModal.sectionId,
          tenantId: tenant.id,
          title: sectionModal.title,
        });
      } else {
        await createCourseSection({
          courseId,
          sortOrder: getNextSectionOrder(),
          tenantId: tenant.id,
          title: sectionModal.title,
        });
      }

      setSectionModal(null);
      await refreshStructure();
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to save section right now."),
      );
    } finally {
      setMutating(false);
    }
  }

  async function handleLessonSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !lessonModal) {
      return;
    }

    setActionError("");
    setMutating(true);

    try {
      const payload = {
        content: lessonModal.content,
        courseId,
        isPreview: lessonModal.isPreview,
        lessonType: lessonModal.lessonType,
        resourceUrl: lessonModal.resourceUrl,
        sectionId: lessonModal.sectionId,
        tenantId: tenant.id,
        title: lessonModal.title,
        videoUrl: lessonModal.videoUrl,
      };

      if (lessonModal.mode === "edit" && lessonModal.lessonId) {
        await updateLesson({
          ...payload,
          lessonId: lessonModal.lessonId,
        });
      } else {
        await createLesson({
          ...payload,
          sortOrder: getNextLessonOrder(lessonModal.sectionId),
        });
      }

      setLessonModal(null);
      await refreshStructure();
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to save lesson right now."),
      );
    } finally {
      setMutating(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!tenant || !deleteTarget) {
      return;
    }

    setActionError("");
    setMutating(true);

    try {
      if (deleteTarget.kind === "section") {
        await deleteCourseSection({
          courseId,
          sectionId: deleteTarget.sectionId,
          tenantId: tenant.id,
        });
      } else {
        await deleteLesson({
          courseId,
          lessonId: deleteTarget.lessonId,
          sectionId: deleteTarget.sectionId,
          tenantId: tenant.id,
        });
      }

      setDeleteTarget(null);
      await refreshStructure();
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to delete this item right now."),
      );
    } finally {
      setMutating(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-white/10 bg-white/[0.06]">
          <span className="sr-only">Loading course</span>
        </Card>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-white/10 bg-white p-8 text-zinc-950 shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-zinc-500">Course detail</p>
          <h2 className="mt-3 text-2xl font-semibold">
            {error || "Course not found."}
          </h2>
          <Link
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white"
            href="/app/courses"
          >
            Back to courses
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-zinc-400 transition hover:text-white"
        href="/app/courses"
      >
        Back to courses
      </Link>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.42fr]">
        <Card className="border-white/10 bg-white/[0.06] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Course overview
              </Badge>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-normal">
                {course.title}
              </h2>
            </div>
            <CourseStatusBadge status={course.status} />
          </div>

          <p className="mt-6 max-w-3xl text-base leading-7 text-zinc-400">
            {course.description || "No description added yet."}
          </p>

          <div className="mt-8 grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-3">
            <div>
              <p className="text-sm text-zinc-500">Workspace</p>
              <p className="mt-2 font-semibold">{tenant?.name}</p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Slug</p>
              <p className="mt-2 font-semibold">/{course.slug}</p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Created</p>
              <p className="mt-2 font-semibold">
                {formatDate(course.created_at)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="border-white/10 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-zinc-500">
            Structure summary
          </p>
          <h3 className="mt-3 text-2xl font-semibold">
            {sections.length} {sections.length === 1 ? "section" : "sections"}
          </h3>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            {sections.reduce(
              (total, section) => total + section.lessons.length,
              0,
            )}{" "}
            lessons created across this course.
          </p>
        </Card>
      </section>

      {actionError ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {actionError}
        </div>
      ) : null}

      <section className="mt-6">
        <Card className="border-white/10 bg-white/[0.06] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Course structure
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Sections and lessons
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                Organize the course into ordered sections and lesson assets.
              </p>
            </div>
            <Button
              className="bg-white text-zinc-950 hover:bg-zinc-100"
              onClick={() => setSectionModal({ mode: "create", title: "" })}
              type="button"
            >
              Add Section
            </Button>
          </div>

          {sections.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-zinc-950/30 p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-sm font-bold text-zinc-950">
                01
              </div>
              <h4 className="mt-5 text-xl font-semibold">
                No sections yet
              </h4>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">
                Add your first section to start building the course structure.
                Lessons can be added inside each section.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-5">
              {sections.map((section, sectionIndex) => (
                <div
                  className="rounded-3xl border border-white/10 bg-zinc-950/35 p-5"
                  key={section.id}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold text-zinc-500">
                        Section {sectionIndex + 1}
                      </p>
                      <h4 className="mt-2 text-xl font-semibold">
                        {section.title}
                      </h4>
                      <p className="mt-2 text-sm text-zinc-500">
                        {section.lessons.length}{" "}
                        {section.lessons.length === 1 ? "lesson" : "lessons"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="bg-white text-zinc-950 hover:bg-zinc-100"
                        onClick={() => openCreateLesson(section.id)}
                        size="sm"
                        type="button"
                      >
                        Add Lesson
                      </Button>
                      <Button
                        className="border-white/15 bg-transparent text-white hover:bg-white/10"
                        onClick={() =>
                          setSectionModal({
                            mode: "edit",
                            sectionId: section.id,
                            title: section.title,
                          })
                        }
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        Edit
                      </Button>
                      <Button
                        className="text-red-200 hover:bg-red-500/10 hover:text-red-100"
                        onClick={() =>
                          setDeleteTarget({
                            kind: "section",
                            sectionId: section.id,
                            title: section.title,
                          })
                        }
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>

                  {section.lessons.length === 0 ? (
                    <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-zinc-500">
                      No lessons in this section yet.
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {section.lessons.map((lesson, lessonIndex) => (
                        <div
                          className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between"
                          key={lesson.id}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-zinc-500">
                                {String(lessonIndex + 1).padStart(2, "0")}
                              </span>
                              <Badge className="border-white/10 bg-white/10 text-zinc-300">
                                {lesson.lesson_type}
                              </Badge>
                              {lesson.is_preview ? (
                                <Badge tone="success">Preview</Badge>
                              ) : null}
                            </div>
                            <h5 className="mt-3 truncate text-base font-semibold">
                              {lesson.title}
                            </h5>
                            <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-500">
                              {lesson.content ||
                                lesson.video_url ||
                                lesson.resource_url ||
                                "No lesson content added yet."}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              className="border-white/15 bg-transparent text-white hover:bg-white/10"
                              onClick={() => openEditLesson(lesson)}
                              size="sm"
                              type="button"
                              variant="secondary"
                            >
                              Edit
                            </Button>
                            <Button
                              className="text-red-200 hover:bg-red-500/10 hover:text-red-100"
                              onClick={() =>
                                setDeleteTarget({
                                  kind: "lesson",
                                  lessonId: lesson.id,
                                  sectionId: section.id,
                                  title: lesson.title,
                                })
                              }
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <Card className="border-white/10 bg-white/[0.06] p-6 text-white shadow-2xl shadow-black/10 md:col-span-2">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Enrolled Students
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Course enrollment roster
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                View students connected to this course. Enrollment changes are
                managed from student profiles and the enrollment overview.
              </p>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
              {enrollments.length} enrolled
            </div>
          </div>

          {enrollments.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-zinc-950/30 p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-sm font-bold text-zinc-950">
                EN
              </div>
              <h4 className="mt-5 text-xl font-semibold">
                No enrolled students yet
              </h4>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">
                Enroll students from their CRM profile or the enrollment
                overview once records exist.
              </p>
            </div>
          ) : (
            <div className="mt-8 divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10">
              {enrollments.map((enrollment) => (
                <div
                  className="grid gap-4 bg-zinc-950/30 p-4 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-center"
                  key={enrollment.id}
                >
                  <div>
                    <p className="font-semibold">
                      {enrollment.student?.full_name ?? "Student unavailable"}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {enrollment.student?.email ||
                        enrollment.student?.phone ||
                        "No contact details"}
                    </p>
                  </div>
                  <p className="text-sm text-zinc-400">
                    Enrolled {formatDate(enrollment.enrolled_at)}
                  </p>
                  <EnrollmentStatusBadge status={enrollment.status} />
                  <Link
                    className="text-sm font-semibold text-white transition hover:text-zinc-300"
                    href={`/app/students/${enrollment.student_id}`}
                  >
                    View student
                  </Link>
                </div>
              ))}
            </div>
          )}
        </Card>

        {[
          {
            detail:
              "Use the course structure above to prepare the learning path before launch.",
            title: "Lessons",
          },
          {
            detail:
              "Publishing checks, previews, and launch workflows can build on this structure later.",
            title: "Publishing readiness",
          },
        ].map((item, index) => (
          <Card
            className="border-white/10 bg-white/[0.06] p-6 text-white shadow-2xl shadow-black/10"
            key={item.title}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-sm font-bold text-zinc-950">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-6 text-xl font-semibold">{item.title}</h3>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              {item.detail}
            </p>
          </Card>
        ))}
      </section>

      {sectionModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-lg border-zinc-200 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">
              {sectionModal.mode === "edit" ? "Edit section" : "Add Section"}
            </h3>
            <form className="mt-6 space-y-5" onSubmit={handleSectionSubmit}>
              <label className="block">
                <span className="text-sm font-medium text-zinc-700">
                  Section title
                </span>
                <input
                  className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                  onChange={(event) =>
                    setSectionModal({
                      ...sectionModal,
                      title: event.target.value,
                    })
                  }
                  placeholder="Welcome and foundations"
                  required
                  type="text"
                  value={sectionModal.title}
                />
              </label>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setSectionModal(null)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={mutating} type="submit">
                  {mutating ? "Saving..." : "Save section"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {lessonModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-2xl border-zinc-200 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">
              {lessonModal.mode === "edit" ? "Edit lesson" : "Add Lesson"}
            </h3>
            <form className="mt-6 space-y-5" onSubmit={handleLessonSubmit}>
              <label className="block">
                <span className="text-sm font-medium text-zinc-700">
                  Lesson title
                </span>
                <input
                  className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                  onChange={(event) =>
                    setLessonModal({
                      ...lessonModal,
                      title: event.target.value,
                    })
                  }
                  placeholder="Lesson title"
                  required
                  type="text"
                  value={lessonModal.title}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700">
                  Lesson type
                </span>
                <select
                  className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                  onChange={(event) =>
                    setLessonModal({
                      ...lessonModal,
                      lessonType: event.target.value as LessonType,
                    })
                  }
                  value={lessonModal.lessonType}
                >
                  {lessonTypes.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700">
                  Content
                </span>
                <textarea
                  className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                  onChange={(event) =>
                    setLessonModal({
                      ...lessonModal,
                      content: event.target.value,
                    })
                  }
                  placeholder="Add lesson notes, prompt, or instructions."
                  value={lessonModal.content}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">
                    Video URL
                  </span>
                  <input
                    className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                    onChange={(event) =>
                      setLessonModal({
                        ...lessonModal,
                        videoUrl: event.target.value,
                      })
                    }
                    placeholder="https://..."
                    type="url"
                    value={lessonModal.videoUrl}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">
                    Resource URL
                  </span>
                  <input
                    className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                    onChange={(event) =>
                      setLessonModal({
                        ...lessonModal,
                        resourceUrl: event.target.value,
                      })
                    }
                    placeholder="https://..."
                    type="url"
                    value={lessonModal.resourceUrl}
                  />
                </label>
              </div>

              <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <input
                  checked={lessonModal.isPreview}
                  className="h-5 w-5 rounded border-zinc-300 accent-zinc-950"
                  onChange={(event) =>
                    setLessonModal({
                      ...lessonModal,
                      isPreview: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                <span className="text-sm font-medium text-zinc-700">
                  Preview lesson
                </span>
              </label>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setLessonModal(null)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={mutating} type="submit">
                  {mutating ? "Saving..." : "Save lesson"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-md border-zinc-200 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/40 sm:p-8">
            <p className="text-sm font-semibold text-red-600">
              Confirm delete
            </p>
            <h3 className="mt-3 text-2xl font-semibold">
              Delete {deleteTarget.title}?
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              {deleteTarget.kind === "section"
                ? "This will also remove the lessons inside this section through the database cascade."
                : "This lesson will be removed from the course structure."}
            </p>
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                onClick={() => setDeleteTarget(null)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 shadow-red-600/20 hover:bg-red-700"
                disabled={mutating}
                onClick={handleDeleteConfirm}
                type="button"
              >
                {mutating ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
