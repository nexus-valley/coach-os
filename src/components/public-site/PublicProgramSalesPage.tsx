"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { Badge } from "@/src/components/ui/Badge";
import {
  getPublicProgramSalesPage,
  submitPublicSiteLead,
  type PublicProgramSalesPagePayload,
} from "@/src/lib/publicSite";
import { getSafeTenantBrandColor } from "@/src/lib/tenantSettings";

type PublicProgramSalesPageProps = {
  courseSlug: string;
  tenantSlug: string;
};

type LeadFormState = {
  email: string;
  message: string;
  name: string;
  phone: string;
};

const emptyLeadForm: LeadFormState = {
  email: "",
  message: "",
  name: "",
  phone: "",
};

function getDisplayName(page: PublicProgramSalesPagePayload) {
  return (
    page.tenant.workspace_display_name?.trim() ||
    page.tenant.brand_name?.trim() ||
    page.tenant.name?.trim() ||
    "Coach"
  );
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function formatPrice(page: PublicProgramSalesPagePayload) {
  if (page.program.pricing_type === "free") {
    return "Free";
  }

  return new Intl.NumberFormat("en-IN", {
    currency: page.program.sales_currency || "INR",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(page.program.price_amount ?? 0);
}

function getPaymentModeLabel(page: PublicProgramSalesPagePayload) {
  return page.program.sales_payment_mode === "external"
    ? "External payment link"
    : "Manual payment";
}

export function PublicProgramSalesPage({
  courseSlug,
  tenantSlug,
}: PublicProgramSalesPageProps) {
  const [error, setError] = useState("");
  const [form, setForm] = useState<LeadFormState>(emptyLeadForm);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PublicProgramSalesPagePayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPage() {
      setLoading(true);
      setError("");

      try {
        const salesPage = await getPublicProgramSalesPage(
          tenantSlug,
          courseSlug,
        );

        if (active) {
          setPage(salesPage);
        }
      } catch (caught) {
        if (active) {
          setError(getErrorMessage(caught, "Unable to load this program."));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadPage();

    return () => {
      active = false;
    };
  }, [courseSlug, tenantSlug]);

  const brandColor = getSafeTenantBrandColor(page?.tenant.brand_color);
  const accentColor = getSafeTenantBrandColor(
    page?.tenant.accent_color || page?.tenant.brand_color,
  );

  const nextSteps = useMemo(
    () => [
      "Request enrollment with your contact details.",
      "The coach reviews your request and contacts you.",
      "Payment and access details are confirmed outside instant checkout.",
      "Student access is activated later by the coach or team.",
    ],
    [],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!page) {
      return;
    }

    setError("");
    setSuccess("");
    setSubmitting(true);

    try {
      if (!form.email.trim() && !form.phone.trim()) {
        throw new Error("Email or phone is required.");
      }

      await submitPublicSiteLead({
        email: form.email,
        interestedCourseId: page.registration.interested_course_id,
        message: form.message,
        metadata: {
          course_slug: courseSlug,
          page_path: `/site/${tenantSlug}/programs/${courseSlug}`,
          source: "program_sales_page",
        },
        name: form.name,
        phone: form.phone,
        slug: tenantSlug,
      });

      setForm(emptyLeadForm);
      setSuccess(
        "Request received. The coach will contact you with payment and access details.",
      );
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to send your request."));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F6FBFE] px-5 py-10 text-[#0B1F33]">
        <div className="mx-auto max-w-6xl animate-pulse rounded-3xl border border-[#D8E8F0] bg-white p-8 shadow-xl">
          <div className="h-10 w-56 rounded-full bg-[#D8E8F0]" />
          <div className="mt-8 h-24 max-w-3xl rounded-3xl bg-[#D8E8F0]" />
          <div className="mt-6 h-6 max-w-2xl rounded-full bg-[#D8E8F0]" />
        </div>
      </main>
    );
  }

  if (!page) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F6FBFE] px-5 text-[#0B1F33]">
        <div className="max-w-xl rounded-3xl border border-[#D8E8F0] bg-white p-8 text-center shadow-xl">
          <CoachFortBrandAsset className="mx-auto h-14 w-14" variant="appIcon" />
          <h1 className="mt-6 text-2xl font-semibold">Program unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-[#425B76]">
            {error ||
              "This program is not published for public enrollment requests yet."}
          </p>
          <Link
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full border border-[#D8E8F0] bg-white px-5 text-sm font-semibold text-[#0B2A3D] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#F3FAFD]"
            href={`/site/${tenantSlug}`}
          >
            Back to coach page
          </Link>
        </div>
      </main>
    );
  }

  const displayName = getDisplayName(page);
  const heroSummary =
    page.program.sales_summary?.trim() ||
    page.program.description?.trim() ||
    "Request enrollment and the coach will guide you through payment and access details.";

  return (
    <main
      className="min-h-screen bg-[#F6FBFE] text-[#0B1F33]"
      style={
        {
          "--site-accent": accentColor,
          "--site-brand": brandColor,
        } as React.CSSProperties
      }
    >
      <header className="border-b border-[#D8E8F0] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-6 lg:px-8">
          <Link
            className="flex min-w-0 items-center gap-3"
            href={`/site/${tenantSlug}`}
          >
            {page.tenant.logo_url || page.tenant.icon_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${displayName} logo`}
                className="h-12 w-12 rounded-2xl object-cover"
                src={page.tenant.logo_url || page.tenant.icon_url || ""}
              />
            ) : (
              <CoachFortBrandAsset className="h-12 w-12" variant="appIcon" />
            )}
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{displayName}</p>
              <p className="truncate text-xs font-medium text-[#425B76]">
                {page.tenant.brand_tagline || "Private coach program"}
              </p>
            </div>
          </Link>
          <a
            className="hidden h-11 items-center justify-center rounded-full px-5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 sm:inline-flex"
            href="#request-enrollment"
            style={{ backgroundColor: brandColor }}
          >
            Request enrollment
          </a>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-14">
        <div className="flex flex-col justify-center">
          <Badge tone="owner">Program by {displayName}</Badge>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-normal sm:text-6xl">
            {page.program.title}
          </h1>
          {page.program.sales_headline ? (
            <p className="mt-5 max-w-2xl text-xl font-semibold leading-8 text-[#0B2A3D]">
              {page.program.sales_headline}
            </p>
          ) : null}
          <p className="mt-5 max-w-2xl text-base leading-8 text-[#334155] sm:text-lg">
            {heroSummary}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              className="inline-flex h-12 items-center justify-center rounded-full px-6 text-base font-semibold text-white shadow-lg transition hover:-translate-y-0.5"
              href="#request-enrollment"
              style={{ backgroundColor: brandColor }}
            >
              Request enrollment
            </a>
            <Link
              className="inline-flex h-12 items-center justify-center rounded-full border border-[#D8E8F0] bg-white px-6 text-base font-semibold text-[#0B2A3D] shadow-sm transition hover:-translate-y-0.5"
              href={`/site/${tenantSlug}`}
            >
              View coach page
            </Link>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-[#D8E8F0] bg-white shadow-2xl shadow-[#0B2A3D]/10">
          {page.program.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`${page.program.title} preview`}
              className="h-72 w-full object-cover"
              src={page.program.thumbnail_url}
            />
          ) : (
            <div
              className="flex h-72 items-end p-6 text-white"
              style={{
                background: `linear-gradient(135deg, ${brandColor}, ${accentColor})`,
              }}
            >
              <div>
                <p className="text-sm font-semibold text-white/75">
                  Coach-led program
                </p>
                <h2 className="mt-3 text-3xl font-semibold">
                  {page.program.title}
                </h2>
              </div>
            </div>
          )}
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                Price
              </p>
              <p className="mt-2 text-xl font-semibold">{formatPrice(page)}</p>
            </div>
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                Access
              </p>
              <p className="mt-2 text-sm font-semibold leading-6">
                {page.program.access_duration_label || "Confirmed by coach"}
              </p>
            </div>
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                Payment
              </p>
              <p className="mt-2 text-sm font-semibold leading-6">
                {getPaymentModeLabel(page)}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 pb-10 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
        <div className="rounded-3xl border border-[#D8E8F0] bg-white p-6 shadow-xl shadow-[#0B2A3D]/5">
          <Badge tone="premium">Price and access</Badge>
          <h2 className="mt-4 text-3xl font-semibold">{formatPrice(page)}</h2>
          <p className="mt-4 text-sm leading-7 text-[#334155]">
            Enrollment is confirmed by the coach after payment and access
            review. Submitting this request does not create a student account,
            collect payment, generate an invoice, or activate access.
          </p>
          <div className="mt-5 rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4 text-sm leading-7 text-[#334155]">
            {page.program.access_duration_label ? (
              <p>
                <span className="font-semibold text-[#0B1F33]">Access:</span>{" "}
                {page.program.access_duration_label}
              </p>
            ) : null}
            <p>
              <span className="font-semibold text-[#0B1F33]">Payment mode:</span>{" "}
              {getPaymentModeLabel(page)}
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-[#D8E8F0] bg-white p-6 shadow-xl shadow-[#0B2A3D]/5">
          <Badge tone="owner">What happens next</Badge>
          <div className="mt-5 grid gap-3">
            {nextSteps.map((step, index) => (
              <div
                className="flex gap-4 rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                key={step}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: brandColor }}
                >
                  {index + 1}
                </span>
                <p className="text-sm font-medium leading-7 text-[#0B2A3D]">
                  {step}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {page.program.payment_instructions ||
      (page.program.sales_payment_mode === "external" &&
        page.program.external_payment_url) ? (
        <section className="mx-auto max-w-7xl px-5 pb-10 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-[#D8E8F0] bg-white p-6 shadow-xl shadow-[#0B2A3D]/5">
            <Badge tone="admin">Payment guidance from coach</Badge>
            {page.program.payment_instructions ? (
              <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-[#334155]">
                {page.program.payment_instructions}
              </p>
            ) : null}
            {page.program.sales_payment_mode === "external" &&
            page.program.external_payment_url ? (
              <div className="mt-5 rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
                <p className="text-sm leading-7 text-[#334155]">
                  This external link opens outside CoachFort and does not
                  automatically activate access.
                </p>
                <a
                  className="mt-4 inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5"
                  href={page.program.external_payment_url}
                  rel="noreferrer"
                  style={{ backgroundColor: brandColor }}
                  target="_blank"
                >
                  Open external payment link
                </a>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section
        className="mx-auto grid max-w-7xl gap-6 px-5 pb-12 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8"
        id="request-enrollment"
      >
        <div>
          <Badge tone="success">Request enrollment</Badge>
          <h2 className="mt-4 text-3xl font-semibold">
            Ask to join this program
          </h2>
          <p className="mt-4 text-sm leading-7 text-[#334155]">
            Share your details and the coach will contact you with payment and
            access details. Online checkout is not enabled yet.
          </p>
          {page.tenant.support_email || page.tenant.support_phone ? (
            <div className="mt-5 rounded-3xl border border-[#D8E8F0] bg-white p-5 text-sm leading-7 text-[#334155] shadow-lg shadow-[#0B2A3D]/5">
              {page.tenant.support_email ? (
                <p>Email: {page.tenant.support_email}</p>
              ) : null}
              {page.tenant.support_phone ? (
                <p>Phone: {page.tenant.support_phone}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        {page.registration.enabled ? (
          <form
            className="rounded-3xl border border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10"
            onSubmit={handleSubmit}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-semibold text-[#0B1F33]">
                Full name
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] px-4 text-sm outline-none focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  maxLength={120}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  required
                  value={form.name}
                />
              </label>
              <label className="block text-sm font-semibold text-[#0B1F33]">
                Email
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] px-4 text-sm outline-none focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  maxLength={160}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  type="email"
                  value={form.email}
                />
              </label>
              <label className="block text-sm font-semibold text-[#0B1F33] md:col-span-2">
                Phone
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] px-4 text-sm outline-none focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  maxLength={32}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                  value={form.phone}
                />
              </label>
            </div>
            <label className="mt-4 block text-sm font-semibold text-[#0B1F33]">
              Message or goal
              <textarea
                className="mt-2 min-h-32 w-full resize-none rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm leading-6 outline-none focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                maxLength={2000}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    message: event.target.value,
                  }))
                }
                placeholder="Share what you want to achieve from this program."
                value={form.message}
              />
            </label>
            {error ? (
              <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}
            {success ? (
              <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {success}
              </p>
            ) : null}
            <button
              className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-full px-6 text-base font-semibold text-white shadow-lg transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:bg-[#CBD5E1] disabled:text-[#64748B]"
              disabled={submitting}
              style={{ backgroundColor: submitting ? undefined : brandColor }}
              type="submit"
            >
              {submitting ? "Sending request..." : "Request enrollment"}
            </button>
          </form>
        ) : (
          <div className="rounded-3xl border border-[#D8E8F0] bg-white p-6 text-sm leading-7 text-[#334155] shadow-xl shadow-[#0B2A3D]/5">
            Enrollment requests are not enabled on this coach page right now.
          </div>
        )}
      </section>

      <footer className="border-t border-[#D8E8F0] bg-white px-5 py-6 text-sm text-[#425B76] sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <p>
            {page.site.public_footer_note ||
              `${displayName} program enrollment request page.`}
          </p>
          {page.tenant.show_powered_by ? (
            <p className="font-semibold">Powered by CoachFort</p>
          ) : null}
        </div>
      </footer>
    </main>
  );
}
