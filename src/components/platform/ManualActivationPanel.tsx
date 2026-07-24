"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { getPlanAmountMinor } from "@/src/lib/plans";
import {
  activateTenantSubscriptionManual,
  normalizePlatformError,
  type ManualSubscriptionActivationInput,
  type ManualSubscriptionActivationResult,
  type PlatformAdminContext,
  type PlatformTenantDetail,
  type PlatformTenantSummary,
} from "@/src/lib/platform";
import type { TenantEntitlementState } from "@/src/lib/subscriptionEntitlements";

type ManualActivationFormState = {
  amountMinor: string;
  billingCycle: ManualSubscriptionActivationInput["billingCycle"];
  confirmationPhrase: string;
  currency: ManualSubscriptionActivationInput["currency"];
  customerEmail: string;
  founderApproval: string;
  gracePeriodEndsAt: string;
  idempotencyKey: string;
  operatorNote: string;
  paymentMethod: string;
  paymentReference: string;
  paymentVerifiedAt: string;
  planCode: ManualSubscriptionActivationInput["planCode"];
  replaceCurrent: boolean;
  subscriptionEnd: string;
  subscriptionStart: string;
  supportTier: string;
  tenantId: string;
  verified: boolean;
};

type ManualActivationPanelProps = {
  adminRole: PlatformAdminContext["role"];
  canonicalEntitlement: TenantEntitlementState | null;
  detail: PlatformTenantDetail | null;
  onActivated?: () => Promise<void> | void;
  selectedTenant: PlatformTenantSummary | null;
};

const confirmationPhrase = "ACTIVATE MANUAL SUBSCRIPTION";
const regressionTenantId = "29a33701-82ed-4c7f-8042-0a1af8296ce5";
const regressionTenantName = "CoachFort Regression Coaching";
const regressionTenantSlug = "coachfort-regression";
const regressionCustomerEmail = "owner.regression@coachfort.demo";
const regressionPaymentReference = "CF-REGRESSION-STARTER-MONTHLY-20260719-01";
const regressionIdempotencyKey =
  "manual-activation-regression-starter-monthly-20260719-01";
const exactAmounts: Record<
  ManualActivationFormState["planCode"],
  Record<ManualActivationFormState["billingCycle"], number>
> = {
  growth: {
    monthly: getPlanAmountMinor("growth", "monthly") ?? 0,
    yearly: getPlanAmountMinor("growth", "yearly") ?? 0,
  },
  starter: {
    monthly: getPlanAmountMinor("starter", "monthly") ?? 0,
    yearly: getPlanAmountMinor("starter", "yearly") ?? 0,
  },
};

const emptyForm: ManualActivationFormState = {
  amountMinor: "",
  billingCycle: "monthly",
  confirmationPhrase: "",
  currency: "INR",
  customerEmail: "",
  founderApproval: "",
  gracePeriodEndsAt: "",
  idempotencyKey: "",
  operatorNote: "",
  paymentMethod: "",
  paymentReference: "",
  paymentVerifiedAt: "",
  planCode: "starter",
  replaceCurrent: false,
  subscriptionEnd: "",
  subscriptionStart: "",
  supportTier: "",
  tenantId: "",
  verified: false,
};

function formatLabel(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replace(/_/g, " ");
}

function toDateTimeLocal(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function addOneMonth(date: Date) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
}

function subtractMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() - minutes * 60 * 1000);
}

function hasCurrentCanonicalAssignment(
  canonicalEntitlement: TenantEntitlementState | null,
) {
  const assignment = canonicalEntitlement?.assignment;
  return Boolean(
    assignment?.plan_code ||
      assignment?.status ||
      assignment?.payment_status ||
      assignment?.billing_cycle,
  );
}

function validationErrors(
  form: ManualActivationFormState,
  currentAssignmentExists: boolean,
  tenantSummaryMismatch: boolean,
) {
  const errors: string[] = [];
  const amount = Number(form.amountMinor);
  const expectedAmount = exactAmounts[form.planCode]?.[form.billingCycle];
  const startTime = form.subscriptionStart
    ? new Date(form.subscriptionStart).getTime()
    : Number.NaN;
  const endTime = form.subscriptionEnd
    ? new Date(form.subscriptionEnd).getTime()
    : Number.NaN;
  const paymentVerifiedTime = form.paymentVerifiedAt
    ? new Date(form.paymentVerifiedAt).getTime()
    : Number.NaN;

  if (!form.tenantId.trim()) errors.push("Tenant id is required.");
  if (tenantSummaryMismatch) {
    errors.push("Activation target mismatch must be resolved.");
  }
  if (!form.customerEmail.trim()) errors.push("Customer email is required.");
  if (form.planCode !== "starter" && form.planCode !== "growth") {
    errors.push("Only Starter and Growth manual activation are allowed.");
  }
  if (form.currency !== "INR") errors.push("Currency must be INR.");
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    errors.push("Amount minor must be a positive integer.");
  } else if (amount !== expectedAmount) {
    errors.push(`Amount minor must be ${expectedAmount} for this plan and cycle.`);
  }
  if (!form.subscriptionStart) errors.push("Subscription start is required.");
  if (!form.subscriptionEnd) errors.push("Subscription end is required.");
  if (
    form.subscriptionStart &&
    form.subscriptionEnd &&
    (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime)
  ) {
    errors.push("Subscription end must be after subscription start.");
  }
  if (!form.paymentVerifiedAt) {
    errors.push("Payment verified time is required.");
  } else if (!Number.isFinite(paymentVerifiedTime)) {
    errors.push("Payment verified time must be a valid timestamp.");
  } else if (paymentVerifiedTime > Date.now()) {
    errors.push("Payment verified time must be current or in the past.");
  }
  if (!form.paymentMethod.trim()) errors.push("Payment method is required.");
  if (!form.paymentReference.trim()) errors.push("Payment reference is required.");
  if (!form.founderApproval.trim()) errors.push("Founder approval is required.");
  if (!form.idempotencyKey.trim()) errors.push("Idempotency key is required.");
  if (form.confirmationPhrase !== confirmationPhrase) {
    errors.push("Confirmation phrase is required.");
  }
  if (!form.verified) {
    errors.push("Founder-approved and payment-verified checkbox is required.");
  }
  if (currentAssignmentExists && !form.replaceCurrent) {
    errors.push("Replace current must be checked for a tenant with a current assignment.");
  }

  return errors;
}

function getActivationTargetSummary({
  activationMode,
  detail,
  form,
  selectedTenant,
}: {
  activationMode: "regression" | "selected";
  detail: PlatformTenantDetail | null;
  form: ManualActivationFormState;
  selectedTenant: PlatformTenantSummary | null;
}) {
  const formTenantId = form.tenantId.trim();
  const selectedTenantId = selectedTenant?.id ?? "";

  if (activationMode === "regression" && formTenantId === regressionTenantId) {
    return {
      canonicalAssignment: "not loaded in regression prefill",
      customerEmail: regressionCustomerEmail,
      mode: "Regression controlled test",
      platformSubscription: "not loaded in regression prefill",
      slug: regressionTenantSlug,
      tenantId: regressionTenantId,
      tenantName: regressionTenantName,
    };
  }

  if (
    formTenantId &&
    selectedTenant &&
    selectedTenantId &&
    formTenantId === selectedTenantId
  ) {
    return {
      canonicalAssignment: "selected tenant canonical state",
      customerEmail: form.customerEmail || "Entered customer email required",
      mode: "Selected tenant",
      platformSubscription: [
        detail?.subscription.plan_code ?? "not set",
        detail?.subscription.status ?? "not set",
        detail?.subscription.payment_status ?? "not set",
      ].join(" / "),
      slug: selectedTenant.slug,
      tenantId: selectedTenant.id,
      tenantName: selectedTenant.name,
    };
  }

  return {
    canonicalAssignment: "blocked until tenant is selected or verified",
    customerEmail: form.customerEmail || "Entered customer email required",
    mode: formTenantId ? "Unverified tenant id" : "No activation target",
    platformSubscription: "blocked until tenant is selected or verified",
    slug: "Not verified",
    tenantId: formTenantId || "Not set",
    tenantName: formTenantId ? "Unknown activation target" : "Not selected",
  };
}

function buildInput(form: ManualActivationFormState): ManualSubscriptionActivationInput {
  return {
    amountMinor: Number(form.amountMinor),
    billingCycle: form.billingCycle,
    currency: form.currency,
    customerEmail: form.customerEmail.trim(),
    founderApproval: form.founderApproval.trim(),
    gracePeriodEndsAt: form.gracePeriodEndsAt || null,
    idempotencyKey: form.idempotencyKey.trim(),
    operatorNote: form.operatorNote.trim() || null,
    paymentMethod: form.paymentMethod.trim(),
    paymentReference: form.paymentReference.trim(),
    paymentVerifiedAt: form.paymentVerifiedAt,
    planCode: form.planCode,
    replaceCurrent: form.replaceCurrent,
    subscriptionEnd: form.subscriptionEnd,
    subscriptionStart: form.subscriptionStart,
    supportTier: form.supportTier.trim() || null,
    tenantId: form.tenantId.trim(),
  };
}

export function ManualActivationPanel({
  adminRole,
  canonicalEntitlement,
  detail,
  onActivated,
  selectedTenant,
}: ManualActivationPanelProps) {
  const [form, setForm] = useState<ManualActivationFormState>(() => ({
    ...emptyForm,
    tenantId: selectedTenant?.id ?? "",
  }));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ManualSubscriptionActivationResult | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [activationMode, setActivationMode] = useState<"regression" | "selected">(
    "selected",
  );
  const canUsePanel = adminRole === "owner" || adminRole === "admin";
  const currentAssignmentExists = hasCurrentCanonicalAssignment(canonicalEntitlement);
  const selectedTenantId = selectedTenant?.id ?? "";
  const formTenantId = form.tenantId.trim();
  const isKnownRegressionTenant = formTenantId === regressionTenantId;
  const isRegressionMode =
    activationMode === "regression" && isKnownRegressionTenant;
  const isSelectedTenantMode =
    Boolean(formTenantId) && Boolean(selectedTenantId) && formTenantId === selectedTenantId;
  const isTenantSummaryMismatch =
    Boolean(formTenantId) && !isSelectedTenantMode && !isRegressionMode;
  const activationTargetSummary = getActivationTargetSummary({
    activationMode,
    detail,
    form,
    selectedTenant,
  });
  const errors = useMemo(
    () =>
      validationErrors(
        form,
        currentAssignmentExists,
        isTenantSummaryMismatch,
      ),
    [currentAssignmentExists, form, isTenantSummaryMismatch],
  );
  const canSubmit = canUsePanel && errors.length === 0 && !submitting;

  if (!canUsePanel) {
    return null;
  }

  const setField = <Key extends keyof ManualActivationFormState>(
    key: Key,
    value: ManualActivationFormState[Key],
  ) => {
    setResult(null);
    setError(null);
    if (key === "tenantId" && value !== regressionTenantId) {
      setActivationMode("selected");
    }
    setForm((current) => ({ ...current, [key]: value }));
  };

  const prefillRegressionTest = () => {
    const now = new Date();
    const safeStart = subtractMinutes(now, 5);
    const safeVerifiedAt = subtractMinutes(now, 5);
    const end = addOneMonth(safeStart);

    setResult(null);
    setError(null);
    setActivationMode("regression");
    setForm((current) => ({
      ...current,
      amountMinor: String(getPlanAmountMinor("starter", "monthly") ?? ""),
      billingCycle: "monthly",
      confirmationPhrase: "",
      currency: "INR",
      customerEmail: regressionCustomerEmail,
      founderApproval: "internal-regression-test-approved-by-founder",
      gracePeriodEndsAt: "",
      idempotencyKey: regressionIdempotencyKey,
      operatorNote: "controlled regression test activation only",
      paymentMethod: "manual_test",
      paymentReference: regressionPaymentReference,
      paymentVerifiedAt: toDateTimeLocal(safeVerifiedAt),
      planCode: "starter",
      replaceCurrent: true,
      subscriptionEnd: toDateTimeLocal(end),
      subscriptionStart: toDateTimeLocal(safeStart),
      supportTier: "founder",
      tenantId: regressionTenantId,
      verified: false,
    }));
  };

  const syncSelectedTenant = () => {
    if (!selectedTenant?.id) return;
    setResult(null);
    setError(null);
    setActivationMode("selected");
    setForm((current) => ({
      ...current,
      idempotencyKey:
        current.idempotencyKey === regressionIdempotencyKey
          ? ""
          : current.idempotencyKey,
      paymentReference:
        current.paymentReference === regressionPaymentReference
          ? ""
          : current.paymentReference,
      tenantId: selectedTenant.id,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResult(null);
    setError(null);

    if (!canSubmit) {
      setError(errors[0] ?? "Manual activation is not ready to submit.");
      return;
    }

    setSubmitting(true);
    try {
      const activationResult = await activateTenantSubscriptionManual(buildInput(form));
      setResult(activationResult);
      await onActivated?.();
    } catch (submitError) {
      setError(normalizePlatformError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-[#F59E0B]/35 bg-[#FFFBEB] p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.06em] text-[#92400E]">
            Founder Manual Activation
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            Manual SaaS subscription activation
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[#5D7185]">
            This activates a tenant SaaS subscription manually after
            founder-verified payment. This does not collect money, call Razorpay,
            create a payment link, or enable checkout. Premium is blocked until
            legacy plan mapping is resolved.
          </p>
        </div>
        <Badge tone="warning">Owner/admin only</Badge>
      </div>

      <FeedbackAlert className="mt-4" tone="warning">
        Manual SaaS activation - platform owner/admin only. Controlled
        activation is parked until final founder approval. Use only for
        founder-verified manual SaaS activation.
      </FeedbackAlert>

      {isTenantSummaryMismatch ? (
        <FeedbackAlert className="mt-4" tone="error">
          Activation target mismatch: the form tenant ID does not match the
          displayed selected tenant. Submission is blocked to prevent activating
          the wrong tenant.
        </FeedbackAlert>
      ) : null}

      {isRegressionMode ? (
        <FeedbackAlert className="mt-4" tone="info">
          Regression controlled test mode: activation target is CoachFort
          Regression Coaching. Prefill does not submit and still requires manual
          confirmation.
        </FeedbackAlert>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <SummaryItem label="Mode" value={activationTargetSummary.mode} />
        <SummaryItem label="Tenant" value={activationTargetSummary.tenantName} />
        <SummaryItem label="Slug" value={activationTargetSummary.slug} />
        <SummaryItem label="Tenant id" value={activationTargetSummary.tenantId} />
        <SummaryItem
          label="Customer email"
          value={activationTargetSummary.customerEmail}
        />
        <SummaryItem
          label="Legacy status"
          value={
            isSelectedTenantMode
              ? formatLabel(detail?.tenant.subscription_status)
              : "Not verified"
          }
        />
        <SummaryItem
          label="Platform subscription"
          value={activationTargetSummary.platformSubscription}
        />
        <SummaryItem
          label="Canonical assignment"
          value={
            isSelectedTenantMode
              ? [
                  canonicalEntitlement?.assignment?.plan_code ?? "not set",
                  canonicalEntitlement?.assignment?.status ?? "not set",
                  canonicalEntitlement?.assignment?.payment_status ?? "not set",
                ].join(" / ")
              : activationTargetSummary.canonicalAssignment
          }
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={syncSelectedTenant} type="button" variant="secondary">
          Use selected tenant id
        </Button>
        <Button onClick={prefillRegressionTest} type="button" variant="outline">
          Prefill regression test activation
        </Button>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <InputField
            label="Tenant id"
            onChange={(value) => setField("tenantId", value)}
            value={form.tenantId}
          />
          <InputField
            label="Customer email"
            onChange={(value) => setField("customerEmail", value)}
            type="email"
            value={form.customerEmail}
          />
          <SelectField
            label="Plan code"
            onChange={(value) =>
              setField("planCode", value as ManualActivationFormState["planCode"])
            }
            value={form.planCode}
          >
            <option value="starter">Starter</option>
            <option value="growth">Growth</option>
          </SelectField>
          <SelectField
            label="Billing cycle"
            onChange={(value) =>
              setField(
                "billingCycle",
                value as ManualActivationFormState["billingCycle"],
              )
            }
            value={form.billingCycle}
          >
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </SelectField>
          <InputField
            label="Amount minor"
            onChange={(value) => setField("amountMinor", value)}
            type="number"
            value={form.amountMinor}
          />
          <SelectField
            label="Currency"
            onChange={(value) =>
              setField("currency", value as ManualActivationFormState["currency"])
            }
            value={form.currency}
          >
            <option value="INR">INR</option>
          </SelectField>
          <InputField
            label="Subscription start"
            onChange={(value) => setField("subscriptionStart", value)}
            type="datetime-local"
            value={form.subscriptionStart}
          />
          <InputField
            label="Subscription end"
            onChange={(value) => setField("subscriptionEnd", value)}
            type="datetime-local"
            value={form.subscriptionEnd}
          />
          <div>
            <InputField
              label="Payment verified at"
              onChange={(value) => setField("paymentVerifiedAt", value)}
              type="datetime-local"
              value={form.paymentVerifiedAt}
            />
            <p className="mt-2 text-xs font-normal text-[#5D7185]">
              Payment verified time must be current or in the past. Use a time a
              few minutes earlier if needed.
            </p>
          </div>
          <InputField
            label="Payment method"
            onChange={(value) => setField("paymentMethod", value)}
            value={form.paymentMethod}
          />
          <InputField
            label="Payment reference"
            onChange={(value) => setField("paymentReference", value)}
            value={form.paymentReference}
          />
          <InputField
            label="Idempotency key"
            onChange={(value) => setField("idempotencyKey", value)}
            value={form.idempotencyKey}
          />
          <InputField
            label="Founder approval"
            onChange={(value) => setField("founderApproval", value)}
            value={form.founderApproval}
          />
          <InputField
            label="Support tier"
            onChange={(value) => setField("supportTier", value)}
            value={form.supportTier}
          />
          <InputField
            label="Grace period ends at"
            onChange={(value) => setField("gracePeriodEndsAt", value)}
            type="datetime-local"
            value={form.gracePeriodEndsAt}
          />
        </div>

        <TextAreaField
          label="Operator note"
          onChange={(value) => setField("operatorNote", value)}
          value={form.operatorNote}
        />

        <div className="grid gap-3 lg:grid-cols-2">
          <label className="flex gap-3 rounded-2xl border border-[#D8E8F0] bg-white p-4 text-sm text-[#0B1F33]">
            <input
              checked={form.replaceCurrent}
              className="mt-1 h-4 w-4"
              onChange={(event) => setField("replaceCurrent", event.target.checked)}
              type="checkbox"
            />
            <span>
              Replace current assignment if one exists. Required for the regression
              controlled test because a current trial assignment already exists.
            </span>
          </label>
          <label className="flex gap-3 rounded-2xl border border-[#D8E8F0] bg-white p-4 text-sm text-[#0B1F33]">
            <input
              checked={form.verified}
              className="mt-1 h-4 w-4"
              onChange={(event) => setField("verified", event.target.checked)}
              type="checkbox"
            />
            <span>I confirm this is founder-approved and payment verified.</span>
          </label>
        </div>

        <InputField
          label={`Confirmation phrase: ${confirmationPhrase}`}
          onChange={(value) => setField("confirmationPhrase", value)}
          value={form.confirmationPhrase}
        />

        {errors.length > 0 ? (
          <div className="rounded-2xl border border-[#FCD34D] bg-white p-4 text-sm text-[#92400E]">
            <p className="font-semibold">Submit is blocked until:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {errors.slice(0, 6).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? <FeedbackAlert>{error}</FeedbackAlert> : null}
        {result ? (
          <div className="rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] p-4">
            <p className="text-sm font-semibold text-[#047857]">
              Manual activation RPC returned success.
            </p>
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs text-[#0B1F33]">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!canSubmit}
            isLoading={submitting}
            loadingText="Submitting activation"
            type="submit"
            variant="destructive"
          >
            Submit manual activation
          </Button>
          <p className="max-w-2xl text-sm text-[#5D7185]">
            This button calls only activate_tenant_subscription_manual through
            the authenticated browser Supabase session after all safety checks
            pass.
          </p>
        </div>
      </form>
    </Card>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#D8E8F0] bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#5D7185]">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-[#0B1F33]">
        {value}
      </p>
    </div>
  );
}

function InputField({
  label,
  onChange,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold text-[#0B1F33]">
      {label}
      <input
        className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm font-normal outline-none focus:border-[#145DA0]"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function SelectField({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold text-[#0B1F33]">
      {label}
      <select
        className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm font-normal outline-none focus:border-[#145DA0]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function TextAreaField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold text-[#0B1F33]">
      {label}
      <textarea
        className="mt-2 min-h-24 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 py-3 text-sm font-normal outline-none focus:border-[#145DA0]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}
