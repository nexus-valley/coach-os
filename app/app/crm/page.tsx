import { AppShell } from "@/src/components/layout/AppShell";
import { CrmPage } from "@/src/components/crm/CrmPage";
import { FeatureGate } from "@/src/components/features/FeatureGate";

export default function CrmRoute() {
  return (
    <AppShell activeItem="CRM">
      <FeatureGate featureKey="crm">
        <CrmPage />
      </FeatureGate>
    </AppShell>
  );
}
