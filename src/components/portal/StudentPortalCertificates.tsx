"use client";

import { Card } from "@/src/components/ui/Card";
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
    <div>
      <h1 className="text-3xl font-semibold tracking-normal">Certificates</h1>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {overview.certificates.length === 0 ? (
          <PortalEmptyState>No certificates issued yet.</PortalEmptyState>
        ) : (
          overview.certificates.map((certificate) => (
            <Card className="border-[#D8E8F0] bg-white p-6" key={certificate.enrollmentId}>
              <p className="text-sm font-semibold text-[#0E7490]">
                {certificate.certificateNumber}
              </p>
              <h2 className="mt-3 text-xl font-semibold">
                {certificate.courseTitle}
              </h2>
              <p className="mt-2 text-sm text-[#425B76]">
                Issued {formatPortalDate(certificate.issuedAt)}
              </p>
              <p className="mt-5 rounded-2xl bg-[#F6FBFE] p-3 text-sm text-[#425B76]">
                Public certificate viewing will use a student-safe route in a
                later module.
              </p>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
