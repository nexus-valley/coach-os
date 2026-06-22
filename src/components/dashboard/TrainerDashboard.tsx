import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import type { DashboardMetrics } from "@/src/lib/dashboard";

export function TrainerDashboard({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <Card className="mb-8 border-[#D8E8F0] bg-white p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <Badge tone="trainer">Trainer Dashboard</Badge>
          <h2 className="mt-4 text-2xl font-semibold">Teaching cockpit</h2>
          <p className="mt-2 text-sm leading-6 text-[#425B76]">
            Assigned classes, attendance, submissions, and students needing
            attention.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button href="/app/sessions" size="sm" variant="secondary">
            Sessions
          </Button>
          <Button href="/app/assignments" size="sm" variant="secondary">
            Assignments
          </Button>
          <Button href="/app/students" size="sm" variant="secondary">
            Students
          </Button>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-[#F6FBFE] p-4">
          <p className="text-sm text-[#425B76]">Today&apos;s Classes</p>
          <p className="mt-2 text-2xl font-semibold">
            {metrics.attendance.todaysSessions.length}
          </p>
        </div>
        <div className="rounded-2xl bg-[#F6FBFE] p-4">
          <p className="text-sm text-[#425B76]">Pending Attendance</p>
          <p className="mt-2 text-2xl font-semibold">
            {metrics.attendance.upcomingSessions.length}
          </p>
        </div>
        <div className="rounded-2xl bg-[#F6FBFE] p-4">
          <p className="text-sm text-[#425B76]">Pending Reviews</p>
          <p className="mt-2 text-2xl font-semibold">
            {metrics.assignments.pendingReviews}
          </p>
        </div>
        <div className="rounded-2xl bg-[#F6FBFE] p-4">
          <p className="text-sm text-[#425B76]">Scoped Students</p>
          <p className="mt-2 text-2xl font-semibold">{metrics.totalStudents}</p>
        </div>
      </div>
    </Card>
  );
}
