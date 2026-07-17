import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { StatCard } from "@/src/components/ui/StatCard";
import type { DashboardMetrics } from "@/src/lib/dashboard";

export function AdminDashboard({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <Card className="mb-8 mt-8 border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <SectionHeader
          description="Track students, sessions, open balances, assignments, notifications, and workflow health."
          eyebrow="Admin Dashboard"
          title="Daily operations"
        />
        <div className="flex flex-wrap gap-3">
          <Button href="/app/students" size="sm" variant="secondary">
            Students
          </Button>
          <Button href="/app/reports" size="sm" variant="secondary">
            Reports
          </Button>
          <Button href="/app/messages" size="sm" variant="secondary">
            Messages
          </Button>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sessions Today"
          value={metrics.attendance.todaysSessions.length}
        />
        <StatCard
          label="Pending Reviews"
          value={metrics.assignments.pendingReviews}
        />
        <StatCard label="Open Balances" value={metrics.pendingPayments} />
        <StatCard
          label="Unread Threads"
          value={metrics.conversations.unreadThreads}
        />
      </div>
    </Card>
  );
}
