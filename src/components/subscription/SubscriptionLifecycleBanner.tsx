import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import type { SubscriptionLifecyclePresentation } from "@/src/lib/subscriptionLifecycleModel";

type SubscriptionLifecycleBannerProps = {
  lifecycle: SubscriptionLifecyclePresentation;
};

function formatAccessThrough(value: string | null) {
  if (!value) return null;
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function SubscriptionLifecycleBanner({
  lifecycle,
}: SubscriptionLifecycleBannerProps) {
  if (lifecycle.state !== "grace") return null;

  const accessThrough = formatAccessThrough(lifecycle.accessThrough);

  return (
    <section
      className="mb-6 flex flex-col gap-4 rounded-lg border border-[#FED7AA] bg-[#FFF7ED] px-4 py-4 text-[#7C2D12] shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5"
      role="status"
    >
      <div className="min-w-0">
        <Badge tone="warning">{lifecycle.badge}</Badge>
        <p className="mt-2 text-sm font-semibold text-[#9A3412]">
          {lifecycle.description}
        </p>
        {accessThrough ? (
          <p className="mt-1 text-sm text-[#9A3412]">
            Workspace access continues through {accessThrough}.
          </p>
        ) : null}
      </div>
      {lifecycle.primaryActionHref ? (
        <Button
          className="w-full shrink-0 sm:w-auto"
          href={lifecycle.primaryActionHref}
          size="sm"
          variant="secondary"
        >
          {lifecycle.primaryActionLabel}
        </Button>
      ) : null}
    </section>
  );
}
