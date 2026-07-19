"use client";

import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { StatCard } from "@/src/components/ui/StatCard";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  formatPortalDate,
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
  usePortalSection,
} from "@/src/components/portal/StudentPortalShared";

export function StudentPortalCertificates({ context }: { context: StudentPortalContext }) {
  const { error, loading, overview } = usePortalSection(context);

  if (loading) return <PortalLoadingCard label="Loading certificates" />;
  if (error || !overview) return <PortalError message={error || "Unable to load certificates."} />;

  return (
    <div className="space-y-6">
      <PageHeader
        description="View certificates your coach has issued for completed programs."
        eyebrow="Achievements"
        title="Certificates"
      />

      <section className="grid gap-4 md:grid-cols-2">
        <StatCard label="Issued" value={overview.certificates.length} />
      </section>

      <SectionHeader
        description="Certificates appear here after your coach issues them for eligible completed programs."
        title="Issued certificates"
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {overview.certificates.length === 0 ? (
          <PortalEmptyState>
            No certificates yet. Certificates will appear here after your coach
            issues them for eligible programs.
          </PortalEmptyState>
        ) : (
          overview.certificates.map((certificate) => (
            <Card
              className="border-[#D8E8F0] bg-white p-6 shadow-sm"
              key={certificate.enrollmentId}
            >
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#0E7490]">
                    {certificate.certificateNumber}
                  </p>
                  <h2 className="mt-3 break-words text-xl font-semibold">
                    {certificate.courseTitle}
                  </h2>
                </div>
                <Badge tone="success">Issued</Badge>
              </div>
              <p className="mt-2 text-sm text-[#425B76]">
                Issued {formatPortalDate(certificate.issuedAt)}
              </p>
              <p className="mt-5 rounded-2xl bg-[#F6FBFE] p-3 text-sm text-[#425B76]">
                Your coach will share any certificate viewing or download
                instructions separately.
              </p>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
