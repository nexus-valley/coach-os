import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";

export default function CertificatesIndexPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Certificates">
        <FeatureGate featureKey="certificates">
          <div className="mx-auto max-w-5xl">
            <Card className="border-[#D8E8F0] bg-white p-8 shadow-xl shadow-[#0B2A3D]/10">
              <div className="inline-flex rounded-full border border-[#145DA0]/20 bg-[#145DA0]/10 px-3 py-1 text-xs font-semibold text-[#145DA0]">
                Certificates
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33]">
                Certificate center
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#425B76]">
                Certificates are generated from completed course enrollments. Open
                a student or course record to review completion status and
                generate a branded certificate.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button href="/app/students">View students</Button>
                <Button href="/app/courses" variant="secondary">
                  View courses
                </Button>
              </div>
            </Card>
          </div>
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
