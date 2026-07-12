"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { StatCard } from "@/src/components/ui/StatCard";
import {
  formatAnnouncementDate,
  getStudentAnnouncements,
  type StudentAnnouncement,
} from "@/src/lib/announcements";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  getTenantSettings,
  getWorkspaceBranding,
  type TenantSettings,
} from "@/src/lib/tenantSettings";
import {
  formatPortalDateTime,
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
  usePortalSection,
} from "@/src/components/portal/StudentPortalShared";

export function StudentPortalDashboard({ context }: { context: StudentPortalContext }) {
  const { error, loading, overview } = usePortalSection(context);
  const [announcements, setAnnouncements] = useState<StudentAnnouncement[]>([]);
  const [settings, setSettings] = useState<TenantSettings | null>(null);

  useEffect(() => {
    let active = true;

    getTenantSettings(context.tenant.id)
      .then((tenantSettings) => {
        if (active) {
          setSettings(tenantSettings);
        }
      })
      .catch(() => {
        if (active) {
          setSettings(null);
        }
      });

    return () => {
      active = false;
    };
  }, [context.tenant.id]);

  useEffect(() => {
    let active = true;

    getStudentAnnouncements()
      .then((nextAnnouncements) => {
        if (active) {
          setAnnouncements(nextAnnouncements.slice(0, 3));
        }
      })
      .catch(() => {
        if (active) {
          setAnnouncements([]);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <PortalLoadingCard label="Loading student dashboard" />;
  }

  if (error || !overview) {
    return <PortalError message={error || "Unable to load student dashboard."} />;
  }

  const branding = getWorkspaceBranding(settings, context.tenant);
  const nextSession = overview.sessions.upcoming[0] ?? null;
  const nextAssignment = overview.assignments[0] ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <>
            <Button href="/portal/courses" size="sm" variant="secondary">
              Courses
            </Button>
            <Button href="/portal/assignments" size="sm">
              Assignments
            </Button>
          </>
        }
        description={branding.portalWelcomeSubtitle}
        eyebrow="Student portal"
        metadata={<Badge tone="light">Signed in as {overview.student.full_name}</Badge>}
        title={branding.portalWelcomeTitle}
      />

      <Card className="p-5">
        <SectionHeader
          description="Start with the next scheduled class or the nearest assignment in your portal."
          title="Today and next up"
        />
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#D8E8F0] bg-[#F7FCFF] p-4">
            <Badge tone="admin">Next session</Badge>
            {nextSession ? (
              <>
                <h2 className="mt-3 text-lg font-semibold">{nextSession.title}</h2>
                <p className="mt-1 text-sm text-[#425B76]">
                  {formatPortalDateTime(nextSession.scheduled_start_at)}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-[#425B76]">
                No upcoming sessions are scheduled yet.
              </p>
            )}
          </div>
          <div className="rounded-2xl border border-[#D8E8F0] bg-[#F7FCFF] p-4">
            <Badge tone="warning">Next assignment</Badge>
            {nextAssignment ? (
              <>
                <h2 className="mt-3 text-lg font-semibold">
                  {nextAssignment.assignment.title}
                </h2>
                <p className="mt-1 text-sm text-[#425B76]">
                  Due {formatPortalDateTime(nextAssignment.assignment.due_at)}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-[#425B76]">
                No published assignments are due right now.
              </p>
            )}
          </div>
        </div>
      </Card>

      <SectionHeader
        description="A quick view of your learning progress, attendance, certificates, and payment records."
        title="Learning snapshot"
      />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Courses" value={overview.summary.enrolledCourses} />
        <StatCard
          label="Attendance"
          value={
            overview.summary.attendancePercent === null
              ? "N/A"
              : `${overview.summary.attendancePercent}%`
          }
        />
        <StatCard
          label="Pending Assignments"
          value={overview.summary.pendingAssignments}
        />
        <StatCard
          label="Certificates"
          value={overview.summary.completedCertificates}
        />
        <StatCard label="Paid Payments" value={overview.summary.paidPayments} />
        <StatCard
          label="Pending Payments"
          value={overview.summary.pendingPayments}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card className="border-[#D8E8F0] bg-white p-6">
          <SectionHeader
            actions={
              <Button href="/portal/announcements" size="sm" variant="secondary">
                View announcements
              </Button>
            }
            title="Latest announcements"
          />
          <div className="mt-4 space-y-3">
            {announcements.length === 0 ? (
              <PortalEmptyState>
                No academy announcements have been published yet.
              </PortalEmptyState>
            ) : (
              announcements.map((announcement) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                  key={announcement.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info">Academy update</Badge>
                    <span className="text-xs font-medium text-[#66788F]">
                      {formatAnnouncementDate(announcement.published_at)}
                    </span>
                  </div>
                  <p className="mt-3 font-semibold">{announcement.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#425B76]">
                    {announcement.body}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="border-[#D8E8F0] bg-white p-6">
          <SectionHeader
            actions={<Button href="/portal/sessions" size="sm" variant="secondary">View schedule</Button>}
            title="Upcoming sessions"
          />
          <div className="mt-4 space-y-3">
            {overview.sessions.upcoming.length === 0 ? (
              <PortalEmptyState>No upcoming sessions scheduled.</PortalEmptyState>
            ) : (
              overview.sessions.upcoming.slice(0, 4).map((session) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                  key={session.id}
                >
                  <p className="font-semibold">{session.title}</p>
                  <p className="mt-1 text-sm text-[#425B76]">
                    {formatPortalDateTime(session.scheduled_start_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card className="border-[#D8E8F0] bg-white p-6">
          <SectionHeader
            actions={<Button href="/portal/assignments" size="sm" variant="secondary">View assignments</Button>}
            title="Next assignments"
          />
          <div className="mt-4 space-y-3">
            {overview.assignments.length === 0 ? (
              <PortalEmptyState>No published assignments yet.</PortalEmptyState>
            ) : (
              overview.assignments.slice(0, 4).map((assignment) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                  key={assignment.assignment.id}
                >
                  <p className="font-semibold">{assignment.assignment.title}</p>
                  <p className="mt-1 text-sm text-[#425B76]">
                    Due {formatPortalDateTime(assignment.assignment.due_at)}
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
