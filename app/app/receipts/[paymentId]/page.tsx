import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { ReceiptPageClient } from "@/src/components/receipts/ReceiptPageClient";

type ReceiptPageProps = {
  params: Promise<{
    paymentId: string;
  }>;
};

export default async function ReceiptPage({ params }: ReceiptPageProps) {
  const { paymentId } = await params;

  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Finance">
        <ReceiptPageClient paymentId={paymentId} />
      </AppShell>
    </RouteGuard>
  );
}
