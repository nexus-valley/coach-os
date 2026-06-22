import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
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
    <Card className="mb-8 border-[#D8E8F0] bg-white p-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <Badge tone="admin">Owner Dashboard</Badge>
          <h2 className="mt-4 text-2xl font-semibold">
            Executive view for {tenant?.name ?? "this workspace"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#425B76]">
            Revenue, usage, security, automation health, and operating signals
            for workspace ownership.
          </p>
        </div>
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
        <div className="rounded-2xl bg-[#F6FBFE] p-4">
          <p className="text-sm text-[#425B76]">Revenue</p>
          <p className="mt-2 text-2xl font-semibold">
            {formatCurrency(metrics.totalRevenue)}
          </p>
        </div>
        <div className="rounded-2xl bg-[#F6FBFE] p-4">
          <p className="text-sm text-[#425B76]">Students</p>
          <p className="mt-2 text-2xl font-semibold">{metrics.totalStudents}</p>
        </div>
        <div className="rounded-2xl bg-[#F6FBFE] p-4">
          <p className="text-sm text-[#425B76]">Automation Failures</p>
          <p className="mt-2 text-2xl font-semibold">
            {metrics.failedAutomationRuns}
          </p>
        </div>
        <div className="rounded-2xl bg-[#F6FBFE] p-4">
          <p className="text-sm text-[#425B76]">Extra Permissions</p>
          <p className="mt-2 text-2xl font-semibold">
            {metrics.delegatedPermissions}
          </p>
        </div>
      </div>
    </Card>
  );
}
