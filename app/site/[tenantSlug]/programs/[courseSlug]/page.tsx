import type { Metadata } from "next";

import { PublicProgramSalesPage } from "@/src/components/public-site/PublicProgramSalesPage";
import { getPublicProgramSalesPage } from "@/src/lib/publicSite";

type PublicProgramRouteProps = {
  params: Promise<{
    courseSlug: string;
    tenantSlug: string;
  }>;
};

export async function generateMetadata({
  params,
}: PublicProgramRouteProps): Promise<Metadata> {
  const { courseSlug, tenantSlug } = await params;

  try {
    const page = await getPublicProgramSalesPage(tenantSlug, courseSlug);

    if (!page) {
      return {
        description: "This public program is not available yet.",
        title: "Program unavailable",
      };
    }

    const brand =
      page.tenant.workspace_display_name ||
      page.tenant.brand_name ||
      page.tenant.name;
    const description =
      page.program.sales_summary ||
      page.program.description ||
      `Request enrollment for ${page.program.title}.`;

    return {
      description,
      openGraph: {
        description,
        images: page.program.thumbnail_url ? [page.program.thumbnail_url] : [],
        title: `${page.program.title} | ${brand}`,
      },
      title: `${page.program.title} | ${brand}`,
    };
  } catch {
    return {
      description: "This public program is not available yet.",
      title: "Program unavailable",
    };
  }
}

export default async function PublicProgramRoute({
  params,
}: PublicProgramRouteProps) {
  const { courseSlug, tenantSlug } = await params;

  return (
    <PublicProgramSalesPage courseSlug={courseSlug} tenantSlug={tenantSlug} />
  );
}
