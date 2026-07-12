"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { FormField } from "@/src/components/ui/FormField";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { StatCard } from "@/src/components/ui/StatCard";
import {
  getBillingProfileMissingFieldLabels,
  getTenantBillingProfile,
  getTenantBillingProfileCompletion,
  upsertTenantBillingProfile,
  type TenantBillingProfile,
  type TenantBillingProfileCompletion,
  type TenantBillingProfileInput,
} from "@/src/lib/billingProfile";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type BillingProfileForm = {
  address_line1: string;
  address_line2: string;
  billing_email: string;
  billing_notes: string;
  billing_phone: string;
  city: string;
  country: string;
  invoice_contact_name: string;
  legal_name: string;
  postal_code: string;
  preferred_currency: "INR" | "USD";
  state: string;
  tax_id: string;
};

const emptyForm: BillingProfileForm = {
  address_line1: "",
  address_line2: "",
  billing_email: "",
  billing_notes: "",
  billing_phone: "",
  city: "",
  country: "",
  invoice_contact_name: "",
  legal_name: "",
  postal_code: "",
  preferred_currency: "INR",
  state: "",
  tax_id: "",
};

const textFieldLabels: Record<keyof BillingProfileForm, string> = {
  address_line1: "Address line 1",
  address_line2: "Address line 2",
  billing_email: "Billing email",
  billing_notes: "Billing notes",
  billing_phone: "Billing phone",
  city: "City",
  country: "Country",
  invoice_contact_name: "Invoice contact name",
  legal_name: "Legal name",
  postal_code: "Postal code",
  preferred_currency: "Preferred currency",
  state: "State",
  tax_id: "Tax ID / GSTIN",
};

const maxLengths: Partial<Record<keyof BillingProfileForm, number>> = {
  address_line1: 240,
  address_line2: 240,
  billing_email: 254,
  billing_notes: 2000,
  billing_phone: 40,
  city: 120,
  country: 120,
  invoice_contact_name: 180,
  legal_name: 180,
  postal_code: 40,
  state: 120,
  tax_id: 40,
};

function canManageBillingProfile(role: MemberRole | null) {
  return role === "owner" || role === "admin";
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function isPlainText(value: string) {
  return !/[<>]/.test(value);
}

function isEmail(value: string) {
  return !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function valueOrEmpty(value: string | null | undefined) {
  return value ?? "";
}

function profileToForm(profile: TenantBillingProfile | null): BillingProfileForm {
  if (!profile) {
    return emptyForm;
  }

  return {
    address_line1: valueOrEmpty(profile.address_line1),
    address_line2: valueOrEmpty(profile.address_line2),
    billing_email: valueOrEmpty(profile.billing_email),
    billing_notes: valueOrEmpty(profile.billing_notes),
    billing_phone: valueOrEmpty(profile.billing_phone),
    city: valueOrEmpty(profile.city),
    country: valueOrEmpty(profile.country),
    invoice_contact_name: valueOrEmpty(profile.invoice_contact_name),
    legal_name: valueOrEmpty(profile.legal_name),
    postal_code: valueOrEmpty(profile.postal_code),
    preferred_currency: profile.preferred_currency,
    state: valueOrEmpty(profile.state),
    tax_id: valueOrEmpty(profile.tax_id),
  };
}

function toInput(form: BillingProfileForm): TenantBillingProfileInput {
  return {
    address_line1: form.address_line1,
    address_line2: form.address_line2,
    billing_email: form.billing_email,
    billing_notes: form.billing_notes,
    billing_phone: form.billing_phone,
    city: form.city,
    country: form.country,
    invoice_contact_name: form.invoice_contact_name,
    legal_name: form.legal_name,
    postal_code: form.postal_code,
    preferred_currency: form.preferred_currency,
    state: form.state,
    tax_id: form.tax_id,
  };
}

function validateForm(form: BillingProfileForm) {
  for (const [key, value] of Object.entries(form) as Array<
    [keyof BillingProfileForm, string]
  >) {
    if (!isPlainText(value)) {
      return `${textFieldLabels[key]} must use plain text without < or >.`;
    }

    const maxLength = maxLengths[key];

    if (maxLength && value.length > maxLength) {
      return `${textFieldLabels[key]} is too long.`;
    }
  }

  if (!isEmail(form.billing_email)) {
    return "Billing email must be a valid email address.";
  }

  return "";
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not saved yet";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function BillingProfilePageClient() {
  const initialLoadStarted = useRef(false);
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [completion, setCompletion] =
    useState<TenantBillingProfileCompletion | null>(null);
  const [form, setForm] = useState<BillingProfileForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<TenantBillingProfile | null>(null);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const canManage = canManageBillingProfile(role);
  const missingLabels = useMemo(
    () => getBillingProfileMissingFieldLabels(completion?.missing_fields ?? []),
    [completion?.missing_fields],
  );

  const loadBillingProfile = useCallback(async () => {
    setActionError("");
    setLoading(true);

    try {
      const currentTenant = await getCurrentTenant();

      if (!currentTenant) {
        router.replace("/onboarding");
        return;
      }

      const supabase = getSupabaseClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        router.replace("/login");
        return;
      }

      const currentRole = await getCurrentMemberRole(currentTenant.id, user.id);

      setTenant(currentTenant);
      setRole(currentRole);

      if (!canManageBillingProfile(currentRole)) {
        setProfile(null);
        setCompletion(null);
        return;
      }

      const [nextProfile, nextCompletion] = await Promise.all([
        getTenantBillingProfile(currentTenant.id),
        getTenantBillingProfileCompletion(currentTenant.id),
      ]);

      setProfile(nextProfile);
      setCompletion(nextCompletion);
      setForm(profileToForm(nextProfile));
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to load billing profile."),
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (initialLoadStarted.current) {
      return;
    }

    initialLoadStarted.current = true;
    void loadBillingProfile();
  }, [loadBillingProfile]);

  function updateField<Key extends keyof BillingProfileForm>(
    key: Key,
    value: BillingProfileForm[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setSuccess("");
    setActionError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setActionError("Workspace context is not available.");
      return;
    }

    const validationError = validateForm(form);

    if (validationError) {
      setActionError(validationError);
      return;
    }

    setSaving(true);
    setActionError("");
    setSuccess("");

    try {
      const nextProfile = await upsertTenantBillingProfile(
        tenant.id,
        toInput(form),
      );
      const nextCompletion = await getTenantBillingProfileCompletion(tenant.id);

      setProfile(nextProfile);
      setCompletion(nextCompletion);
      setForm(profileToForm(nextProfile));
      setSuccess(
        "Billing profile saved. This did not start checkout or change your plan.",
      );
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to save billing profile."),
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6">
        <Skeleton className="h-32" />
        <div className="grid gap-5 lg:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-7xl">
        <AccessDeniedCard description="Billing profile setup is available to workspace owners and admins only." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        actions={
          <Button
            isLoading={loading}
            onClick={() => void loadBillingProfile()}
            type="button"
            variant="secondary"
          >
            Refresh
          </Button>
        }
        description="Prepare the legal, tax, and invoice contact details CoachFort will use for receipt, invoice, renewal, and payment support readiness. Saving this profile does not start checkout or change your plan."
        eyebrow="Billing readiness"
        metadata={
          <>
            <Badge tone={completion?.is_complete ? "success" : "warning"}>
              {completion?.is_complete ? "Complete" : "Incomplete"}
            </Badge>
            <Badge tone="outline">Owner/admin only</Badge>
            <Badge tone="outline">No checkout</Badge>
          </>
        }
        title="Billing profile"
      />

      {actionError ? (
        <FeedbackAlert onRetry={() => void loadBillingProfile()} tone="error">
          {actionError}
        </FeedbackAlert>
      ) : null}

      {success ? (
        <FeedbackAlert tone="success">{success}</FeedbackAlert>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-3">
        <StatCard
          description={
            completion?.is_complete
              ? "Required onboarding fields are ready."
              : "Complete the missing fields before payment operations go live."
          }
          label="Profile readiness"
          status={
            <Badge tone={completion?.is_complete ? "success" : "warning"}>
              {completion?.is_complete ? "Ready" : "Needs details"}
            </Badge>
          }
          value={`${completion?.completion_score ?? 0}%`}
        />
        <StatCard
          description="Used later for invoice and receipt preparation."
          label="Preferred currency"
          status={<Badge tone="outline">Readiness only</Badge>}
          value={form.preferred_currency}
        />
        <StatCard
          description="Last profile save timestamp from the billing profile RPC."
          label="Last updated"
          value={formatDate(profile?.updated_at ?? null)}
        />
      </section>

      {!completion?.is_complete && missingLabels.length > 0 ? (
        <Card padding="md" variant="subtle">
          <SectionHeader
            description="These fields are advisory readiness checks only. Tax ID/GSTIN is optional because requirements vary by academy and jurisdiction."
            title="Missing readiness fields"
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {missingLabels.map((label) => (
              <Badge key={label} tone="warning">
                {label}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}

      <Card padding="lg" variant="elevated">
        <SectionHeader
          actions={
            <Button href="/app/subscription" type="button" variant="secondary">
              Back to subscription
            </Button>
          }
          description="Use plain text only. CoachFort stores this through owner/admin RPCs and keeps direct table access closed."
          title="Billing identity"
        />

        <form className="mt-6 grid gap-5" onSubmit={handleSubmit}>
          <div className="grid gap-5 md:grid-cols-2">
            <FormField
              description="Registered academy, institute, or business name."
              htmlFor="legal_name"
              label="Legal name"
              required
            >
              <input
                className="h-11 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
                id="legal_name"
                maxLength={180}
                onChange={(event) => updateField("legal_name", event.target.value)}
                value={form.legal_name}
              />
            </FormField>

            <FormField
              description="Primary email for invoices, receipts, and payment support."
              htmlFor="billing_email"
              label="Billing email"
              required
            >
              <input
                className="h-11 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
                id="billing_email"
                maxLength={254}
                onChange={(event) =>
                  updateField("billing_email", event.target.value)
                }
                type="email"
                value={form.billing_email}
              />
            </FormField>

            <FormField
              htmlFor="billing_phone"
              label="Billing phone"
            >
              <input
                className="h-11 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
                id="billing_phone"
                maxLength={40}
                onChange={(event) =>
                  updateField("billing_phone", event.target.value)
                }
                value={form.billing_phone}
              />
            </FormField>

            <FormField
              htmlFor="invoice_contact_name"
              label="Invoice contact name"
            >
              <input
                className="h-11 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
                id="invoice_contact_name"
                maxLength={180}
                onChange={(event) =>
                  updateField("invoice_contact_name", event.target.value)
                }
                value={form.invoice_contact_name}
              />
            </FormField>

            <FormField
              description="GSTIN or another tax identifier, if applicable."
              htmlFor="tax_id"
              label="Tax ID / GSTIN"
            >
              <input
                className="h-11 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
                id="tax_id"
                maxLength={40}
                onChange={(event) => updateField("tax_id", event.target.value)}
                value={form.tax_id}
              />
            </FormField>

            <FormField
              htmlFor="preferred_currency"
              label="Preferred currency"
              required
            >
              <select
                className="h-11 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
                id="preferred_currency"
                onChange={(event) =>
                  updateField(
                    "preferred_currency",
                    event.target.value === "USD" ? "USD" : "INR",
                  )
                }
                value={form.preferred_currency}
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
            </FormField>
          </div>

          <SectionHeader
            className="border-t border-[#D8E8F0] pt-6"
            description="Address fields help future invoice and receipt preparation. They do not affect current subscription access."
            title="Billing address"
          />

          <div className="grid gap-5 md:grid-cols-2">
            <FormField htmlFor="address_line1" label="Address line 1" required>
              <input
                className="h-11 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
                id="address_line1"
                maxLength={240}
                onChange={(event) =>
                  updateField("address_line1", event.target.value)
                }
                value={form.address_line1}
              />
            </FormField>

            <FormField htmlFor="address_line2" label="Address line 2">
              <input
                className="h-11 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
                id="address_line2"
                maxLength={240}
                onChange={(event) =>
                  updateField("address_line2", event.target.value)
                }
                value={form.address_line2}
              />
            </FormField>

            <FormField htmlFor="city" label="City" required>
              <input
                className="h-11 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
                id="city"
                maxLength={120}
                onChange={(event) => updateField("city", event.target.value)}
                value={form.city}
              />
            </FormField>

            <FormField htmlFor="state" label="State" required>
              <input
                className="h-11 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
                id="state"
                maxLength={120}
                onChange={(event) => updateField("state", event.target.value)}
                value={form.state}
              />
            </FormField>

            <FormField htmlFor="postal_code" label="Postal code" required>
              <input
                className="h-11 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
                id="postal_code"
                maxLength={40}
                onChange={(event) =>
                  updateField("postal_code", event.target.value)
                }
                value={form.postal_code}
              />
            </FormField>

            <FormField htmlFor="country" label="Country" required>
              <input
                className="h-11 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
                id="country"
                maxLength={120}
                onChange={(event) => updateField("country", event.target.value)}
                value={form.country}
              />
            </FormField>
          </div>

          <FormField
            description="Internal billing support notes only. Do not enter passwords, card data, UPI PINs, OTPs, or secrets."
            htmlFor="billing_notes"
            label="Billing notes"
          >
            <textarea
              className="min-h-28 w-full rounded-lg border border-[#BFD7E6] bg-white px-3 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#145DA0] focus:ring-4 focus:ring-[#2ECBEA]/15"
              id="billing_notes"
              maxLength={2000}
              onChange={(event) =>
                updateField("billing_notes", event.target.value)
              }
              value={form.billing_notes}
            />
          </FormField>

          <div className="flex flex-col gap-3 border-t border-[#D8E8F0] pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-[#5D7185]">
              Saving updates billing readiness only. It does not open checkout,
              create Razorpay orders, activate plans, or modify tenant finance
              invoices.
            </p>
            <Button isLoading={saving} loadingText="Saving..." type="submit">
              Save billing profile
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
