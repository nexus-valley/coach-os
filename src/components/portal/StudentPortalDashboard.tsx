"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
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

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Card className="border-[#D8E8F0] bg-white p-5">
      <p className="text-sm font-medium text-[#425B76]">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-[#0B1F33]">{value}</p>
    </Card>
  );
}

export function StudentPortalDashboard({ context }: { context: StudentPortalContext }) {
  const { error, loading, overview } = usePortalSection(context);
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

  if (loading) {
    return <PortalLoadingCard label="Loading student dashboard" />;
  }

  if (error || !overview) {
    return <PortalError message={error || "Unable to load student dashboard."} />;
  }

  const branding = getWorkspaceBranding(settings, context.tenant);

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Badge tone="admin">Student Dashboard</Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-[#0B1F33]">
            {branding.portalWelcomeTitle}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#425B76]">
            {branding.portalWelcomeSubtitle}
          </p>
          <p className="mt-2 text-sm font-semibold text-[#66788F]">
            Signed in as {overview.student.full_name}
          </p>
        </div>
      </div>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard label="Courses" value={overview.summary.enrolledCourses} />
        <SummaryCard
          label="Attendance"
          value={
            overview.summary.attendancePercent === null
              ? "N/A"
              : `${overview.summary.attendancePercent}%`
          }
        />
        <SummaryCard
          label="Pending Assignments"
          value={overview.summary.pendingAssignments}
        />
        <SummaryCard
          label="Certificates"
          value={overview.summary.completedCertificates}
        />
        <SummaryCard label="Paid Payments" value={overview.summary.paidPayments} />
        <SummaryCard
          label="Pending Payments"
          value={overview.summary.pendingPayments}
        />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card className="border-[#D8E8F0] bg-white p-6">
          <h2 className="text-xl font-semibold">Upcoming Sessions</h2>
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

        <Card className="border-[#D8E8F0] bg-white p-6">
          <h2 className="text-xl font-semibold">Next Assignments</h2>
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
