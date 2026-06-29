"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PaymentStatusBadge } from "@/src/components/payments/PaymentStatusBadge";
import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  getPaymentsForTenant,
  type PaymentStatus,
  type PaymentWithRelations,
} from "@/src/lib/payments";
import { canAccessPayments } from "@/src/lib/permissions";
import { attachReceiptToPayment } from "@/src/lib/receipts";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  canManagePayments,
  getCurrentMemberRole,
  type MemberRole,
} from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type StatusFilter = "all" | PaymentStatus;

const statusFilters: StatusFilter[] = ["all", "completed", "pending", "failed"];
const paymentGridColumns =
  "grid-cols-[minmax(180px,1.4fr)_minmax(220px,1.4fr)_120px_120px_220px_130px]";

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    style: "currency",
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getSearchText(payment: PaymentWithRelations) {
  return [
    payment.student?.full_name,
    payment.student?.email,
    payment.course?.title,
    payment.status,
    payment.payment_method,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getErrorField(error: unknown, field: "code" | "details" | "hint" | "message") {
  if (!error || typeof error !== "object" || !(field in error)) {
    return undefined;
  }

  const value = (error as Record<typeof field, unknown>)[field];

  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return undefined;
  }

  return String(value);
}

function getPaymentLoadErrorMessage(error: unknown) {
  return (
    getErrorField(error, "message") ??
    (error instanceof Error ? error.message : "Unable to load payments right now.")
  );
}

function logPaymentsLoadError(error: unknown) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const message = getErrorField(error, "message");
  const code = getErrorField(error, "code");

  console.error("[CoachFort payments] Failed to load payments page data.");
  console.error("[CoachFort payments] error.message", message);
  console.error("[CoachFort payments] error.code", code);
}

export function PaymentsPageClient() {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutatingReceiptId, setMutatingReceiptId] = useState("");
  const [payments, setPayments] = useState<PaymentWithRelations[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    let active = true;

    async function loadPayments() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        setTenant(currentTenant);

        const supabase = getSupabaseClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        const memberRole = user
          ? await getCurrentMemberRole(currentTenant.id, user.id)
          : null;

        if (!active) {
          return;
        }

        setCurrentRole(memberRole);

        if (!canAccessPayments(memberRole)) {
          setPayments([]);
          setError("");
          return;
        }

        const tenantPayments = await getPaymentsForTenant(currentTenant.id);

        if (!active) {
          return;
        }

        setPayments(tenantPayments);
        setError("");
      } catch (caught) {
        if (!active) {
          return;
        }

        logPaymentsLoadError(caught);
        setError(getPaymentLoadErrorMessage(caught));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadPayments();

    return () => {
      active = false;
    };
  }, [router]);

  const filteredPayments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return payments.filter((payment) => {
      const matchesStatus =
        statusFilter === "all" || payment.status === statusFilter;
      const matchesSearch =
        !normalizedSearch || getSearchText(payment).includes(normalizedSearch);

      return matchesStatus && matchesSearch;
    });
  }, [payments, search, statusFilter]);

  async function handleGenerateReceipt(paymentId: string) {
    if (!tenant || !canManagePayments(currentRole)) {
      return;
    }

    setMutatingReceiptId(paymentId);
    setActionError("");
    setSuccess("");

    try {
      const receipt = await attachReceiptToPayment(paymentId, tenant.id);
      setPayments((current) =>
        current.map((payment) =>
          payment.id === receipt.id ? { ...payment, ...receipt } : payment,
        ),
      );
      setSuccess("Receipt generated.");
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : "Unable to generate receipt right now.",
      );
    } finally {
      setMutatingReceiptId("");
    }
  }

  if (currentRole && !canAccessPayments(currentRole)) {
    return (
      <div className="mx-auto max-w-7xl">
        <AccessDeniedCard description="Payment records are not available for your current workspace role." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            Payments foundation
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Payments
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Track student payments connected to course enrollments across this
            workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button href="/app/payment-links" size="sm" variant="secondary">
            Payment Links
          </Button>
          <div className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white">
            {filteredPayments.length} visible
          </div>
        </div>
      </div>

      <Card className="mt-8 border-white/10 bg-[#101214] p-5 text-white shadow-2xl shadow-black/10 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <div>
            <p className="text-sm font-medium text-slate-400">
              Current workspace
            </p>
            <p className="mt-1 text-xl font-semibold">
              {tenant?.name ?? "Loading workspace..."}
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-400">Search</span>
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-white/30 focus:ring-4 focus:ring-white/10"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Student or course"
              type="search"
              value={search}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-400">Status</span>
            <select
              className="mt-2 h-11 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-white/30 focus:ring-4 focus:ring-white/10"
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              value={statusFilter}
            >
              {statusFilters.map((status) => (
                <option className="text-slate-950" key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {error ? (
        <div className="mt-6">
          <FeedbackAlert onRetry={() => window.location.reload()}>
            {error}
          </FeedbackAlert>
        </div>
      ) : null}

      {actionError ? (
        <div className="mt-6">
          <FeedbackAlert>{actionError}</FeedbackAlert>
        </div>
      ) : null}

      {success ? (
        <div className="mt-6">
          <FeedbackAlert tone="success">{success}</FeedbackAlert>
        </div>
      ) : null}

      {loading ? (
        <section className="mt-6 grid gap-4">
          {[0, 1, 2].map((item) => (
            <Card
              className="h-24 animate-pulse border-white/10 bg-[#101214]"
              key={item}
            >
              <span className="sr-only">Loading payment</span>
            </Card>
          ))}
        </section>
      ) : filteredPayments.length === 0 ? (
        <EmptyState
          action={{ label: "Open Students", onClick: () => router.push("/app/students") }}
          description="Add a payment from a student profile once the student is enrolled in a course."
          icon="PY"
          title="No payments found"
        />
      ) : (
        <Card className="mt-6 overflow-hidden border-white/10 bg-[#101214] text-white shadow-2xl shadow-black/10">
          <div className="overflow-x-auto">
            <div className="min-w-[1040px]">
              <div
                className={[
                  "grid gap-4 border-b border-white/10 px-5 py-4 text-xs font-semibold text-slate-400",
                  paymentGridColumns,
                ].join(" ")}
              >
                <span>Student</span>
                <span>Course</span>
                <span className="text-right">Amount</span>
                <span>Status</span>
                <span>Receipt</span>
                <span>Date</span>
              </div>
              <div className="divide-y divide-white/10">
                {filteredPayments.map((payment) => (
                  <div
                    className={[
                      "grid gap-4 px-5 py-5",
                      paymentGridColumns,
                      "items-start",
                    ].join(" ")}
                    key={payment.id}
                  >
                    <Link
                      className="min-w-0 transition hover:text-white"
                      href={`/app/students/${payment.student_id}`}
                    >
                      <p className="truncate font-semibold">
                        {payment.student?.full_name ?? "Student unavailable"}
                      </p>
                      <p className="mt-1 truncate text-sm text-slate-400">
                        {payment.student?.email ||
                          payment.student?.phone ||
                          "No contact details"}
                      </p>
                    </Link>
                    <Link
                      className="min-w-0 truncate font-semibold transition hover:text-white"
                      href={`/app/courses/${payment.course_id}`}
                    >
                      {payment.course?.title ?? "Course unavailable"}
                    </Link>
                    <div className="text-right">
                      <p className="font-semibold">
                        {formatCurrency(
                          payment.amount,
                          payment.currency || "USD",
                        )}
                      </p>
                      <p className="mt-1 text-xs font-medium text-slate-400">
                        {payment.payment_method || "Manual"}
                      </p>
                    </div>
                    <div>
                      <PaymentStatusBadge status={payment.status} />
                    </div>
                    <div className="space-y-2">
                      {payment.receipt_number ? (
                        <>
                          <Link
                            className="block truncate text-sm font-semibold text-teal-300 transition hover:text-teal-200"
                            href={`/app/receipts/${payment.id}`}
                          >
                            {payment.receipt_number}
                          </Link>
                          <div className="flex flex-wrap gap-2">
                            <Badge className="border-[#A7F3D0] bg-[#E8F8F3] text-[#047857]">
                              Generated
                            </Badge>
                            <Link
                              className="inline-flex h-8 items-center justify-center rounded-full border border-white/10 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/15"
                              href={`/app/receipts/${payment.id}`}
                            >
                              View
                            </Link>
                            <Link
                              className="inline-flex h-8 items-center justify-center rounded-full border border-white/10 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/15"
                              href={`/app/receipts/${payment.id}`}
                            >
                              Download
                            </Link>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="border-[#CBD5E1] bg-[#F1F5F9] text-[#334155]">
                            Not generated
                          </Badge>
                          {canManagePayments(currentRole) ? (
                            <Button
                              disabled={mutatingReceiptId === payment.id}
                              onClick={() => handleGenerateReceipt(payment.id)}
                              size="sm"
                              type="button"
                            >
                              {mutatingReceiptId === payment.id
                                ? "Generating..."
                                : "Generate Receipt"}
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-slate-400">
                      {formatDate(payment.paid_at)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
