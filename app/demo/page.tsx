import { DemoPageClient } from "@/src/components/demo/DemoPageClient";
import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";

export default function DemoPage() {
  return (
    <>
      <MarketingHeader />
      <DemoPageClient />
      <MarketingFooter />
    </>
  );
}
