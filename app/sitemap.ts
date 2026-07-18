import type { MetadataRoute } from "next";

const canonicalUrl = "https://coachfort.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const routes = [
    { path: "", priority: 1, changeFrequency: "weekly" as const },
    { path: "/login", priority: 0.4, changeFrequency: "monthly" as const },
    { path: "/signup", priority: 0.5, changeFrequency: "monthly" as const },
    {
      path: "/forgot-password",
      priority: 0.3,
      changeFrequency: "monthly" as const,
    },
    {
      path: "/payment-policy",
      priority: 0.5,
      changeFrequency: "monthly" as const,
    },
    { path: "/terms", priority: 0.5, changeFrequency: "monthly" as const },
    { path: "/privacy", priority: 0.5, changeFrequency: "monthly" as const },
    { path: "/support", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/demo", priority: 0.7, changeFrequency: "monthly" as const },
  ];

  return routes.map((route) => ({
    changeFrequency: route.changeFrequency,
    lastModified,
    priority: route.priority,
    url: `${canonicalUrl}${route.path}`,
  }));
}
