"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import {
  getPublicSite,
  submitPublicSiteLead,
  type PublicSitePayload,
} from "@/src/lib/publicSite";
import { getSafeTenantBrandColor } from "@/src/lib/tenantSettings";

type PublicSitePageProps = {
  tenantSlug: string;
};

type LeadFormState = {
  email: string;
  interestedCourseId: string;
  message: string;
  name: string;
  phone: string;
};

const emptyLeadForm: LeadFormState = {
  email: "",
  interestedCourseId: "",
  message: "",
  name: "",
  phone: "",
};

function getDisplayName(site: PublicSitePayload) {
  return (
    site.tenant.workspace_display_name?.trim() ||
    site.tenant.brand_name?.trim() ||
    site.tenant.name?.trim() ||
    "CoachFort Institute"
  );
}

function getHeroTitle(site: PublicSitePayload) {
  return (
    site.site.public_hero_title?.trim() ||
    site.site.public_page_title?.trim() ||
    `Learn with ${getDisplayName(site)}`
  );
}

function getHeroSubtitle(site: PublicSitePayload) {
  return (
    site.site.public_hero_subtitle?.trim() ||
    site.site.public_page_description?.trim() ||
    "Explore coaching programs, course previews, and contact the institute team."
  );
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

export function PublicSitePage({ tenantSlug }: PublicSitePageProps) {
  const [error, setError] = useState("");
  const [form, setForm] = useState<LeadFormState>(emptyLeadForm);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [site, setSite] = useState<PublicSitePayload | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadSite() {
      setLoading(true);
      setError("");

      try {
        const publicSite = await getPublicSite(tenantSlug);

        if (active) {
          setSite(publicSite);
        }
      } catch (caught) {
        if (active) {
          setError(getErrorMessage(caught, "Unable to load this site."));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadSite();

    return () => {
      active = false;
    };
  }, [tenantSlug]);

  const brandColor = getSafeTenantBrandColor(site?.tenant.brand_color);
  const accentColor = getSafeTenantBrandColor(
    site?.tenant.accent_color || site?.tenant.brand_color,
  );
  const highlights = useMemo(() => {
    if (!site) {
      return [];
    }

    return [
      {
        body: site.site.public_highlight_1_body,
        title: site.site.public_highlight_1_title,
      },
      {
        body: site.site.public_highlight_2_body,
        title: site.site.public_highlight_2_title,
      },
      {
        body: site.site.public_highlight_3_body,
        title: site.site.public_highlight_3_title,
      },
    ].filter((item) => item.title || item.body);
  }, [site]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!site) {
      return;
    }

    setError("");
    setMessage("");
    setSubmitting(true);

    try {
      if (!form.email.trim() && !form.phone.trim()) {
        throw new Error("Email or phone is required.");
      }

      await submitPublicSiteLead({
        email: form.email,
        interestedCourseId: form.interestedCourseId || null,
        message: form.message,
        name: form.name,
        phone: form.phone,
        slug: site.tenant.slug,
      });

      setForm(emptyLeadForm);
      setMessage("Thanks. The institute team has received your inquiry.");
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to submit inquiry."));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F3FAFD] px-5 py-10 text-[#0B1F33]">
        <div className="mx-auto max-w-6xl animate-pulse rounded-3xl border border-[#D8E8F0] bg-white p-10 shadow-xl">
          <div className="h-8 w-60 rounded-full bg-[#D8E8F0]" />
          <div className="mt-10 h-20 max-w-3xl rounded-3xl bg-[#D8E8F0]" />
          <div className="mt-6 h-6 max-w-2xl rounded-full bg-[#D8E8F0]" />
        </div>
      </main>
    );
  }

  if (error && !site) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F3FAFD] px-5 text-[#0B1F33]">
        <div className="max-w-xl rounded-3xl border border-[#D8E8F0] bg-white p-8 text-center shadow-xl">
          <CoachFortBrandAsset className="mx-auto h-14 w-14" variant="appIcon" />
          <h1 className="mt-6 text-2xl font-semibold">Site unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-[#425B76]">{error}</p>
        </div>
      </main>
    );
  }

  if (!site) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F3FAFD] px-5 text-[#0B1F33]">
        <div className="max-w-xl rounded-3xl border border-[#D8E8F0] bg-white p-8 text-center shadow-xl">
          <CoachFortBrandAsset className="mx-auto h-14 w-14" variant="appIcon" />
          <h1 className="mt-6 text-2xl font-semibold">Site not found</h1>
          <p className="mt-3 text-sm leading-6 text-[#425B76]">
            This institute website is not published yet.
          </p>
        </div>
      </main>
    );
  }

  const displayName = getDisplayName(site);
  const ctaLabel =
    site.site.public_hero_cta_label?.trim() ||
    site.site.contact_cta_text?.trim() ||
    "Send inquiry";

  return (
    <main
      className="min-h-screen bg-[#F3FAFD] text-[#0B1F33]"
      style={
        {
          "--site-accent": accentColor,
          "--site-brand": brandColor,
        } as React.CSSProperties
      }
    >
      <header className="border-b border-[#D8E8F0] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            {site.tenant.logo_url || site.tenant.icon_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${displayName} logo`}
                className="h-12 w-12 rounded-2xl object-cover"
                src={site.tenant.logo_url || site.tenant.icon_url || ""}
              />
            ) : (
              <CoachFortBrandAsset className="h-12 w-12" variant="appIcon" />
            )}
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{displayName}</p>
              <p className="truncate text-xs font-medium text-[#5D7185]">
                {site.tenant.brand_tagline || "Institute Website"}
              </p>
            </div>
          </div>
          {site.tenant.website_url ? (
            <Button href={site.tenant.website_url} size="sm" variant="secondary">
              Website
            </Button>
          ) : null}
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-14">
        <div className="flex flex-col justify-center">
          <Badge tone="owner">Published by {displayName}</Badge>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-normal sm:text-6xl">
            {getHeroTitle(site)}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#425B76]">
            {getHeroSubtitle(site)}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {site.site.public_show_contact_form ? (
              <a
                className="inline-flex h-12 items-center justify-center rounded-full px-6 text-base font-semibold text-white shadow-lg transition hover:-translate-y-0.5"
                href="#inquiry"
                style={{ backgroundColor: brandColor }}
              >
                {ctaLabel}
              </a>
            ) : null}
            {site.tenant.support_email ? (
              <a
                className="inline-flex h-12 items-center justify-center rounded-full border border-[#D8E8F0] bg-white px-6 text-base font-semibold text-[#0B2A3D] shadow-sm transition hover:-translate-y-0.5"
                href={`mailto:${site.tenant.support_email}`}
              >
                Email institute
              </a>
            ) : null}
          </div>
        </div>

        <div className="rounded-3xl border border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10">
          <div
            className="rounded-3xl p-6 text-white"
            style={{
              background: `linear-gradient(135deg, ${brandColor}, ${accentColor})`,
            }}
          >
            <p className="text-sm font-semibold text-white/75">
              Course-ready website
            </p>
            <h2 className="mt-4 text-3xl font-semibold">{displayName}</h2>
            <p className="mt-4 text-sm leading-6 text-white/80">
              Public course previews, inquiry capture, support details, and
              CoachFort-powered operations behind the scenes.
            </p>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              `${site.courses.length} courses`,
              site.site.public_show_contact_form ? "Inquiry form" : "Contact hidden",
              site.tenant.show_powered_by ? "Powered by CoachFort" : "Tenant brand",
            ].map((item) => (
              <div
                className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4 text-sm font-semibold text-[#0B2A3D]"
                key={item}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-10 sm:px-6 lg:px-8">
        <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <h2 className="text-3xl font-semibold tracking-normal">
              {site.site.public_about_title || `About ${displayName}`}
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#425B76]">
              {site.site.public_about_body ||
                "This institute uses CoachFort to manage courses, classes, assignments, payments, certificates, and student communication."}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {(highlights.length > 0
              ? highlights
              : [
                  {
                    body: "Structured course and cohort experience for learners.",
                    title: "Organized learning",
                  },
                  {
                    body: "Attendance, assignments, and progress stay connected.",
                    title: "Progress tracking",
                  },
                  {
                    body: "Clear institute contact and inquiry workflow.",
                    title: "Easy contact",
                  },
                ]
            ).map((item, index) => (
              <div
                className="rounded-3xl border border-[#D8E8F0] bg-white p-5 shadow-lg shadow-[#0B2A3D]/5"
                key={`${item.title ?? "highlight"}-${index}`}
              >
                <p className="text-sm font-semibold" style={{ color: brandColor }}>
                  {item.title || `Highlight ${index + 1}`}
                </p>
                <p className="mt-3 text-sm leading-6 text-[#425B76]">
                  {item.body || "Add a public highlight from settings."}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {site.site.public_show_courses ? (
        <section className="bg-white py-10">
          <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <Badge tone="admin">Course previews</Badge>
                <h2 className="mt-4 text-3xl font-semibold tracking-normal">
                  Published programs
                </h2>
              </div>
              <p className="text-sm font-medium text-[#66788F]">
                {site.courses.length} published
              </p>
            </div>
            <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {site.courses.length === 0 ? (
                <div className="rounded-3xl border border-[#D8E8F0] bg-[#F6FBFE] p-6 text-sm text-[#425B76]">
                  Course previews will appear here once the institute publishes
                  courses.
                </div>
              ) : (
                site.courses.map((course) => (
                  <div
                    className="rounded-3xl border border-[#D8E8F0] bg-white p-6 shadow-xl shadow-[#0B2A3D]/5"
                    key={course.id}
                  >
                    <Badge tone="success">Published</Badge>
                    <h3 className="mt-5 text-xl font-semibold">
                      {course.title}
                    </h3>
                    <p className="mt-3 line-clamp-4 text-sm leading-6 text-[#425B76]">
                      {course.description || "Course details coming soon."}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      ) : null}

      {site.site.public_show_contact_form ? (
        <section
          className="mx-auto max-w-7xl px-5 py-10 sm:px-6 lg:px-8"
          id="inquiry"
        >
          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <Badge tone="owner">Inquiry</Badge>
              <h2 className="mt-4 text-3xl font-semibold tracking-normal">
                Contact {displayName}
              </h2>
              <p className="mt-4 text-sm leading-7 text-[#425B76]">
                Share your details and the institute team can follow up about
                courses, batches, fees, or admissions.
              </p>
              {site.tenant.support_email || site.tenant.support_phone ? (
                <div className="mt-5 rounded-3xl border border-[#D8E8F0] bg-white p-5 text-sm leading-7 text-[#425B76]">
                  {site.tenant.support_email ? (
                    <p>Email: {site.tenant.support_email}</p>
                  ) : null}
                  {site.tenant.support_phone ? (
                    <p>Phone: {site.tenant.support_phone}</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <form
              className="rounded-3xl border border-[#D8E8F0] bg-white p-6 shadow-xl shadow-[#0B2A3D]/10"
              onSubmit={handleSubmit}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-semibold text-[#0B1F33]">
                  Name
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
                  Interested course
                  <select
                    className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] px-4 text-sm outline-none focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        interestedCourseId: event.target.value,
                      }))
                    }
                    value={form.interestedCourseId}
                  >
                    <option value="">General inquiry</option>
                    {site.courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>
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
                <label className="block text-sm font-semibold text-[#0B1F33]">
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
                Message
                <textarea
                  className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm leading-6 outline-none focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  maxLength={2000}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      message: event.target.value,
                    }))
                  }
                  value={form.message}
                />
              </label>
              {error ? (
                <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </p>
              ) : null}
              {message ? (
                <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {message}
                </p>
              ) : null}
              <Button className="mt-5 w-full" disabled={submitting} type="submit">
                {submitting ? "Submitting..." : ctaLabel}
              </Button>
            </form>
          </div>
        </section>
      ) : null}

      <footer className="border-t border-[#D8E8F0] bg-white px-5 py-6 text-sm text-[#425B76] sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <p>{site.site.public_footer_note || `${displayName} public website.`}</p>
          {site.tenant.show_powered_by ? (
            <p className="font-semibold">Powered by CoachFort</p>
          ) : null}
        </div>
      </footer>
    </main>
  );
}
