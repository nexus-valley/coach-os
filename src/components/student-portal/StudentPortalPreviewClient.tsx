"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import {
  getStudentPortalOverview,
  type StudentPortalAssignment,
  type StudentPortalOverview,
} from "@/src/lib/studentPortal";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import {
  getTenantSettings,
  getWorkspaceBranding,
  type TenantSettings,
} from "@/src/lib/tenantSettings";

type StudentPortalPreviewClientProps = {
  studentId: string;
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

function formatDelivery(value: string) {
  return value.replace("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function AssignmentStatusBadge({ assignment }: { assignment: StudentPortalAssignment }) {
  const status = assignment.submission?.status ?? "pending";

  if (status === "reviewed") {
    return <Badge tone="success">Reviewed</Badge>;
  }

  if (status === "late") {
    return <Badge tone="warning">Late</Badge>;
  }

  if (status === "submitted") {
    return <Badge tone="admin">Submitted</Badge>;
  }

  return <Badge>Pending</Badge>;
}

export function StudentPortalPreviewClient({
  studentId,
}: StudentPortalPreviewClientProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<StudentPortalOverview | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenantSettings, setTenantSettings] =
    useState<TenantSettings | null>(null);

  useEffect(() => {
    let active = true;

    async function loadPortal() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const [portalOverview, settings] = await Promise.all([
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
        setOverview(portalOverview);

        if (!portalOverview) {
          setError("Student not found in this workspace.");
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load student portal."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadPortal();

    return () => {
      active = false;
    };
  }, [router, studentId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-white/10 bg-[#101214]">
          <span className="sr-only">Loading student portal</span>
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
            Back to portal list
          </Link>
        </Card>
      </div>
    );
  }

  const branding = getWorkspaceBranding(tenantSettings, tenant);
  const brandStyle = { borderColor: `${branding.brandColor}55` };

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-slate-400 transition hover:text-white"
        href="/app/student-portal"
      >
        Back to portal list
      </Link>

      <section className="mt-6 overflow-hidden rounded-[2rem] border border-white/10 bg-[#101214] text-white shadow-2xl shadow-black/20">
        <div
          className="grid gap-6 border-b border-white/10 p-6 sm:p-8 xl:grid-cols-[1fr_auto]"
          style={brandStyle}
        >
          <div className="flex gap-4">
            {branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${branding.displayName} logo`}
                className="h-16 w-16 rounded-2xl object-contain"
                src={branding.logoUrl}
              />
            ) : (
              <CoachFortBrandAsset className="h-16 w-16" variant="appIcon" />
            )}
            <div>
              <Badge
                className="border-white/10 bg-white/10"
                style={{ color: branding.brandColor }}
              >
                Student Portal Preview
              </Badge>
              <h2 className="mt-4 text-4xl font-semibold tracking-normal">
                {overview.student.full_name}
              </h2>
              <p className="mt-3 text-sm text-slate-400">
                {branding.displayName} | powered by CoachFort
              </p>
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-slate-400">Contact</p>
            <p className="mt-2 font-semibold">
              {overview.student.email ||
                overview.student.phone ||
                "No contact details"}
            </p>
          </div>
        </div>

        <div className="grid gap-4 p-6 sm:p-8 md:grid-cols-2 xl:grid-cols-6">
          {[
            ["Courses", overview.summary.enrolledCourses],
            ["Cohorts", overview.activeCohorts.length],
            ["Attendance", overview.summary.attendancePercent === null ? "NA" : `${overview.summary.attendancePercent}%`],
            ["Pending Work", overview.summary.pendingAssignments],
            ["Certificates", overview.summary.completedCertificates],
            ["Payment Summary", "Finance Center"],
          ].map(([label, value]) => (
            <div
              className="rounded-3xl border border-white/10 bg-white/5 p-5"
              key={label}
            >
              <p className="text-sm text-slate-400">{label}</p>
              <p className="mt-3 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <Badge className="border-white/15 bg-white/10 text-white">
            Courses
          </Badge>
          <div className="mt-5 space-y-4">
            {overview.courses.length === 0 ? (
              <p className="text-sm text-slate-400">No enrolled courses yet.</p>
            ) : (
              overview.courses.map((course) => (
                <div
                  className="rounded-3xl border border-white/10 bg-white/5 p-5"
                  key={course.enrollment.id}
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                      <h3 className="text-xl font-semibold">
                        {course.course.title}
                      </h3>
                      <p className="mt-2 text-sm text-slate-400">
                        {course.completedLessonsCount}/{course.lessonCount}{" "}
                        lessons complete
                      </p>
                    </div>
                    <Badge>{formatStatus(course.enrollment.status)}</Badge>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full"
                      style={{
                        backgroundColor: branding.brandColor,
                        width: `${course.progressPercentage}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <Badge className="border-white/15 bg-white/10 text-white">
            Sessions & Attendance
          </Badge>
          <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-slate-400">Overall attendance</p>
            <p className="mt-3 text-3xl font-semibold">
              {overview.attendance.percent === null
                ? "No records"
                : `${overview.attendance.percent}%`}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Present {overview.attendance.present} | Late{" "}
              {overview.attendance.late} | Absent {overview.attendance.absent}
            </p>
          </div>
          <div className="mt-5 space-y-3">
            {overview.sessions.upcoming.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                No upcoming sessions.
              </p>
            ) : (
              overview.sessions.upcoming.map((session) => (
                <div
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  key={session.id}
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <Badge className="border-white/15 bg-white/10 text-white">
                          {formatDelivery(session.delivery_mode)}
                        </Badge>
                        {session.meeting_provider ? (
                          <Badge
                            className="border-white/15 bg-white/10"
                            style={{ color: branding.brandColor }}
                          >
                            {formatDelivery(session.meeting_provider)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-3 font-semibold">{session.title}</p>
                      <p className="mt-2 text-sm text-slate-400">
                        {formatDateTime(session.scheduled_start_at)} |{" "}
                        {session.course?.title ||
                          session.cohort?.name ||
                          "General class"}
                      </p>
                    </div>
                    {session.meeting_url ? (
                      <a
                        className="inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold text-black transition hover:-translate-y-0.5"
                        href={session.meeting_url}
                        rel="noreferrer"
                        style={{ backgroundColor: branding.brandColor }}
                        target="_blank"
                      >
                        Join Class
                      </a>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <Badge className="border-white/15 bg-white/10 text-white">
            Assignments
          </Badge>
          <div className="mt-5 space-y-3">
            {overview.assignments.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                No published assignments yet.
              </p>
            ) : (
              overview.assignments.map((assignment) => (
                <div
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  key={assignment.assignment.id}
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                      <p className="font-semibold">
                        {assignment.assignment.title}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">
                        Due {formatDate(assignment.assignment.due_at)} |{" "}
                        {assignment.course?.title ||
                          assignment.cohort?.name ||
                          "General"}
                      </p>
                      {assignment.submission?.feedback ? (
                        <p className="mt-2 text-sm text-slate-300">
                          Feedback: {assignment.submission.feedback}
                        </p>
                      ) : null}
                    </div>
                    <AssignmentStatusBadge assignment={assignment} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <Badge className="border-white/15 bg-white/10 text-white">
            Certificates
          </Badge>
          <div className="mt-5 space-y-3">
            {overview.certificates.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                Certificates appear after course completion.
              </p>
            ) : (
              overview.certificates.map((certificate) => (
                <Link
                  className="block rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/10"
                  href={`/app/certificates/${certificate.enrollmentId}`}
                  key={certificate.enrollmentId}
                >
                  <p className="font-semibold">{certificate.courseTitle}</p>
                  <p className="mt-2 text-sm text-slate-400">
                    {certificate.certificateNumber} | Issued{" "}
                    {formatDate(certificate.issuedAt)}
                  </p>
                </Link>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <Badge className="border-white/15 bg-white/10 text-white">
            Announcements & Discussions
          </Badge>
          <div className="mt-5 space-y-3">
            {overview.conversations.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                Student-related announcements and discussions will appear here.
              </p>
            ) : (
              overview.conversations.map((thread) => (
                <div
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  key={thread.id}
                >
                  <p className="font-semibold">
                    {thread.title || "Conversation"}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    {formatStatus(thread.thread_type)} | Updated{" "}
                    {formatDate(thread.updated_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <Badge className="border-white/15 bg-white/10 text-white">
            Payments
          </Badge>
          <div className="mt-5 space-y-3">
            <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
              Student payment records are shown from Finance Center in the live
              student payment summary. Online gateway and payment-link previews
              remain parked.
            </p>
          </div>
        </Card>

        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
          <Badge className="border-white/15 bg-white/10 text-white">
            Notifications
          </Badge>
          <div className="mt-5 space-y-3">
            {overview.notifications.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                Student-facing notifications will appear here when student
                login is introduced.
              </p>
            ) : (
              overview.notifications.map((notification) => (
                <div
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  key={notification.id}
                >
                  <p className="font-semibold">{notification.title}</p>
                  <p className="mt-2 text-sm text-slate-400">
                    {notification.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}
