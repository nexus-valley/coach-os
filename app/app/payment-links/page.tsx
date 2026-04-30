import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { PaymentLinksPageClient } from "@/src/components/payment-links/PaymentLinksPageClient";

export default function PaymentLinksPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Payment Links">
        <PaymentLinksPageClient />
      </AppShell>
    </RouteGuard>
  );
}
