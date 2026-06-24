"use client";

import { useEffect, useState } from "react";

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
import {
  formatFinanceCurrency,
  formatFinanceDate,
  getStudentFinanceSummary,
  type FinanceStudentSummary,
} from "@/src/lib/finance";

export function StudentPortalPayments({ context }: { context: StudentPortalContext }) {
  const { error, loading, overview } = usePortalSection(context);
  const [financeError, setFinanceError] = useState("");
  const [financeLoading, setFinanceLoading] = useState(true);
  const [financeSummary, setFinanceSummary] =
    useState<FinanceStudentSummary | null>(null);

  useEffect(() => {
    let active = true;

    async function loadFinance() {
      setFinanceLoading(true);
      setFinanceError("");

      try {
        const summary = await getStudentFinanceSummary(context.student.id);
        if (active) {
          setFinanceSummary(summary);
        }
      } catch (caught) {
        if (active) {
          setFinanceError(
            caught instanceof Error
              ? caught.message
              : "Unable to load finance records.",
          );
        }
      } finally {
        if (active) {
          setFinanceLoading(false);
        }
      }
    }

    void loadFinance();

    return () => {
      active = false;
    };
  }, [context.student.id]);

  if (loading) return <PortalLoadingCard label="Loading payments" />;
  if (error || !overview) return <PortalError message={error || "Unable to load payments."} />;

  const paymentRows = [...overview.payments.payments, ...overview.payments.paymentLinks];
  const financeRows =
    (financeSummary?.invoices.length ?? 0) +
    (financeSummary?.payments.length ?? 0) +
    (financeSummary?.receipts.length ?? 0);

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-normal">Payments</h1>
      <p className="mt-2 text-sm text-[#425B76]">
        Online payment is not enabled yet. Your institute records payments
        manually and receipts appear here after they are issued.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card className="border-[#D8E8F0] bg-white p-5">
          <p className="text-xs font-semibold uppercase text-[#66788F]">
            Outstanding
          </p>
          <p className="mt-3 text-2xl font-semibold">
            {formatFinanceCurrency(financeSummary?.outstanding_amount ?? 0)}
          </p>
        </Card>
        <Card className="border-[#D8E8F0] bg-white p-5">
          <p className="text-xs font-semibold uppercase text-[#66788F]">Paid</p>
          <p className="mt-3 text-2xl font-semibold">
            {formatFinanceCurrency(financeSummary?.paid_amount ?? 0)}
          </p>
        </Card>
        <Card className="border-[#D8E8F0] bg-white p-5">
          <p className="text-xs font-semibold uppercase text-[#66788F]">
            Receipts
          </p>
          <p className="mt-3 text-2xl font-semibold">
            {financeSummary?.receipts.length ?? 0}
          </p>
        </Card>
      </div>

      {financeError ? (
        <PortalError message={financeError} />
      ) : financeLoading ? (
        <div className="mt-6">
          <PortalLoadingCard label="Loading finance records" />
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        {!financeLoading && financeRows === 0 && paymentRows.length === 0 ? (
          <PortalEmptyState>No payment records visible yet.</PortalEmptyState>
        ) : (
          <>
            {financeSummary?.invoices.map((invoice) => (
              <Card className="border-[#D8E8F0] bg-white p-5" key={invoice.id}>
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div>
                    <p className="text-xl font-semibold">
                      {invoice.invoice_number}
                    </p>
                    <p className="mt-1 text-sm text-[#425B76]">
                      Balance{" "}
                      {formatFinanceCurrency(
                        invoice.balance_amount,
                        invoice.currency,
                      )}
                    </p>
                    <p className="mt-1 text-xs text-[#66788F]">
                      Due {formatFinanceDate(invoice.due_date)}
                    </p>
                  </div>
                  <Badge
                    tone={
                      invoice.status === "paid"
                        ? "success"
                        : invoice.status === "overdue"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {invoice.status}
                  </Badge>
                </div>
              </Card>
            ))}

            {financeSummary?.payments.map((payment) => (
              <Card className="border-[#D8E8F0] bg-white p-5" key={payment.id}>
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div>
                    <p className="text-xl font-semibold">
                      {formatFinanceCurrency(payment.amount, payment.currency)}
                    </p>
                    <p className="mt-1 text-sm text-[#425B76]">
                      Manual payment - {payment.payment_method}
                    </p>
                    <p className="mt-1 text-xs text-[#66788F]">
                      Paid {formatFinanceDate(payment.payment_date)}
                    </p>
                  </div>
                  <Badge tone={payment.status === "cancelled" ? "danger" : "success"}>
                    {payment.status}
                  </Badge>
                </div>
              </Card>
            ))}

            {financeSummary?.receipts.map((receipt) => (
              <Card className="border-[#D8E8F0] bg-white p-5" key={receipt.id}>
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div>
                    <p className="text-xl font-semibold">
                      {receipt.receipt_number}
                    </p>
                    <p className="mt-1 text-sm text-[#425B76]">
                      {formatFinanceCurrency(receipt.amount, receipt.currency)}
                    </p>
                    <p className="mt-1 text-xs text-[#66788F]">
                      Issued {formatFinanceDate(receipt.issued_at)}
                    </p>
                  </div>
                  <Badge tone={receipt.status === "issued" ? "success" : "danger"}>
                    {receipt.status}
                  </Badge>
                </div>
              </Card>
            ))}

            {paymentRows.map((payment) => (
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
                  {"paymentUrl" in payment ? (
                    <Button disabled size="sm" variant="secondary">
                      Online payment disabled
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
