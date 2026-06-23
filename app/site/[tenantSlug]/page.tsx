import { PublicSitePage } from "@/src/components/public-site/PublicSitePage";

type TenantPublicSitePageProps = {
  params: Promise<{
    tenantSlug: string;
  }>;
};

export default async function TenantPublicSitePage({
  params,
}: TenantPublicSitePageProps) {
  const { tenantSlug } = await params;

  return <PublicSitePage tenantSlug={tenantSlug} />;
}
