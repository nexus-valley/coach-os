"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { StatCard } from "@/src/components/ui/StatCard";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
} from "@/src/components/portal/StudentPortalShared";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  getStudentFinanceSummary,
  type FinanceStudentSummary,
} from "@/src/lib/finance";

function formatStatus(value: string) {
  return value.replace(/_/g, " ");
}

function FeedbackCopy() {
  return (
    <Card className="border-[#D8E8F0] bg-[#F7FCFF] p-4">
      <p className="text-sm leading-6 text-[#425B76]">
        Online payment is not enabled yet. Your coach records payments
        manually, and receipts appear here after they are issued. Your coach
        will confirm payment instructions directly.
      </p>
    </Card>
  );
}

export function StudentPortalPayments({ context }: { context: StudentPortalContext }) {
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
              : "Unable to load payment records.",
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

  if (financeLoading) {
    return <PortalLoadingCard label="Loading payments and invoices" />;
  }

  if (financeError) {
    return <PortalError message={financeError} />;
  }

  const financeRows =
    (financeSummary?.invoices.length ?? 0) +
    (financeSummary?.payments.length ?? 0) +
    (financeSummary?.receipts.length ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        description="Review invoices, manual payments, and receipts shared by your coach."
        eyebrow="Fees and receipts"
        metadata={<Badge tone="warning">Online payment disabled</Badge>}
        title="Payments & Invoices"
      />

      <FeedbackCopy />

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Outstanding"
          value={formatFinanceCurrency(financeSummary?.outstanding_amount ?? 0)}
        />
        <StatCard
          label="Paid"
          value={formatFinanceCurrency(financeSummary?.paid_amount ?? 0)}
        />
        <StatCard label="Receipts" value={financeSummary?.receipts.length ?? 0} />
      </section>

      <SectionHeader
        description="Your coach records invoices, manual payments, and receipts here. Online payment remains unavailable."
        title="Payment and invoice records"
      />
      <div className="space-y-4">
        {financeRows === 0 ? (
          <PortalEmptyState>
            No payment records visible yet. No payment action is required here
            right now.
          </PortalEmptyState>
        ) : (
          <>
            <section className="space-y-3">
              <SectionHeader
                description="Invoices appear after your coach issues them."
                title="Invoices"
              />
              {financeSummary?.invoices.length ? (
                financeSummary.invoices.map((invoice) => (
                  <Card className="border-[#D8E8F0] bg-white p-5" key={invoice.id}>
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div>
                        <p className="text-xl font-semibold">
                          {invoice.invoice_number}
                        </p>
                        <p className="mt-1 text-sm text-[#425B76]">
                          {invoice.course_title ?? "Program invoice"}
                        </p>
                        <p className="mt-1 text-sm text-[#425B76]">
                          Paid{" "}
                          {formatFinanceCurrency(
                            invoice.paid_amount,
                            invoice.currency,
                          )}{" "}
                          · Balance{" "}
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
                        {formatStatus(invoice.status)}
                      </Badge>
                    </div>
                  </Card>
                ))
              ) : (
                <PortalEmptyState>No invoices issued yet.</PortalEmptyState>
              )}
            </section>

            <section className="space-y-3">
              <SectionHeader
                description="Manual, offline, or external payments appear after your coach records them."
                title="Payments"
              />
              {financeSummary?.payments.length ? (
                financeSummary.payments.map((payment) => (
                  <Card className="border-[#D8E8F0] bg-white p-5" key={payment.id}>
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div>
                        <p className="text-xl font-semibold">
                          {formatFinanceCurrency(payment.amount, payment.currency)}
                        </p>
                        <p className="mt-1 text-sm text-[#425B76]">
                          {payment.course_title ?? "Program payment"}
                        </p>
                        <p className="mt-1 text-sm text-[#425B76]">
                          Manual payment · {formatStatus(payment.payment_method)}
                        </p>
                        <p className="mt-1 text-xs text-[#66788F]">
                          Paid {formatFinanceDate(payment.payment_date)}
                        </p>
                      </div>
                      <Badge tone={payment.status === "cancelled" ? "danger" : "success"}>
                        {formatStatus(payment.status)}
                      </Badge>
                    </div>
                  </Card>
                ))
              ) : (
                <PortalEmptyState>No payments recorded yet.</PortalEmptyState>
              )}
            </section>

            <section className="space-y-3">
              <SectionHeader
                description="Receipts appear after your coach records a payment."
                title="Receipts"
              />
              {financeSummary?.receipts.length ? (
                financeSummary.receipts.map((receipt) => (
                  <Card className="border-[#D8E8F0] bg-white p-5" key={receipt.id}>
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div>
                        <p className="text-xl font-semibold">
                          {receipt.receipt_number}
                        </p>
                        <p className="mt-1 text-sm text-[#425B76]">
                          {receipt.course_title ?? "Program receipt"}
                        </p>
                        <p className="mt-1 text-sm text-[#425B76]">
                          {formatFinanceCurrency(receipt.amount, receipt.currency)}
                        </p>
                        <p className="mt-1 text-xs text-[#66788F]">
                          Issued {formatFinanceDate(receipt.issued_at)}
                        </p>
                      </div>
                      <Badge tone={receipt.status === "issued" ? "success" : "danger"}>
                        {formatStatus(receipt.status)}
                      </Badge>
                    </div>
                  </Card>
                ))
              ) : (
                <PortalEmptyState>No receipts issued yet.</PortalEmptyState>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
