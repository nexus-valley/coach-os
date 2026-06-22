"use client";

import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  formatPortalDateTime,
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
  usePortalSection,
} from "@/src/components/portal/StudentPortalShared";

export function StudentPortalAssignments({ context }: { context: StudentPortalContext }) {
  const { error, loading, overview } = usePortalSection(context);

  if (loading) return <PortalLoadingCard label="Loading assignments" />;
  if (error || !overview) return <PortalError message={error || "Unable to load assignments."} />;

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-normal">Assignments</h1>
      <div className="mt-6 space-y-4">
        {overview.assignments.length === 0 ? (
          <PortalEmptyState>No published assignments yet.</PortalEmptyState>
        ) : (
          overview.assignments.map((item) => {
            const status = item.submission?.status ?? "pending";

            return (
              <Card className="border-[#D8E8F0] bg-white p-5" key={item.assignment.id}>
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div>
                    <h2 className="text-lg font-semibold">{item.assignment.title}</h2>
                    <p className="mt-1 text-sm text-[#425B76]">
                      Due {formatPortalDateTime(item.assignment.due_at)}
                    </p>
                    <p className="mt-2 text-sm text-[#66788F]">
                      {item.course?.title ?? item.cohort?.name ?? "Assigned work"}
                    </p>
                    {item.submission?.feedback ? (
                      <p className="mt-3 rounded-2xl bg-[#F6FBFE] p-3 text-sm text-[#425B76]">
                        {item.submission.feedback}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Badge tone={status === "reviewed" ? "success" : "warning"}>
                      {status}
                    </Badge>
                    {item.submission?.score !== null && item.submission?.score !== undefined ? (
                      <Badge tone="admin">
                        {item.submission.score}/{item.assignment.max_score ?? "N/A"}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
