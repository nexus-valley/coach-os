import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { StatCard } from "@/src/components/ui/StatCard";
import type { DashboardMetrics } from "@/src/lib/dashboard";

export function StaffDashboard({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <Card className="mb-8 mt-8 border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <SectionHeader
          description="Student follow-ups, open balance coordination, reminders, and day-to-day operations."
          eyebrow="Staff Dashboard"
          title="Operational workspace"
        />
        <div className="flex flex-wrap gap-3">
          <Button href="/app/students" size="sm" variant="secondary">
            Students
          </Button>
          <Button href="/app/finance" size="sm" variant="secondary">
            Finance
          </Button>
          <Button href="/app/reminders" size="sm" variant="secondary">
            Reminders
          </Button>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Recent Students" value={metrics.recentStudents.length} />
        <StatCard label="Open Balance Follow-ups" value={metrics.pendingPayments} />
        <StatCard label="Reminders Due" value={metrics.pendingRemindersDue} />
        <StatCard label="Messages" value={metrics.conversations.unreadThreads} />
      </div>
    </Card>
  );
}
