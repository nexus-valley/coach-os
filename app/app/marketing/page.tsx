import { AppShell } from "@/src/components/layout/AppShell";
import { MarketingCenterPage } from "@/src/components/marketing/MarketingCenterPage";

export default function MarketingRoute() {
  return (
    <AppShell activeItem="Marketing">
      <MarketingCenterPage />
    </AppShell>
  );
}
