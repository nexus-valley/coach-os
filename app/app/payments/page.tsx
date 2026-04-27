import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { PaymentsPageClient } from "@/src/components/payments/PaymentsPageClient";

export default function PaymentsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Payments">
        <PaymentsPageClient />
      </AppShell>
    </RouteGuard>
  );
}
