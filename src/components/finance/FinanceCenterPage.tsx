"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { StatCard } from "@/src/components/ui/StatCard";
import {
  applyFinanceAdjustment,
  cancelFinancePayment,
  createFinanceFeePlan,
  createFinanceInvoice,
  financeAdjustmentTypes,
  financeBillingCycles,
  financePaymentMethods,
  formatFinanceCurrency,
  formatFinanceDate,
  getFinanceCenterData,
  recordFinancePayment,
  upsertFinanceSettings,
  updateFinanceFeePlan,
  voidFinanceInvoice,
  type FinanceAdjustmentType,
  type FinanceBillingCycle,
  type FinanceCenterData,
  type FinancePaymentMethod,
} from "@/src/lib/finance";
import { canAccessFinance } from "@/src/lib/permissions";
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import { getStudentsForTenant, type Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant } from "@/src/lib/tenant";

type SettingsForm = {
  invoicePrefix: string;
  paymentTermsDays: string;
  receiptPrefix: string;
};

type FeePlanForm = {
  amount: string;
  billingCycle: FinanceBillingCycle;
  courseId: string;
  description: string;
  dueDay: string;
  installmentsCount: string;
  name: string;
};

type InvoiceForm = {
  courseId: string;
  discountAmount: string;
  dueDate: string;
  feePlanId: string;
  invoiceDate: string;
  notes: string;
  studentId: string;
  subtotalAmount: string;
  taxAmount: string;
};

type PaymentForm = {
  amount: string;
  invoiceId: string;
  notes: string;
  paymentDate: string;
  paymentMethod: FinancePaymentMethod;
  referenceNumber: string;
  studentId: string;
};

type AdjustmentForm = {
  adjustmentType: FinanceAdjustmentType;
  amount: string;
  invoiceId: string;
  reason: string;
};

const today = new Date().toISOString().slice(0, 10);

const emptySettingsForm: SettingsForm = {
  invoicePrefix: "INV-",
  paymentTermsDays: "15",
  receiptPrefix: "RCPT-",
};

const emptyFeePlanForm: FeePlanForm = {
  amount: "",
  billingCycle: "one_time",
  courseId: "",
  description: "",
  dueDay: "",
  installmentsCount: "",
  name: "",
};

const emptyInvoiceForm: InvoiceForm = {
  courseId: "",
  discountAmount: "0",
  dueDate: "",
  feePlanId: "",
  invoiceDate: today,
  notes: "",
  studentId: "",
  subtotalAmount: "",
  taxAmount: "0",
};

const emptyPaymentForm: PaymentForm = {
  amount: "",
  invoiceId: "",
  notes: "",
  paymentDate: today,
  paymentMethod: "cash",
  referenceNumber: "",
  studentId: "",
};

const emptyAdjustmentForm: AdjustmentForm = {
  adjustmentType: "discount",
  amount: "",
  invoiceId: "",
  reason: "",
};

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return fallback;
}

function toAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : Number.NaN;
}

function studentName(students: Student[], studentId: string) {
  return students.find((student) => student.id === studentId)?.full_name ?? "Student";
}

function courseTitle(courses: Course[], courseId: string | null) {
  if (!courseId) return "General";
  return courses.find((course) => course.id === courseId)?.title ?? "Course";
}

export function FinanceCenterPage() {
  const [actionError, setActionError] = useState<string | null>(null);
  const [adjustmentForm, setAdjustmentForm] =
    useState<AdjustmentForm>(emptyAdjustmentForm);
  const [courses, setCourses] = useState<Course[]>([]);
  const [data, setData] = useState<FinanceCenterData | null>(null);
  const [feePlanForm, setFeePlanForm] = useState<FeePlanForm>(emptyFeePlanForm);
  const [invoiceForm, setInvoiceForm] = useState<InvoiceForm>(emptyInvoiceForm);
  const [loading, setLoading] = useState(true);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingsForm, setSettingsForm] =
    useState<SettingsForm>(emptySettingsForm);
  const [students, setStudents] = useState<Student[]>([]);
  const [success, setSuccess] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const initialLoadStarted = useRef(false);

  const canAccess = canAccessFinance(role);

  const openInvoices = useMemo(
    () =>
      (data?.invoices ?? []).filter(
        (invoice) =>
          !["paid", "void", "cancelled"].includes(invoice.status) &&
          invoice.balance_amount > 0,
      ),
    [data?.invoices],
  );

  const hasFinanceSchema =
    Boolean(data?.settings) ||
    Boolean(data?.feePlans.length) ||
    Boolean(data?.invoices.length) ||
    Boolean(data?.payments.length);

  const loadFinance = useCallback(async () => {
    setActionError(null);
    setLoading(true);

    try {
      const supabase = getSupabaseClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("You must be logged in to view finance.");

      const tenant = await getCurrentTenant();
      if (!tenant) throw new Error("No workspace found for this user.");

      const memberRole = await getCurrentMemberRole(tenant.id, user.id);
      setRole(memberRole);
      setTenantId(tenant.id);

      if (!canAccessFinance(memberRole)) {
        setData(null);
        setStudents([]);
        setCourses([]);
        return;
      }

      const [financeData, tenantStudents, tenantCourses] = await Promise.all([
        getFinanceCenterData(tenant.id),
        getStudentsForTenant(tenant.id),
        getCoursesForTenant(tenant.id),
      ]);

      setData(financeData);
      setStudents(tenantStudents);
      setCourses(tenantCourses);
      setSettingsForm({
        invoicePrefix: financeData.settings?.invoice_prefix ?? "INV-",
        paymentTermsDays: String(financeData.settings?.payment_terms_days ?? 15),
        receiptPrefix: financeData.settings?.receipt_prefix ?? "RCPT-",
      });
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load Finance Center."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadFinance();
  }, [loadFinance]);

  async function runAction(action: () => Promise<unknown>, message: string) {
    setActionError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await action();
      setSuccess(message);
      await loadFinance();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Finance action failed."));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) return;

    await runAction(
      () =>
        upsertFinanceSettings({
          invoicePrefix: settingsForm.invoicePrefix,
          paymentTermsDays: Number(settingsForm.paymentTermsDays),
          receiptPrefix: settingsForm.receiptPrefix,
          tenantId,
        }),
      "Finance settings saved.",
    );
  }

  async function handleCreateFeePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) return;

    await runAction(
      () =>
        createFinanceFeePlan({
          amount: toAmount(feePlanForm.amount),
          billingCycle: feePlanForm.billingCycle,
          courseId: feePlanForm.courseId || null,
          description: feePlanForm.description,
          dueDay: feePlanForm.dueDay ? Number(feePlanForm.dueDay) : null,
          installmentsCount: feePlanForm.installmentsCount
            ? Number(feePlanForm.installmentsCount)
            : null,
          name: feePlanForm.name,
          tenantId,
        }),
      "Fee plan created.",
    );
    setFeePlanForm(emptyFeePlanForm);
  }

  async function handleCreateInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) return;

    await runAction(
      () =>
        createFinanceInvoice({
          courseId: invoiceForm.courseId || null,
          discountAmount: toAmount(invoiceForm.discountAmount || "0"),
          dueDate: invoiceForm.dueDate || null,
          feePlanId: invoiceForm.feePlanId || null,
          invoiceDate: invoiceForm.invoiceDate,
          notes: invoiceForm.notes,
          studentId: invoiceForm.studentId,
          subtotalAmount: toAmount(invoiceForm.subtotalAmount),
          taxAmount: toAmount(invoiceForm.taxAmount || "0"),
          tenantId,
        }),
      "Invoice created.",
    );
    setInvoiceForm(emptyInvoiceForm);
  }

  async function handleRecordPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) return;

    const invoice = data?.invoices.find((item) => item.id === paymentForm.invoiceId);

    await runAction(
      () =>
        recordFinancePayment({
          amount: toAmount(paymentForm.amount),
          invoiceId: paymentForm.invoiceId || null,
          notes: paymentForm.notes,
          paymentDate: paymentForm.paymentDate,
          paymentMethod: paymentForm.paymentMethod,
          referenceNumber: paymentForm.referenceNumber,
          studentId: invoice?.student_id ?? paymentForm.studentId,
          tenantId,
        }),
      "Manual payment recorded and receipt issued.",
    );
    setPaymentForm(emptyPaymentForm);
  }

  async function handleApplyAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(
      () =>
        applyFinanceAdjustment({
          adjustmentType: adjustmentForm.adjustmentType,
          amount: toAmount(adjustmentForm.amount),
          invoiceId: adjustmentForm.invoiceId,
          reason: adjustmentForm.reason,
        }),
      "Invoice adjustment applied.",
    );
    setAdjustmentForm(emptyAdjustmentForm);
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <span className="sr-only">Loading Finance Center</span>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#9ADDEA] border-t-[#145DA0]" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-7xl">
        <AccessDeniedCard description="Tenant finance is restricted to owners and admins. Staff and trainers cannot view student dues, invoices, or receipts in this module." />
      </div>
    );
  }

  const dashboard = data?.dashboard;

  return (
    <div className="mx-auto max-w-7xl space-y-6 text-[#0B2A3D]">
      <PageHeader
        actions={
          <Button disabled={saving} onClick={loadFinance} type="button" variant="secondary">
            Refresh
          </Button>
        }
        description="Manage institute fee plans, invoices, dues, manual payments, receipts, discounts, and finance activity for this tenant only."
        eyebrow="Tenant finance"
        title="Finance Center"
      />

      <FeedbackAlert tone="warning">
        Online payment gateway is not enabled yet. Payments are manually
        recorded by owners/admins and no Razorpay, Stripe, UPI, email, WhatsApp,
        or SMS provider is called from this module.
      </FeedbackAlert>

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}
      {!hasFinanceSchema ? (
        <FeedbackAlert tone="warning">
          Finance migration has not been applied yet, or no finance records
          exist. The page is ready and will populate after SQL review/execution.
        </FeedbackAlert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Total invoiced", dashboard?.total_invoiced ?? 0],
          ["Collected", dashboard?.total_collected ?? 0],
          ["Outstanding", dashboard?.total_outstanding ?? 0],
          ["Overdue", dashboard?.overdue_amount ?? 0],
        ].map(([label, value]) => (
          <StatCard
            key={label}
            label={label}
            value={formatFinanceCurrency(Number(value))}
          />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-lg font-semibold">Numbering Settings</h2>
            <form className="mt-4 grid gap-3" onSubmit={handleSaveSettings}>
              <input
                className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    invoicePrefix: event.target.value,
                  }))
                }
                placeholder="Invoice prefix"
                value={settingsForm.invoicePrefix}
              />
              <input
                className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    receiptPrefix: event.target.value,
                  }))
                }
                placeholder="Receipt prefix"
                value={settingsForm.receiptPrefix}
              />
              <input
                className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                min="0"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    paymentTermsDays: event.target.value,
                  }))
                }
                placeholder="Payment terms days"
                type="number"
                value={settingsForm.paymentTermsDays}
              />
              <Button disabled={saving} type="submit">
                Save Settings
              </Button>
            </form>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-semibold">Create Fee Plan</h2>
            <form className="mt-4 grid gap-3" onSubmit={handleCreateFeePlan}>
              <input
                className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                onChange={(event) =>
                  setFeePlanForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Plan name"
                required
                value={feePlanForm.name}
              />
              <input
                className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                min="0"
                onChange={(event) =>
                  setFeePlanForm((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
                placeholder="Amount"
                required
                step="0.01"
                type="number"
                value={feePlanForm.amount}
              />
              <select
                className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                onChange={(event) =>
                  setFeePlanForm((current) => ({
                    ...current,
                    billingCycle: event.target.value as FinanceBillingCycle,
                  }))
                }
                value={feePlanForm.billingCycle}
              >
                {financeBillingCycles.map((cycle) => (
                  <option key={cycle} value={cycle}>
                    {formatLabel(cycle)}
                  </option>
                ))}
              </select>
              <select
                className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                onChange={(event) =>
                  setFeePlanForm((current) => ({
                    ...current,
                    courseId: event.target.value,
                  }))
                }
                value={feePlanForm.courseId}
              >
                <option value="">General plan</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
              <Button disabled={saving} type="submit">
                Create Fee Plan
              </Button>
            </form>
          </Card>
        </div>

        <Card className="p-5">
          <h2 className="text-lg font-semibold">Create Invoice</h2>
          <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={handleCreateInvoice}>
            <select
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm md:col-span-2"
              onChange={(event) =>
                setInvoiceForm((current) => ({
                  ...current,
                  studentId: event.target.value,
                }))
              }
              required
              value={invoiceForm.studentId}
            >
              <option value="">Select student</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.full_name}
                </option>
              ))}
            </select>
            <select
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              onChange={(event) =>
                setInvoiceForm((current) => ({
                  ...current,
                  courseId: event.target.value,
                }))
              }
              value={invoiceForm.courseId}
            >
              <option value="">General invoice</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
            <select
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              onChange={(event) => {
                const plan = data?.feePlans.find(
                  (item) => item.id === event.target.value,
                );
                setInvoiceForm((current) => ({
                  ...current,
                  feePlanId: event.target.value,
                  subtotalAmount: plan ? String(plan.amount) : current.subtotalAmount,
                }));
              }}
              value={invoiceForm.feePlanId}
            >
              <option value="">No fee plan</option>
              {data?.feePlans
                .filter((plan) => plan.status === "active")
                .map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
            </select>
            <input
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              onChange={(event) =>
                setInvoiceForm((current) => ({
                  ...current,
                  invoiceDate: event.target.value,
                }))
              }
              type="date"
              value={invoiceForm.invoiceDate}
            />
            <input
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              onChange={(event) =>
                setInvoiceForm((current) => ({
                  ...current,
                  dueDate: event.target.value,
                }))
              }
              type="date"
              value={invoiceForm.dueDate}
            />
            <input
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              min="0"
              onChange={(event) =>
                setInvoiceForm((current) => ({
                  ...current,
                  subtotalAmount: event.target.value,
                }))
              }
              placeholder="Subtotal"
              required
              step="0.01"
              type="number"
              value={invoiceForm.subtotalAmount}
            />
            <input
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              min="0"
              onChange={(event) =>
                setInvoiceForm((current) => ({
                  ...current,
                  discountAmount: event.target.value,
                }))
              }
              placeholder="Discount"
              step="0.01"
              type="number"
              value={invoiceForm.discountAmount}
            />
            <input
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              min="0"
              onChange={(event) =>
                setInvoiceForm((current) => ({
                  ...current,
                  taxAmount: event.target.value,
                }))
              }
              placeholder="Tax"
              step="0.01"
              type="number"
              value={invoiceForm.taxAmount}
            />
            <input
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              onChange={(event) =>
                setInvoiceForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder="Notes"
              value={invoiceForm.notes}
            />
            <Button className="md:col-span-2" disabled={saving} type="submit">
              Create Invoice
            </Button>
          </form>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-lg font-semibold">Record Manual Payment</h2>
          <form className="mt-4 grid gap-3" onSubmit={handleRecordPayment}>
            <select
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              onChange={(event) => {
                const invoice = data?.invoices.find(
                  (item) => item.id === event.target.value,
                );
                setPaymentForm((current) => ({
                  ...current,
                  amount: invoice ? String(invoice.balance_amount) : current.amount,
                  invoiceId: event.target.value,
                  studentId: invoice?.student_id ?? current.studentId,
                }));
              }}
              value={paymentForm.invoiceId}
            >
              <option value="">Unlinked payment</option>
              {openInvoices.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.invoice_number} - {studentName(students, invoice.student_id)}
                </option>
              ))}
            </select>
            {!paymentForm.invoiceId ? (
              <select
                className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    studentId: event.target.value,
                  }))
                }
                required
                value={paymentForm.studentId}
              >
                <option value="">Select student</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.full_name}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              min="0.01"
              onChange={(event) =>
                setPaymentForm((current) => ({
                  ...current,
                  amount: event.target.value,
                }))
              }
              placeholder="Amount"
              required
              step="0.01"
              type="number"
              value={paymentForm.amount}
            />
            <select
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              onChange={(event) =>
                setPaymentForm((current) => ({
                  ...current,
                  paymentMethod: event.target.value as FinancePaymentMethod,
                }))
              }
              value={paymentForm.paymentMethod}
            >
              {financePaymentMethods.map((method) => (
                <option key={method} value={method}>
                  {formatLabel(method)}
                </option>
              ))}
            </select>
            <input
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              onChange={(event) =>
                setPaymentForm((current) => ({
                  ...current,
                  paymentDate: event.target.value,
                }))
              }
              type="date"
              value={paymentForm.paymentDate}
            />
            <input
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              onChange={(event) =>
                setPaymentForm((current) => ({
                  ...current,
                  referenceNumber: event.target.value,
                }))
              }
              placeholder="Reference number"
              value={paymentForm.referenceNumber}
            />
            <Button disabled={saving} type="submit">
              Record Payment
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="text-lg font-semibold">Apply Adjustment</h2>
          <form className="mt-4 grid gap-3" onSubmit={handleApplyAdjustment}>
            <select
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              onChange={(event) =>
                setAdjustmentForm((current) => ({
                  ...current,
                  invoiceId: event.target.value,
                }))
              }
              required
              value={adjustmentForm.invoiceId}
            >
              <option value="">Select unpaid invoice</option>
              {openInvoices.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.invoice_number} - {formatFinanceCurrency(invoice.balance_amount)}
                </option>
              ))}
            </select>
            <select
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              onChange={(event) =>
                setAdjustmentForm((current) => ({
                  ...current,
                  adjustmentType: event.target.value as FinanceAdjustmentType,
                }))
              }
              value={adjustmentForm.adjustmentType}
            >
              {financeAdjustmentTypes.map((type) => (
                <option key={type} value={type}>
                  {formatLabel(type)}
                </option>
              ))}
            </select>
            <input
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              min="0"
              onChange={(event) =>
                setAdjustmentForm((current) => ({
                  ...current,
                  amount: event.target.value,
                }))
              }
              placeholder="Amount"
              required
              step="0.01"
              type="number"
              value={adjustmentForm.amount}
            />
            <input
              className="rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
              onChange={(event) =>
                setAdjustmentForm((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              placeholder="Reason"
              required
              value={adjustmentForm.reason}
            />
            <Button disabled={saving} type="submit">
              Apply Adjustment
            </Button>
          </form>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-[#D8E8F0] p-5">
            <h2 className="text-lg font-semibold">Invoices</h2>
          </div>
          {data?.invoices.length ? (
            <div className="divide-y divide-[#D8E8F0]">
              {data.invoices.slice(0, 12).map((invoice) => (
                <div
                  className="grid gap-4 p-5 lg:grid-cols-[1fr_1fr_120px_180px]"
                  key={invoice.id}
                >
                  <div>
                    <p className="font-semibold">{invoice.invoice_number}</p>
                    <p className="mt-1 text-sm text-[#66788F]">
                      {studentName(students, invoice.student_id)}
                    </p>
                    <p className="mt-1 text-xs text-[#66788F]">
                      {courseTitle(courses, invoice.course_id)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm">
                      Total {formatFinanceCurrency(invoice.total_amount)}
                    </p>
                    <p className="text-sm text-[#66788F]">
                      Balance {formatFinanceCurrency(invoice.balance_amount)}
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
                    {formatLabel(invoice.status)}
                  </Badge>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={
                        saving ||
                        invoice.status === "paid" ||
                        invoice.status === "void" ||
                        invoice.paid_amount > 0
                      }
                      onClick={() =>
                        void runAction(
                          () => voidFinanceInvoice(invoice.id, "Voided from Finance Center"),
                          "Invoice voided.",
                        )
                      }
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Void
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              description="Create invoices for enrolled students and track balances here."
              icon="INR"
              title="No finance invoices yet"
            />
          )}
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-lg font-semibold">Fee Plans</h2>
            <div className="mt-4 space-y-3">
              {data?.feePlans.length ? (
                data.feePlans.slice(0, 8).map((plan) => (
                  <div
                    className="rounded-2xl border border-[#D8E8F0] p-4"
                    key={plan.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{plan.name}</p>
                        <p className="mt-1 text-sm text-[#66788F]">
                          {formatFinanceCurrency(plan.amount)} ·{" "}
                          {formatLabel(plan.billing_cycle)}
                        </p>
                      </div>
                      <Badge tone={plan.status === "active" ? "success" : "light"}>
                        {plan.status}
                      </Badge>
                    </div>
                    {plan.status !== "archived" ? (
                      <Button
                        className="mt-3"
                        disabled={saving}
                        onClick={() =>
                          void runAction(
                            () =>
                              updateFinanceFeePlan({
                                feePlanId: plan.id,
                                status: "archived",
                              }),
                            "Fee plan archived.",
                          )
                        }
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        Archive
                      </Button>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-sm text-[#66788F]">No fee plans yet.</p>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-semibold">Recent Payments</h2>
            <div className="mt-4 space-y-3">
              {data?.payments.length ? (
                data.payments.slice(0, 8).map((payment) => (
                  <div
                    className="rounded-2xl border border-[#D8E8F0] p-4"
                    key={payment.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">
                          {formatFinanceCurrency(payment.amount)}
                        </p>
                        <p className="mt-1 text-sm text-[#66788F]">
                          {studentName(students, payment.student_id)} ·{" "}
                          {formatFinanceDate(payment.payment_date)}
                        </p>
                      </div>
                      <Badge tone={payment.status === "cancelled" ? "danger" : "success"}>
                        {payment.status}
                      </Badge>
                    </div>
                    {payment.status === "recorded" || payment.status === "confirmed" ? (
                      <Button
                        className="mt-3"
                        disabled={saving}
                        onClick={() =>
                          void runAction(
                            () =>
                              cancelFinancePayment(
                                payment.id,
                                "Cancelled from Finance Center",
                              ),
                            "Payment cancelled and invoice balance reversed.",
                          )
                        }
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-sm text-[#66788F]">No manual payments recorded.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card className="p-5">
        <h2 className="text-lg font-semibold">Finance Activity</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {data?.activities.length ? (
            data.activities.slice(0, 12).map((activity) => (
              <div
                className="rounded-2xl border border-[#D8E8F0] p-4"
                key={activity.id}
              >
                <p className="font-semibold">{formatLabel(activity.action)}</p>
                <p className="mt-1 text-sm text-[#66788F]">
                  {formatFinanceDate(activity.created_at)}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-[#66788F]">No finance activity yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
