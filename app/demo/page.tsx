import { DemoPageClient } from "@/src/components/demo/DemoPageClient";
import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";
import { EarlyAccessNotice } from "@/src/components/marketing/EarlyAccessNotice";

export default function DemoPage() {
  return (
    <>
      <MarketingHeader />
      <EarlyAccessNotice />
      <DemoPageClient />
      <MarketingFooter />
    </>
  );
}
