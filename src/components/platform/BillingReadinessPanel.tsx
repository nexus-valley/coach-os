"use client";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  platformBillingCurrencies,
  platformBillingFieldLabels,
  type PlatformBillingCurrency,
  type PlatformBillingFieldKey,
  type PlatformBillingReadiness,
  type PlatformBillingReadinessSection,
} from "@/src/lib/platformBillingReadiness";

type BillingReadinessPanelProps = {
  currency: PlatformBillingCurrency;
  error: string | null;
  loading: boolean;
  readiness: PlatformBillingReadiness | null;
  selectedBusinessName?: string | null;
  selectedTenantId: string | null;
  onCurrencyChange: (currency: PlatformBillingCurrency) => void;
  onRefresh: () => void;
};

function ReadinessBadge({ ready }: { ready: boolean }) {
  return <Badge tone={ready ? "success" : "warning"}>{ready ? "Ready" : "Needs attention"}</Badge>;
}

function FieldList({
  fields,
  label,
}: {
  fields: PlatformBillingFieldKey[];
  label: string;
}) {
  if (fields.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#5D7185]">
        {label}
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {fields.map((field) => (
          <li
            className="rounded-md border border-[#D8E8F0] bg-white px-2.5 py-1 text-xs font-medium text-[#425B76]"
            key={field}
          >
            {platformBillingFieldLabels[field]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function IdentityReadiness({
  description,
  section,
  title,
}: {
  description: string;
  section: PlatformBillingReadinessSection;
  title: string;
}) {
  const issueCount = section.missingFields.length + section.invalidFields.length;

  return (
    <section className="border-t border-[#D8E8F0] pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#0B1F33]">{title}</h3>
          <p className="mt-1 max-w-xl text-sm leading-6 text-[#5D7185]">
            {description}
          </p>
        </div>
        <ReadinessBadge ready={section.ready} />
      </div>
      {!section.ready && issueCount > 0 ? (
        <p className="mt-3 text-sm text-[#425B76]">
          {issueCount} {issueCount === 1 ? "field needs" : "fields need"} attention.
        </p>
      ) : null}
      <FieldList fields={section.missingFields} label="Required information" />
      <FieldList fields={section.invalidFields} label="Information to review" />
    </section>
  );
}

function ProviderStatus({
  label,
  ready,
  value,
}: {
  label: string;
  ready: boolean;
  value: string;
}) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-3 border-t border-[#D8E8F0] py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#0B1F33]">{label}</p>
        <p className="mt-1 text-sm text-[#5D7185]">{value}</p>
      </div>
      <ReadinessBadge ready={ready} />
    </div>
  );
}

export function BillingReadinessPanel({
  currency,
  error,
  loading,
  readiness,
  selectedBusinessName,
  selectedTenantId,
  onCurrencyChange,
  onRefresh,
}: BillingReadinessPanelProps) {
  const overallReady = Boolean(readiness?.ready && readiness.provider.configured);

  return (
    <Card className="p-5" data-testid="platform-billing-readiness">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.06em] text-[#5D7185]">
            Billing operations
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">Billing readiness</h2>
            {readiness ? <ReadinessBadge ready={overallReady} /> : null}
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5D7185]">
            Review the billing information and payment setup needed to support
            CoachFort subscription billing for {selectedBusinessName ?? "the selected coaching business"}.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="grid gap-1 text-xs font-semibold text-[#425B76]">
            Transaction currency
            <select
              className="h-10 min-w-28 rounded-lg border border-[#BFD7E6] bg-white px-3 text-sm text-[#0B1F33] outline-none focus:border-[#145DA0] focus:ring-2 focus:ring-[#2ECBEA]/25"
              disabled={!selectedTenantId || loading}
              onChange={(event) =>
                onCurrencyChange(event.target.value as PlatformBillingCurrency)
              }
              value={currency}
            >
              {platformBillingCurrencies.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={!selectedTenantId}
            isLoading={loading}
            loadingText="Checking"
            onClick={onRefresh}
            size="sm"
            type="button"
            variant="secondary"
          >
            Refresh readiness
          </Button>
        </div>
      </div>

      <div aria-live="polite" className="mt-5">
        {!selectedTenantId ? (
          <p className="text-sm text-[#5D7185]">
            Select a coaching business to check billing readiness.
          </p>
        ) : loading && !readiness ? (
          <p className="text-sm text-[#5D7185]">Checking billing readiness...</p>
        ) : error ? (
          <div className="rounded-md border border-[#FED7AA] bg-[#FFF7ED] p-3">
            <p className="text-sm font-semibold text-[#9A3412]">Unavailable</p>
            <p className="mt-1 text-sm text-[#9A3412]">{error}</p>
          </div>
        ) : readiness ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
            <div className="space-y-4">
              <IdentityReadiness
                description="CoachFort's legal and billing information used to issue subscription billing documents."
                section={readiness.issuer}
                title="CoachFort billing identity"
              />
              <IdentityReadiness
                description="The selected coaching business receiving CoachFort billing documents."
                section={readiness.customer}
                title="Customer billing identity"
              />
            </div>

            <section className="border-t border-[#D8E8F0] pt-4 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
              <ProviderStatus
                label="Currency"
                ready={readiness.currencyReady}
                value={readiness.expectedCurrency ?? "Unavailable"}
              />
              <ProviderStatus
                label="Payment provider"
                ready={readiness.provider.configured}
                value={
                  `${
                    readiness.provider.mode === "test"
                      ? "Test"
                      : readiness.provider.mode === "live"
                        ? "Live"
                        : "Unknown"
                  } mode${
                    readiness.provider.configured
                      ? " configured"
                      : "; setup needs attention"
                  }`
                }
              />
              <ProviderStatus
                label="Payment updates"
                ready={readiness.provider.webhookConfigured}
                value={readiness.provider.webhookConfigured ? "Configured" : "Needs attention"}
              />
              <ProviderStatus
                label="Private checkout"
                ready={readiness.provider.checkoutEnabled}
                value={readiness.provider.checkoutEnabled ? "Enabled" : "Disabled"}
              />
              <ProviderStatus
                label="Public checkout"
                ready={!readiness.provider.publicCheckoutEnabled}
                value={readiness.provider.publicCheckoutEnabled ? "Enabled" : "Disabled"}
              />
            </section>
          </div>
        ) : (
          <p className="text-sm text-[#5D7185]">Billing readiness is unavailable.</p>
        )}
      </div>
    </Card>
  );
}
