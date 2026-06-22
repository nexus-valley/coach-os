"use client";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
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

  const sessions = [...overview.sessions.upcoming, ...overview.sessions.recent];

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-normal">Sessions & Live Classes</h1>
      <div className="mt-6 space-y-4">
        {sessions.length === 0 ? (
          <PortalEmptyState>No sessions available yet.</PortalEmptyState>
        ) : (
          sessions.map((session) => (
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
                      <Badge tone="light">{session.meeting_provider.replace("_", " ")}</Badge>
                    ) : null}
                  </div>
                </div>
                {session.meeting_url ? (
                  <Button href={session.meeting_url} size="sm" variant="secondary">
                    Join Class
                  </Button>
                ) : null}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
