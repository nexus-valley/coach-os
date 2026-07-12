"use client";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { StatCard } from "@/src/components/ui/StatCard";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  formatPortalDateTime,
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
  usePortalSection,
} from "@/src/components/portal/StudentPortalShared";

export function StudentPortalSessions({ context }: { context: StudentPortalContext }) {
  const { error, loading, overview } = usePortalSection(context);

  if (loading) return <PortalLoadingCard label="Loading sessions" />;
  if (error || !overview) return <PortalError message={error || "Unable to load sessions."} />;

  const upcomingSessions = overview.sessions.upcoming;
  const recentSessions = overview.sessions.recent;

  function renderSession(session: (typeof upcomingSessions)[number]) {
    return (
      <Card className="border-[#D8E8F0] bg-white p-5" key={session.id}>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h2 className="text-lg font-semibold">{session.title}</h2>
            <p className="mt-1 text-sm text-[#425B76]">
              {formatPortalDateTime(session.scheduled_start_at)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="light">{session.delivery_mode}</Badge>
              <Badge tone={session.status === "scheduled" ? "admin" : "staff"}>
                {session.status}
              </Badge>
              {session.meeting_provider ? (
                <Badge tone="light">
                  {session.meeting_provider.replace("_", " ")}
                </Badge>
              ) : null}
            </div>
          </div>
          {session.meeting_url ? (
            <Button href={session.meeting_url} size="sm" variant="secondary">
              Join session
            </Button>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description="Track upcoming sessions, recent classes, and joining links shared by your institute."
        eyebrow="Schedule"
        title="Sessions"
      />

      <section className="grid gap-4 md:grid-cols-2">
        <StatCard label="Upcoming" value={upcomingSessions.length} />
        <StatCard label="Recent" value={recentSessions.length} />
      </section>

      <section>
        <SectionHeader
          description="Scheduled classes and study sessions that are still ahead."
          title="Upcoming schedule"
        />
        <div className="mt-4 space-y-4">
          {upcomingSessions.length === 0 ? (
            <PortalEmptyState>No upcoming sessions scheduled.</PortalEmptyState>
          ) : (
            upcomingSessions.map(renderSession)
          )}
        </div>
      </section>

      <section>
        <SectionHeader
          description="Recently completed or past sessions remain visible for reference."
          title="Recent sessions"
        />
        <div className="mt-4 space-y-4">
          {recentSessions.length === 0 ? (
            <PortalEmptyState>No recent sessions available yet.</PortalEmptyState>
          ) : (
            recentSessions.map(renderSession)
          )}
        </div>
      </section>
    </div>
  );
}
