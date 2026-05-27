import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";

export default function ReceiptsIndexPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Receipts">
        <div className="mx-auto max-w-5xl">
          <Card className="border-[#D8E8F0] bg-white p-8 shadow-xl shadow-[#0B2A3D]/10">
            <div className="inline-flex rounded-full border border-[#14B8C6]/30 bg-[#14B8C6]/10 px-3 py-1 text-xs font-semibold text-[#0E7490]">
              Receipts
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33]">
              Receipt center
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#425B76]">
              Receipts are created from completed payments. Open the payments
              workspace to view payment history, generate receipts, and share
              branded receipt pages.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button href="/app/payments">View payments</Button>
              <Button href="/app/payment-links" variant="secondary">
                View payment links
              </Button>
            </div>
          </Card>
        </div>
      </AppShell>
    </RouteGuard>
  );
}
