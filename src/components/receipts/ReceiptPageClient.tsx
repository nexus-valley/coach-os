"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PaymentStatusBadge } from "@/src/components/payments/PaymentStatusBadge";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import type { PaymentWithRelations } from "@/src/lib/payments";
import { getPaymentReceipt } from "@/src/lib/receipts";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type ReceiptPageClientProps = {
  paymentId: string;
};

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    style: "currency",
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not generated";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

export function ReceiptPageClient({ paymentId }: ReceiptPageClientProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [payment, setPayment] = useState<PaymentWithRelations | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    let active = true;

    async function loadReceipt() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const currentPayment = await getPaymentReceipt(
          paymentId,
          currentTenant.id,
        );

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setPayment(currentPayment);

        if (!currentPayment) {
          setError("Payment not found in this workspace.");
        } else if (!currentPayment.receipt_number) {
          setError("Receipt has not been generated for this payment yet.");
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load receipt."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadReceipt();

    return () => {
      active = false;
    };
  }, [paymentId, router]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl">
        <Card className="h-72 animate-pulse border-white/10 bg-[#101214]">
          <span className="sr-only">Loading receipt</span>
        </Card>
      </div>
    );
  }

  if (error || !payment || !payment.receipt_number) {
    return (
      <div className="mx-auto max-w-5xl">
        <Card className="border-white/10 bg-[#101214] p-8 text-white shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-slate-400">Receipt</p>
          <h2 className="mt-3 text-2xl font-semibold">
            {error || "Receipt unavailable."}
          </h2>
          <Link
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-teal-400 px-5 text-sm font-semibold text-black"
            href="/app/payments"
          >
            Back to payments
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl print:max-w-none">
      <div className="mb-6 flex flex-col justify-between gap-4 print:hidden sm:flex-row sm:items-end">
        <div>
          <Link
            className="text-sm font-semibold text-slate-400 transition hover:text-white"
            href="/app/payments"
          >
            Back to payments
          </Link>
          <h2 className="mt-4 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Receipt
          </h2>
        </div>
        <Button onClick={() => window.print()} type="button">
          Download / Print Receipt
        </Button>
      </div>

      <section className="rounded-[2rem] border border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/20 print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black print:shadow-none sm:p-8">
        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-6 print:rounded-none print:border-0 print:bg-white print:p-0">
          <div className="flex flex-col justify-between gap-6 border-b border-white/10 pb-8 print:border-slate-200 sm:flex-row">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-300 print:text-slate-600">
                {tenant?.name ?? "CoachOS Workspace"}
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-normal print:text-black">
                Receipt
              </h1>
              <p className="mt-3 text-sm text-slate-400 print:text-slate-600">
                Nexus Valley CoachOS
              </p>
            </div>
            <div className="text-left sm:text-right">
              <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300 print:border-slate-300 print:bg-white print:text-black">
                {payment.receipt_number}
              </Badge>
              <p className="mt-4 text-sm text-slate-400 print:text-slate-600">
                Generated {formatDate(payment.receipt_generated_at)}
              </p>
              <p className="mt-1 text-sm text-slate-400 print:text-slate-600">
                Payment date {formatDate(payment.paid_at)}
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-[#101214] p-5 print:border-slate-200 print:bg-white">
              <p className="text-sm font-semibold text-slate-400 print:text-slate-600">
                Billed to
              </p>
              <h3 className="mt-3 text-xl font-semibold print:text-black">
                {payment.student?.full_name ?? "Student unavailable"}
              </h3>
              <p className="mt-2 text-sm text-slate-400 print:text-slate-600">
                {payment.student?.email ||
                  payment.student?.phone ||
                  "No contact details"}
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#101214] p-5 print:border-slate-200 print:bg-white">
              <p className="text-sm font-semibold text-slate-400 print:text-slate-600">
                Course
              </p>
              <h3 className="mt-3 text-xl font-semibold print:text-black">
                {payment.course?.title ?? "Course unavailable"}
              </h3>
              <div className="mt-4">
                <PaymentStatusBadge status={payment.status} />
              </div>
            </div>
          </div>

          <div className="mt-8 overflow-hidden rounded-3xl border border-white/10 print:rounded-none print:border-slate-200">
            <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-white/10 bg-[#15181b] px-5 py-4 text-sm font-semibold print:border-slate-200 print:bg-slate-50 print:text-black">
              <span>Payment detail</span>
              <span>Amount</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-4 px-5 py-5 print:text-black">
              <div>
                <p className="font-semibold">Course payment</p>
                <p className="mt-2 text-sm text-slate-400 print:text-slate-600">
                  Method: {payment.payment_method}
                </p>
              </div>
              <p className="font-semibold">
                {formatCurrency(payment.amount, payment.currency || "USD")}
              </p>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-4 border-t border-white/10 bg-[#15181b] px-5 py-4 text-lg font-semibold print:border-slate-200 print:bg-slate-50 print:text-black">
              <span>Total paid</span>
              <span>
                {formatCurrency(payment.amount, payment.currency || "USD")}
              </span>
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-white/10 bg-[#101214] p-5 print:border-slate-200 print:bg-white">
            <p className="text-sm font-semibold text-slate-400 print:text-slate-600">
              Notes
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white print:text-black">
              {payment.notes || "No notes added."}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
