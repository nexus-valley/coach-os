import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { CertificatePageClient } from "@/src/components/certificates/CertificatePageClient";

type CertificatePageProps = {
  params: Promise<{
    enrollmentId: string;
  }>;
};

export default async function CertificatePage({
  params,
}: CertificatePageProps) {
  const { enrollmentId } = await params;

  return (
    <RouteGuard mode="app">
      <CertificatePageClient enrollmentId={enrollmentId} />
    </RouteGuard>
  );
}
