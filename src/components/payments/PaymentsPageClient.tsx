"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PaymentStatusBadge } from "@/src/components/payments/PaymentStatusBadge";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import {
  getPaymentsForTenant,
  type PaymentStatus,
  type PaymentWithRelations,
} from "@/src/lib/payments";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type StatusFilter = "all" | PaymentStatus;

const statusFilters: StatusFilter[] = ["all", "completed", "pending", "failed"];

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

function stringifyError(error: unknown) {
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "[Unable to JSON.stringify payments error]";
  }
}

function getPaymentLoadErrorMessage(error: unknown) {
  return (
    getErrorField(error, "message") ??
    (error instanceof Error ? error.message : "Unable to load payments right now.")
  );
}

function logPaymentsLoadError(error: unknown) {
  const message = getErrorField(error, "message");
  const code = getErrorField(error, "code");
  const details = getErrorField(error, "details");
  const hint = getErrorField(error, "hint");

  console.error("[CoachOS payments] Failed to load payments page data.");
  console.error("[CoachOS payments] error.message", message);
  console.error("[CoachOS payments] error.code", code);
  console.error("[CoachOS payments] error.details", details);
  console.error("[CoachOS payments] error.hint", hint);
  console.error(
    "[CoachOS payments] JSON.stringify(error, null, 2)",
    stringifyError(error),
  );
  console.error("[CoachOS payments] raw error", error);
}

export function PaymentsPageClient() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentWithRelations[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
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
          <p className="mt-3 max-w-2xl text-base leading-7 text-zinc-400">
            Track student payments connected to course enrollments across this
            workspace.
          </p>
        </div>
        <div className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-zinc-100">
          {filteredPayments.length} visible
        </div>
      </div>

      <Card className="mt-8 border-white/10 bg-white/6 p-5 text-white shadow-2xl shadow-black/10 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <div>
            <p className="text-sm font-medium text-zinc-400">
              Current workspace
            </p>
            <p className="mt-1 text-xl font-semibold">
              {tenant?.name ?? "Loading workspace..."}
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-zinc-400">Search</span>
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-white/15 bg-zinc-900 px-4 text-sm text-white outline-none transition placeholder:text-zinc-400 focus:border-white/30 focus:ring-4 focus:ring-white/10"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Student or course"
              type="search"
              value={search}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-400">Status</span>
            <select
              className="mt-2 h-11 rounded-2xl border border-white/15 bg-zinc-900 px-4 text-sm text-white outline-none transition focus:border-white/30 focus:ring-4 focus:ring-white/10"
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              value={statusFilter}
            >
              {statusFilters.map((status) => (
                <option className="text-zinc-950" key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {error ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {loading ? (
        <section className="mt-6 grid gap-4">
          {[0, 1, 2].map((item) => (
            <Card
              className="h-24 animate-pulse border-white/10 bg-white/6"
              key={item}
            >
              <span className="sr-only">Loading payment</span>
            </Card>
          ))}
        </section>
      ) : filteredPayments.length === 0 ? (
        <Card className="mt-6 border-white/10 bg-white p-8 text-zinc-950 shadow-2xl shadow-black/20">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-950 text-sm font-bold text-white">
              PY
            </div>
            <h3 className="mt-6 text-2xl font-semibold">No payments found</h3>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              Add a payment from a student profile once the student is enrolled
              in a course.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden border-white/10 bg-white/6 text-white shadow-2xl shadow-black/10">
          <div className="hidden grid-cols-[1fr_1fr_auto_auto_auto] gap-4 border-b border-white/10 px-5 py-4 text-xs font-semibold text-zinc-500 lg:grid">
            <span>Student</span>
            <span>Course</span>
            <span>Amount</span>
            <span>Status</span>
            <span>Date</span>
          </div>
          <div className="divide-y divide-white/10">
            {filteredPayments.map((payment) => (
              <div
                className="grid gap-4 px-5 py-5 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-center"
                key={payment.id}
              >
                <Link
                  className="transition hover:text-zinc-300"
                  href={`/app/students/${payment.student_id}`}
                >
                  <p className="font-semibold">
                    {payment.student?.full_name ?? "Student unavailable"}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {payment.student?.email ||
                      payment.student?.phone ||
                      "No contact details"}
                  </p>
                </Link>
                <Link
                  className="font-semibold transition hover:text-zinc-300"
                  href={`/app/courses/${payment.course_id}`}
                >
                  {payment.course?.title ?? "Course unavailable"}
                </Link>
                <p className="font-semibold">
                  {formatCurrency(payment.amount, payment.currency || "USD")}
                </p>
                <PaymentStatusBadge status={payment.status} />
                <p className="text-sm text-zinc-500">
                  {formatDate(payment.paid_at)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
