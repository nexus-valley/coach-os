import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import type { SubscriptionLifecyclePresentation } from "@/src/lib/subscriptionLifecycleModel";

type InactiveWorkspacePanelProps = {
  canManageSubscription: boolean;
  lifecycle: SubscriptionLifecyclePresentation;
};

export function InactiveWorkspacePanel({
  canManageSubscription,
  lifecycle,
}: InactiveWorkspacePanelProps) {
  const title = canManageSubscription
    ? lifecycle.title
    : "Workspace access is paused";
  const description = canManageSubscription
    ? lifecycle.description
    : "This workspace is currently inactive. Contact a workspace owner or admin for help restoring access.";

  return (
    <Card
      className="mx-auto w-full max-w-3xl border-[#BFD7E6] bg-white px-5 py-7 shadow-lg shadow-[#0B2A3D]/8 sm:px-8 sm:py-9"
      role="status"
    >
      <Badge tone={canManageSubscription ? "warning" : "neutral"}>
        {canManageSubscription ? lifecycle.badge : "Workspace inactive"}
      </Badge>
      <h2 className="mt-5 text-2xl font-semibold text-[#0B2A3D] sm:text-3xl">
        {title}
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5D7185] sm:text-base">
        {description}
      </p>
      {canManageSubscription && lifecycle.primaryActionHref ? (
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button href={lifecycle.primaryActionHref} variant="primary">
            {lifecycle.primaryActionLabel}
          </Button>
          {lifecycle.secondaryActionHref ? (
            <Button href={lifecycle.secondaryActionHref} variant="secondary">
              {lifecycle.secondaryActionLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

