"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  generateCertificateData,
  type CertificateData,
} from "@/src/lib/certificates";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import {
  getSafeTenantBrandColor,
  getTenantSettings,
  type TenantSettings,
} from "@/src/lib/tenantSettings";
import {
  buildCertificateShareMessage,
  buildWhatsAppShareUrl,
} from "@/src/lib/whatsapp";

type CertificatePageClientProps = {
  enrollmentId: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

export function CertificatePageClient({
  enrollmentId,
}: CertificatePageClientProps) {
  const router = useRouter();
  const [certificate, setCertificate] = useState<CertificateData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenantSettings, setTenantSettings] =
    useState<TenantSettings | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCertificate() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const [certificateData, settings] = await Promise.all([
          generateCertificateData(enrollmentId, currentTenant.id),
          getTenantSettings(currentTenant.id),
        ]);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setTenantSettings(settings);
        setCertificate(certificateData);

        if (!certificateData) {
          setError("Certificate not found in this workspace.");
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load certificate."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadCertificate();

    return () => {
      active = false;
    };
  }, [enrollmentId, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F3FAFD] px-5 text-[#0B2A3D]">
        <Card className="h-72 w-full max-w-4xl animate-pulse border-[#D8E8F0] bg-white">
          <span className="sr-only">Loading certificate</span>
        </Card>
      </main>
    );
  }

  if (error || !certificate) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F3FAFD] px-5 text-[#0B2A3D]">
        <Card className="w-full max-w-2xl border-[#D8E8F0] bg-white p-8 text-[#0B2A3D] shadow-2xl shadow-[#0B2A3D]/10">
          <p className="text-sm font-semibold text-[#5D7185]">Certificate</p>
          <h2 className="mt-3 text-2xl font-semibold">
            {error || "Certificate unavailable."}
          </h2>
          <Link
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-[#145DA0] px-5 text-sm font-semibold text-white"
            href="/app/student-portal"
          >
            Back
          </Link>
        </Card>
      </main>
    );
  }

  const brandColor = getSafeTenantBrandColor(tenantSettings?.brand_color);
  const workspaceName =
    tenantSettings?.name || tenant?.name || "CoachOS Workspace";
  function handleShareCertificate() {
    if (!certificate) {
      return;
    }

    const certificateShareMessage = buildCertificateShareMessage({
      certificateLink: window.location.href,
      courseName: certificate.course_title,
      studentName: certificate.student_name,
      workspaceName,
    });
    const certificateShareUrl = buildWhatsAppShareUrl(
      null,
      certificateShareMessage,
    );

    window.open(certificateShareUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="min-h-screen bg-[#F3FAFD] px-5 py-8 text-[#0B2A3D] print:bg-white print:px-0 print:py-0">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-col justify-between gap-4 print:hidden sm:flex-row sm:items-center">
          <Link
            className="text-sm font-semibold text-[#5D7185] transition hover:text-[#0B2A3D]"
            href="/app/student-portal"
          >
            Back
          </Link>
          <Button onClick={() => window.print()} type="button">
            Download
          </Button>
          <Button
            onClick={handleShareCertificate}
            type="button"
            variant="secondary"
          >
            Share on WhatsApp
          </Button>
        </div>
        <p className="mb-6 text-sm text-[#5D7185] print:hidden">
          WhatsApp opens with a pre-filled message. Sending is done manually.
        </p>

        <section className="bg-white p-6 text-black shadow-2xl shadow-black/30 print:min-h-screen print:p-10 print:shadow-none sm:p-10">
          <div
            className="flex min-h-[680px] flex-col items-center justify-center border-4 p-8 text-center sm:p-12"
            style={{ borderColor: brandColor }}
          >
            {tenantSettings?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${workspaceName} logo`}
                className="mb-6 h-16 w-16 rounded-2xl object-contain"
                src={tenantSettings.logo_url}
              />
            ) : null}
            <p
              className="text-sm font-semibold uppercase tracking-[0.35em]"
              style={{ color: brandColor }}
            >
              {workspaceName}
            </p>
            <h1 className="mt-8 text-5xl font-semibold tracking-normal sm:text-6xl">
              Certificate
            </h1>
            <p className="mt-4 text-xl text-slate-700">of Completion</p>

            <div className="my-12 h-px w-48 bg-black" />

            <p className="text-base text-slate-700">This certifies that</p>
            <h2 className="mt-5 text-4xl font-semibold tracking-normal sm:text-5xl">
              {certificate.student_name}
            </h2>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-slate-700">
              has successfully completed the course
            </p>
            <h3 className="mt-4 text-3xl font-semibold tracking-normal">
              {certificate.course_title}
            </h3>

            <div className="mt-12 grid w-full gap-6 border-t border-slate-300 pt-8 text-sm sm:grid-cols-3">
              <div>
                <p className="font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Completion Date
                </p>
                <p className="mt-2 font-semibold">
                  {formatDate(certificate.completion_date)}
                </p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Certificate ID
                </p>
                <p className="mt-2 font-semibold">
                  {certificate.certificate_number}
                </p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Workspace
                </p>
                <p className="mt-2 font-semibold">{workspaceName}</p>
              </div>
            </div>

            <p className="mt-12 text-sm font-semibold text-slate-600">
              Issued by {workspaceName}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
