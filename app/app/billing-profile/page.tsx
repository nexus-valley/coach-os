import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { BillingProfilePageClient } from "@/src/components/billing/BillingProfilePageClient";
import { AppShell } from "@/src/components/layout/AppShell";

export default function BillingProfilePage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Subscription">
        <BillingProfilePageClient />
      </AppShell>
    </RouteGuard>
  );
}
