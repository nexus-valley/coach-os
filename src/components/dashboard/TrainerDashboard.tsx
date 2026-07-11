import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { StatCard } from "@/src/components/ui/StatCard";
import type { DashboardMetrics } from "@/src/lib/dashboard";

export function TrainerDashboard({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <Card className="mb-8 mt-8 border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <SectionHeader
          description="Assigned classes, attendance, submissions, and students needing attention."
          eyebrow="Trainer Dashboard"
          title="Teaching cockpit"
        />
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
        <StatCard
          label="Today's Classes"
          value={metrics.attendance.todaysSessions.length}
        />
        <StatCard
          label="Pending Attendance"
          value={metrics.attendance.upcomingSessions.length}
        />
        <StatCard
          label="Pending Reviews"
          value={metrics.assignments.pendingReviews}
        />
        <StatCard label="Scoped Students" value={metrics.totalStudents} />
      </div>
    </Card>
  );
}
