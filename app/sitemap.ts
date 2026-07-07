import type { MetadataRoute } from "next";

const canonicalUrl = "https://coachfort.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      changeFrequency: "weekly",
      lastModified,
      priority: 1,
      url: canonicalUrl,
    },
    {
      changeFrequency: "monthly",
      lastModified,
      priority: 0.7,
      url: `${canonicalUrl}/demo`,
    },
  ];
}
