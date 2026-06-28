import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import type { DashboardMetrics } from "@/src/lib/dashboard";

export function StaffDashboard({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <Card className="mb-8 border-[#D8E8F0] bg-white p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <Badge tone="staff">Staff Dashboard</Badge>
          <h2 className="mt-4 text-2xl font-semibold">Operational workspace</h2>
          <p className="mt-2 text-sm leading-6 text-[#425B76]">
            Student follow-ups, payment collection, reminders, and day-to-day
            coordination.
          </p>
        </div>
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
        <div className="rounded-2xl bg-[#F6FBFE] p-4">
          <p className="text-sm text-[#425B76]">Recent Students</p>
          <p className="mt-2 text-2xl font-semibold">
            {metrics.recentStudents.length}
          </p>
        </div>
        <div className="rounded-2xl bg-[#F6FBFE] p-4">
          <p className="text-sm text-[#425B76]">Payments To Collect</p>
          <p className="mt-2 text-2xl font-semibold">{metrics.pendingPayments}</p>
        </div>
        <div className="rounded-2xl bg-[#F6FBFE] p-4">
          <p className="text-sm text-[#425B76]">Reminders Due</p>
          <p className="mt-2 text-2xl font-semibold">
            {metrics.pendingRemindersDue}
          </p>
        </div>
        <div className="rounded-2xl bg-[#F6FBFE] p-4">
          <p className="text-sm text-[#425B76]">Messages</p>
          <p className="mt-2 text-2xl font-semibold">
            {metrics.conversations.unreadThreads}
          </p>
        </div>
      </div>
    </Card>
  );
}
