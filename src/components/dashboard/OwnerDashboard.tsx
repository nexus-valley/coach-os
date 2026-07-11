import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { StatCard } from "@/src/components/ui/StatCard";
import type { DashboardMetrics } from "@/src/lib/dashboard";
import type { Tenant } from "@/src/lib/tenant";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    currency: "INR",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

export function OwnerDashboard({
  metrics,
  tenant,
}: {
  metrics: DashboardMetrics;
  tenant: Tenant | null;
}) {
  return (
    <Card className="mb-8 mt-8 border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5">
      <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <SectionHeader
          description="Revenue, usage, security, automation health, and operating signals for workspace ownership."
          eyebrow="Owner Dashboard"
          title={`Executive view for ${tenant?.name ?? "this workspace"}`}
        />
        <div className="flex flex-wrap gap-3">
          <Button href="/app/operations" size="sm" variant="secondary">
            Operations
          </Button>
          <Button href="/app/subscription" size="sm" variant="secondary">
            Subscription
          </Button>
          <Button href="/app/permissions" size="sm" variant="secondary">
            Permissions
          </Button>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue" value={formatCurrency(metrics.totalRevenue)} />
        <StatCard label="Students" value={metrics.totalStudents} />
        <StatCard label="Automation Failures" value={metrics.failedAutomationRuns} />
        <StatCard label="Extra Permissions" value={metrics.delegatedPermissions} />
      </div>
    </Card>
  );
}
