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

type JoinWindowSession = {
  delivery_mode: string;
  id: string;
  join_available_from: string | null;
  meeting_provider: string | null;
  meeting_url: string | null;
  scheduled_start_at: string;
  status: string;
  title: string;
};

function getDeliveryLabel(value: string) {
  return value.replace(/_/g, " ");
}

function getStatusTone(status: string): "danger" | "staff" | "success" | "warning" {
  if (status === "completed") {
    return "success";
  }

  if (status === "canceled") {
    return "danger";
  }

  return "warning";
}

function canJoinLiveClass(session: JoinWindowSession) {
  if (session.status !== "scheduled" || !session.meeting_url) {
    return false;
  }

  if (!session.join_available_from) {
    return true;
  }

  return Date.now() >= new Date(session.join_available_from).getTime();
}

function getJoinAvailabilityLabel(session: JoinWindowSession) {
  if (session.status === "canceled") {
    return "This live class was canceled.";
  }

  if (session.status === "completed") {
    return "This live class is complete.";
  }

  if (
    session.join_available_from &&
    Date.now() < new Date(session.join_available_from).getTime()
  ) {
    return `Join opens ${formatPortalDateTime(session.join_available_from)}`;
  }

  if (!session.meeting_url) {
    return "Meeting link will be shared by your coach.";
  }

  return "Join is open.";
}

function getClosedScheduleLabel(session: JoinWindowSession) {
  if (session.status === "completed") {
    return "This live class is complete.";
  }

  if (session.status === "canceled") {
    return "This live class was canceled.";
  }

  return "This live class is no longer open from this schedule view.";
}

export function StudentPortalSessions({ context }: { context: StudentPortalContext }) {
  const { error, loading, overview } = usePortalSection(context);

  if (loading) return <PortalLoadingCard label="Loading live classes" />;
  if (error || !overview) return <PortalError message={error || "Unable to load live classes."} />;

  const upcomingSessions = overview.sessions.upcoming;
  const recentSessions = overview.sessions.recent.filter(
    (session) => session.status !== "canceled",
  );
  const canceledSessions = overview.sessions.recent.filter(
    (session) => session.status === "canceled",
  );

  function renderJoinAction(
    session: (typeof upcomingSessions)[number],
    allowJoin: boolean,
  ) {
    if (!allowJoin) {
      return (
        <div className="rounded-2xl border border-[#D8E8F0] bg-[#F8FAFC] px-4 py-3 text-sm font-semibold text-[#425B76]">
          {getClosedScheduleLabel(session)}
        </div>
      );
    }

    if (canJoinLiveClass(session)) {
      return (
        <Button href={session.meeting_url ?? ""} size="sm" variant="secondary">
          Join class
        </Button>
      );
    }

    return (
      <div className="rounded-2xl border border-[#D8E8F0] bg-[#F8FAFC] px-4 py-3 text-sm font-semibold text-[#425B76]">
        {getJoinAvailabilityLabel(session)}
      </div>
    );
  }

  function renderSession(
    session: (typeof upcomingSessions)[number],
    tone: "active" | "muted" = "active",
    options: { allowJoin?: boolean } = {},
  ) {
    const allowJoin = options.allowJoin ?? false;

    return (
      <Card
        className={[
          "overflow-hidden border-[#D8E8F0] bg-white p-0 shadow-xl shadow-[#0B2A3D]/10",
          tone === "muted" ? "opacity-90" : "",
        ].join(" ")}
        key={session.id}
      >
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <Badge tone={getStatusTone(session.status)}>{session.status}</Badge>
              <Badge tone="light">{getDeliveryLabel(session.delivery_mode)}</Badge>
              {session.meeting_provider ? (
                <Badge tone="light">
                  {getDeliveryLabel(session.meeting_provider)}
                </Badge>
              ) : null}
            </div>
            <h2 className="mt-4 text-xl font-semibold leading-tight text-[#0B1F33]">
              {session.title}
            </h2>
            <p className="mt-2 text-sm font-medium text-[#425B76]">
              {formatPortalDateTime(session.scheduled_start_at)}
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#64748B]">
              Your coach controls when the joining link becomes available for
              this live class.
            </p>
          </div>
          <div className="shrink-0 sm:max-w-56">
            {renderJoinAction(session, allowJoin)}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description="Follow your live teaching schedule and join only when your coach opens the room."
        eyebrow="Schedule"
        title="Live Classes"
      />

      <section className="grid gap-4 md:grid-cols-2">
        <StatCard label="Upcoming" value={upcomingSessions.length} />
        <StatCard label="Recent" value={recentSessions.length + canceledSessions.length} />
      </section>

      <section>
        <SectionHeader
          description="Scheduled live classes that are still ahead. Join links appear only when access is open."
          title="Upcoming schedule"
        />
        <div className="mt-4 space-y-4">
          {upcomingSessions.length === 0 ? (
            <PortalEmptyState>
              No upcoming live classes are scheduled yet. Your coach will share
              new sessions here when they are ready.
            </PortalEmptyState>
          ) : (
            upcomingSessions.map((session) =>
              renderSession(session, "active", { allowJoin: true }),
            )
          )}
        </div>
      </section>

      <section>
        <SectionHeader
          description="Completed and past live classes remain visible for reference."
          title="Recent classes"
        />
        <div className="mt-4 space-y-4">
          {recentSessions.length === 0 ? (
            <PortalEmptyState>
              No recent live classes are available yet. Completed sessions will
              appear here after they finish.
            </PortalEmptyState>
          ) : (
            recentSessions.map((session) =>
              renderSession(session, "muted", { allowJoin: false }),
            )
          )}
        </div>
      </section>

      {canceledSessions.length > 0 ? (
        <section>
          <SectionHeader
            description="Canceled live classes are shown separately so the schedule stays clear."
            title="Canceled classes"
          />
          <div className="mt-4 space-y-4">
            {canceledSessions.map((session) =>
              renderSession(session, "muted", { allowJoin: false }),
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
