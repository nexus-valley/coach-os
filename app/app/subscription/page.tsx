import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { SubscriptionPageClient } from "@/src/components/subscription/SubscriptionPageClient";

export default function SubscriptionPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Subscription">
        <SubscriptionPageClient />
      </AppShell>
    </RouteGuard>
  );
}
