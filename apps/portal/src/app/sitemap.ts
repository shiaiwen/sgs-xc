import type { MetadataRoute } from "next";
import { getPageSlugs } from "@/lib/pages";
import { site } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = getPageSlugs().map((slug) => ({
    url: `${site.url}/${slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [
    {
      url: site.url,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${site.url}/downloads`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...pages,
  ];
}
