import type { MetadataRoute } from "next";

const canonicalUrl = "https://coachfort.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/app/",
        "/forgot-password",
        "/invite/",
        "/login",
        "/onboarding",
        "/platform",
        "/portal/",
        "/reset-password",
        "/signup",
      ],
    },
    sitemap: `${canonicalUrl}/sitemap.xml`,
    host: canonicalUrl,
  };
}
