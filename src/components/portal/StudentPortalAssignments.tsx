"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { StatCard } from "@/src/components/ui/StatCard";
import {
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
} from "@/src/components/portal/StudentPortalShared";
import {
  formatStudentAssignmentDateTime,
  getStudentAssignmentViewModel,
} from "@/src/lib/studentAssignmentModel";
import {
  getStudentAssignmentErrorMessage,
  getStudentAssignments,
  type StudentAssignmentItem,
} from "@/src/lib/studentPortalAssignments";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";

function getStateTone(state: string) {
  if (state.includes("reviewed")) {
    return "success" as const;
  }

  if (state.startsWith("closed")) {
    return "neutral" as const;
  }

  if (state === "overdue_open" || state === "submitted_late") {
    return "warning" as const;
  }

  return "admin" as const;
}

export function StudentPortalAssignments({
  context,
}: {
  context: StudentPortalContext;
}) {
  const [assignments, setAssignments] = useState<StudentAssignmentItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    getStudentAssignments(context)
      .then((items) => {
        if (active) {
          setAssignments(items);
          setError("");
        }
      })
      .catch((caught) => {
        if (active) {
          setError(getStudentAssignmentErrorMessage(caught));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [context]);

  const rows = useMemo(
    () =>
      assignments
        .map((item) => ({
          item,
          view: getStudentAssignmentViewModel({
            dueAt: item.assignment.due_at,
            status: item.assignment.status,
            submission: item.submission,
          }),
        }))
        .sort((left, right) => {
          if (left.view.isClosed !== right.view.isClosed) {
            return left.view.isClosed ? 1 : -1;
          }

          const leftDue = left.item.assignment.due_at
            ? Date.parse(left.item.assignment.due_at)
            : Number.POSITIVE_INFINITY;
          const rightDue = right.item.assignment.due_at
            ? Date.parse(right.item.assignment.due_at)
            : Number.POSITIVE_INFINITY;

          if (leftDue !== rightDue) {
            return leftDue - rightDue;
          }

          return left.item.assignment.id.localeCompare(right.item.assignment.id);
        }),
    [assignments],
  );

  if (loading) {
    return <PortalLoadingCard label="Loading assignments" />;
  }

  if (error) {
    return <PortalError message={error} />;
  }

  const openAssignments = rows.filter((row) => !row.view.isClosed).length;
  const reviewedAssignments = rows.filter((row) => row.view.hasReview).length;

  return (
    <div className="space-y-6">
      <PageHeader
        description="Review current work, submit assignments, and revisit closed feedback."
        eyebrow="Due work"
        title="Assignments"
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total" value={rows.length} />
        <StatCard label="Open" value={openAssignments} />
        <StatCard label="Reviewed" value={reviewedAssignments} />
      </section>

      <SectionHeader
        description="Open assignments appear first. Closed assignments remain available as read-only history."
        title="Your assignment list"
      />
      <div className="space-y-4">
        {rows.length === 0 ? (
          <PortalEmptyState>
            No assignments are available yet. Published work and closed history
            will appear here when available.
          </PortalEmptyState>
        ) : (
          rows.map(({ item, view }) => (
            <Card
              className={[
                "border-[#D8E8F0] p-5",
                view.isClosed ? "bg-[#F8FAFC]" : "bg-white",
              ].join(" ")}
              key={item.assignment.id}
            >
              <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={getStateTone(view.state)}>{view.label}</Badge>
                    <Badge tone="outline">
                      {item.course?.title ??
                        item.cohort?.name ??
                        "Assigned work"}
                    </Badge>
                  </div>
                  <h2 className="mt-4 break-words text-lg font-semibold">
                    {item.assignment.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#425B76]">
                    {item.assignment.due_at
                      ? `Due ${formatStudentAssignmentDateTime(item.assignment.due_at)}`
                      : "No due date"}
                  </p>
                  {item.submission?.feedback ? (
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-[#66788F]">
                      {item.submission.feedback}
                    </p>
                  ) : null}
                </div>
                <Button
                  className="shrink-0"
                  href={`/portal/assignments/${item.assignment.id}`}
                  size="sm"
                  variant={view.isClosed ? "secondary" : "primary"}
                >
                  View assignment
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
