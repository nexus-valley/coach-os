"use client";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  formatPortalCurrency,
  formatPortalDate,
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
  usePortalSection,
} from "@/src/components/portal/StudentPortalShared";

export function StudentPortalPayments({ context }: { context: StudentPortalContext }) {
  const { error, loading, overview } = usePortalSection(context);

  if (loading) return <PortalLoadingCard label="Loading payments" />;
  if (error || !overview) return <PortalError message={error || "Unable to load payments."} />;

  const paymentRows = [...overview.payments.payments, ...overview.payments.paymentLinks];

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-normal">Payments</h1>
      <div className="mt-6 space-y-4">
        {paymentRows.length === 0 ? (
          <PortalEmptyState>No payment records visible yet.</PortalEmptyState>
        ) : (
          paymentRows.map((payment) => (
            <Card className="border-[#D8E8F0] bg-white p-5" key={payment.id}>
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <p className="text-xl font-semibold">
                    {formatPortalCurrency(payment.amount, payment.currency)}
                  </p>
                  <p className="mt-1 text-sm text-[#425B76]">
                    {payment.courseTitle ?? "General payment"}
                  </p>
                  <p className="mt-1 text-xs text-[#66788F]">
                    {"paidAt" in payment
                      ? `Paid ${formatPortalDate(payment.paidAt)}`
                      : `Expires ${formatPortalDate(payment.expiresAt)}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Badge tone={payment.status === "completed" ? "success" : "warning"}>
                    {payment.status}
                  </Badge>
                  {"paymentUrl" in payment && payment.paymentUrl ? (
                    <Button href={payment.paymentUrl} size="sm" variant="secondary">
                      Open Link
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
