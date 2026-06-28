import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { CertificatePageClient } from "@/src/components/certificates/CertificatePageClient";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";

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
      <AppShell activeItem="Certificates">
        <FeatureGate featureKey="certificates">
          <CertificatePageClient enrollmentId={enrollmentId} />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
