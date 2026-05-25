"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EnrollmentStatusBadge } from "@/src/components/enrollments/EnrollmentStatusBadge";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import {
  getStudentCourseAccess,
  getStudentPortalOverview,
  updateLessonProgress,
  type LessonProgressStatus,
  type StudentCourseAccess,
  type StudentPortalCourse,
} from "@/src/lib/studentPortal";
import type { Student } from "@/src/lib/students";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import {
  getTenantSettings,
  getWorkspaceBranding,
  type TenantSettings,
} from "@/src/lib/tenantSettings";

type StudentCourseAccessClientProps = {
  studentId: string;
};

type StudentPortalOverview = {
  courses: StudentPortalCourse[];
  student: Student;
};

const progressStatuses: LessonProgressStatus[] = [
  "not_started",
  "in_progress",
  "completed",
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function ProgressBadge({ status }: { status: LessonProgressStatus }) {
  if (status === "completed") {
    return (
      <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
        Completed
      </Badge>
    );
  }

  if (status === "in_progress") {
    return (
      <Badge className="border-blue-400/30 bg-blue-500/10 text-blue-300">
        In progress
      </Badge>
    );
  }

  return (
    <Badge className="border-white/10 bg-white/10 text-slate-300">
      Not started
    </Badge>
  );
}

function formatStatus(status: LessonProgressStatus) {
  return status.replace("_", " ");
}

export function StudentCourseAccessClient({
  studentId,
}: StudentCourseAccessClientProps) {
  const router = useRouter();
  const [access, setAccess] = useState<StudentCourseAccess | null>(null);
  const [actionError, setActionError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutatingLessonId, setMutatingLessonId] = useState("");
  const [overview, setOverview] = useState<StudentPortalOverview | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenantSettings, setTenantSettings] =
    useState<TenantSettings | null>(null);

  const selectedCourseSummary = useMemo(
    () =>
      overview?.courses.find((course) => course.course.id === selectedCourseId) ??
      null,
    [overview, selectedCourseId],
  );

  const loadCourseAccess = useCallback(async (params: {
    courseId: string;
    currentTenant: Tenant;
  }) => {
    const courseAccess = await getStudentCourseAccess({
      courseId: params.courseId,
      studentId,
      tenantId: params.currentTenant.id,
    });
    setAccess(courseAccess);
  }, [studentId]);

  useEffect(() => {
    let active = true;

    async function loadStudentPortal() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const [currentOverview, settings] = await Promise.all([
          getStudentPortalOverview({
            studentId,
            tenantId: currentTenant.id,
          }),
          getTenantSettings(currentTenant.id),
        ]);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setTenantSettings(settings);
        setOverview(currentOverview);

        if (!currentOverview) {
          setError("Student not found in this workspace.");
          return;
        }

        const firstCourseId = currentOverview.courses[0]?.course.id ?? "";
        setSelectedCourseId(firstCourseId);

        if (firstCourseId) {
          await loadCourseAccess({
            courseId: firstCourseId,
            currentTenant,
          });
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load portal preview."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadStudentPortal();

    return () => {
      active = false;
    };
  }, [loadCourseAccess, router, studentId]);

  async function handleSelectCourse(courseId: string) {
    if (!tenant) {
      return;
    }

    setSelectedCourseId(courseId);
    setActionError("");

    try {
      await loadCourseAccess({
        courseId,
        currentTenant: tenant,
      });
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load course access."));
    }
  }

  async function handleProgressChange(
    lessonId: string,
    status: LessonProgressStatus,
  ) {
    if (!tenant || !selectedCourseId) {
      return;
    }

    setMutatingLessonId(lessonId);
    setActionError("");

    try {
      await updateLessonProgress({
        courseId: selectedCourseId,
        lessonId,
        status,
        studentId,
        tenantId: tenant.id,
      });
      const [updatedOverview] = await Promise.all([
        getStudentPortalOverview({
          studentId,
          tenantId: tenant.id,
        }),
        loadCourseAccess({
          courseId: selectedCourseId,
          currentTenant: tenant,
        }),
      ]);
      setOverview(updatedOverview);
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to update lesson progress."),
      );
    } finally {
      setMutatingLessonId("");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-white/10 bg-[#101214]">
          <span className="sr-only">Loading student portal preview</span>
        </Card>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-white/10 bg-[#101214] p-8 text-white shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-slate-400">
            Student portal
          </p>
          <h2 className="mt-3 text-2xl font-semibold">
            {error || "Portal preview unavailable."}
          </h2>
          <Link
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-teal-400 px-5 text-sm font-semibold text-black"
            href="/app/student-portal"
          >
            Back to portal
          </Link>
        </Card>
      </div>
    );
  }

  const workspaceBranding = getWorkspaceBranding(tenantSettings, tenant);

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-slate-400 transition hover:text-white"
        href="/app/student-portal"
      >
        Back to portal
      </Link>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.38fr]">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
            Internal student preview
          </Badge>
          <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-normal">
            {overview.student.full_name}
          </h2>
          <p className="mt-4 text-sm text-slate-400">
            {overview.student.email ||
              overview.student.phone ||
              "No contact details"}
          </p>
          <p className="mt-5 max-w-3xl text-sm leading-6 text-slate-400">
            This is an admin-accessible foundation preview of student course
            access. Public student login, payments, certificates, notifications,
            and community features are intentionally outside this module.
          </p>
        </Card>

        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-slate-400">Workspace</p>
          <h3 className="mt-3 text-2xl font-semibold">
            {workspaceBranding.displayName}
          </h3>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            {overview.courses.length} enrolled{" "}
            {overview.courses.length === 1 ? "course" : "courses"} available
            for preview.
          </p>
        </Card>
      </section>

      {actionError ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {actionError}
        </div>
      ) : null}

      <section className="mt-6">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Enrolled courses
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">Course access</h3>
            </div>
            {selectedCourseSummary ? (
              <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
                {selectedCourseSummary.progressPercentage}% complete
              </Badge>
            ) : null}
          </div>

          {overview.courses.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-[#101214] p-8 text-center">
              <h4 className="text-xl font-semibold">No enrolled courses</h4>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                Enroll this student into a course before previewing access.
              </p>
            </div>
          ) : (
            <div className="mt-8 grid gap-4 lg:grid-cols-2">
              {overview.courses.map((course) => {
                const active = course.course.id === selectedCourseId;

                return (
                  <div
                    className={[
                      "rounded-3xl border p-5 text-left transition",
                      active
                        ? "border-teal-400/40 bg-teal-400/10"
                        : "border-white/10 bg-[#15181b] hover:border-white/20",
                    ].join(" ")}
                    key={course.course.id}
                  >
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div>
                        <h4 className="text-xl font-semibold">
                          {course.course.title}
                        </h4>
                        <p className="mt-2 text-sm text-slate-400">
                          {course.sectionCount} sections | {course.lessonCount}{" "}
                          lessons
                        </p>
                      </div>
                      <EnrollmentStatusBadge status={course.enrollment.status} />
                    </div>
                    <button
                      className="mt-4 inline-flex h-9 items-center justify-center rounded-full border border-white/10 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15"
                      onClick={() => handleSelectCourse(course.course.id)}
                      type="button"
                    >
                      {active ? "Course selected" : "Open Course Access"}
                    </button>
                    <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-teal-400"
                        style={{ width: `${course.progressPercentage}%` }}
                      />
                    </div>
                    {course.lessonCount === 0 ? (
                      <p className="mt-3 text-sm text-slate-400">
                        No lessons available yet.
                      </p>
                    ) : course.isCompleted ||
                      course.enrollment.status === "completed" ? (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <p className="text-sm font-semibold text-teal-300">
                          Course Completed 🎉
                        </p>
                        <Link
                          className="inline-flex h-9 items-center justify-center rounded-full bg-teal-400 px-4 text-sm font-semibold text-black transition hover:bg-teal-300"
                          href={`/app/certificates/${course.enrollment.id}`}
                        >
                          View Certificate
                        </Link>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-slate-400">
                        {course.completedLessonsCount}/{course.lessonCount}{" "}
                        lessons complete | Continue learning | enrolled{" "}
                        {formatDate(course.enrollment.enrolled_at)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </section>

      {access ? (
        <section className="mt-6">
          <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div>
                <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
                  Open Course Access
                </Badge>
                <h3 className="mt-4 text-2xl font-semibold">
                  {access.course.title}
                </h3>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                  Preview exactly what this learner can access inside the
                  selected course.
                </p>
              </div>
            </div>

            {access.sections.length === 0 ? (
              <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-[#101214] p-8 text-center">
                <h4 className="text-xl font-semibold">No sections yet</h4>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                  Add course sections and lessons before previewing course
                  content.
                </p>
              </div>
            ) : (
              <div className="mt-8 space-y-5">
                {access.sections.map((section, sectionIndex) => (
                  <div
                    className="rounded-3xl border border-white/10 bg-[#15181b] p-5"
                    key={section.id}
                  >
                    <p className="text-xs font-semibold text-slate-500">
                      Section {sectionIndex + 1}
                    </p>
                    <h4 className="mt-2 text-xl font-semibold">
                      {section.title}
                    </h4>

                    {section.lessons.length === 0 ? (
                      <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-[#101214] p-5 text-sm text-slate-500">
                        No lessons in this section yet.
                      </div>
                    ) : (
                      <div className="mt-5 space-y-3">
                        {section.lessons.map((lesson, lessonIndex) => (
                          <div
                            className="rounded-2xl border border-white/10 bg-[#101214] p-4"
                            key={lesson.id}
                          >
                            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-semibold text-slate-500">
                                    {String(lessonIndex + 1).padStart(2, "0")}
                                  </span>
                                  <Badge className="border-white/10 bg-white/10 text-slate-300">
                                    {lesson.lesson_type}
                                  </Badge>
                                  <ProgressBadge
                                    status={lesson.progressStatus}
                                  />
                                </div>
                                <h5 className="mt-3 text-lg font-semibold">
                                  {lesson.title}
                                </h5>
                                {lesson.content ? (
                                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-400">
                                    {lesson.content}
                                  </p>
                                ) : null}
                                {lesson.video_url ? (
                                  <a
                                    className="mt-3 block text-sm font-semibold text-teal-300 transition hover:text-teal-200"
                                    href={lesson.video_url}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    Open video URL
                                  </a>
                                ) : null}
                                {lesson.resource_url ? (
                                  <a
                                    className="mt-2 block text-sm font-semibold text-teal-300 transition hover:text-teal-200"
                                    href={lesson.resource_url}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    Open resource URL
                                  </a>
                                ) : null}
                              </div>

                              <label className="block">
                                <span className="text-sm font-medium text-slate-400">
                                  Progress
                                </span>
                                <select
                                  className="mt-2 h-10 rounded-full border border-white/10 bg-white/10 px-3 text-sm font-semibold text-white outline-none transition focus:border-teal-400/40 focus:ring-4 focus:ring-teal-400/10"
                                  disabled={mutatingLessonId === lesson.id}
                                  onChange={(event) =>
                                    handleProgressChange(
                                      lesson.id,
                                      event.target
                                        .value as LessonProgressStatus,
                                    )
                                  }
                                  value={lesson.progressStatus}
                                >
                                  {progressStatuses.map((status) => (
                                    <option
                                      className="text-slate-950"
                                      key={status}
                                      value={status}
                                    >
                                      {formatStatus(status)}
                                    </option>
                                  ))}
                                </select>
                              </label>
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
      ) : null}
    </div>
  );
}
