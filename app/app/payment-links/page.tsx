import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";

export default function PaymentLinksPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Finance">
        <div className="mx-auto max-w-4xl">
          <Card className="border-[#D8E8F0] bg-white p-8 text-[#0B2A3D] shadow-xl shadow-[#0B2A3D]/10">
            <div className="inline-flex rounded-full border border-[#F59E0B]/30 bg-[#FFF7ED] px-3 py-1 text-xs font-semibold text-[#B45309]">
              Payment gateway on hold
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-normal">
              Payment links are not the active finance workflow
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#425B76]">
              CoachFort now manages academy fees through the Finance Center.
              Use Finance for fee plans, invoices, manual payment records,
              receipts, adjustments, and student payment summaries.
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#425B76]">
              Online payment gateway links will return in a future Razorpay or
              provider integration module after banking details and provider
              credentials are ready. No gateway call or real money movement is
              performed here.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button href="/app/finance">Open Finance Center</Button>
              <Button href="/app/settings/features" variant="secondary">
                Review feature settings
              </Button>
            </div>
          </Card>
        </div>
      </AppShell>
    </RouteGuard>
  );
}
