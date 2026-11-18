import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { PORTAL_FONT_CRITICAL_CSS, PORTAL_FONT_FAMILY } from "@/lib/portal-font";
import { site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: site.title,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  keywords: site.keywords,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: site.name,
    title: site.title,
    description: site.description,
    url: site.url,
    images: [
      {
        url: site.ogImage,
        width: 1200,
        height: 630,
        alt: "桌游助手 · 三国杀打小抄",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
    images: [site.ogImage],
  },
  robots: {
    index: true,
    follow: true,
  },
  verification: {
    other: {
      "baidu-site-verification": "codeva-PYFGr7SqDN",
    },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    alternateName: "三国杀打小抄",
    url: site.url,
    description: site.description,
    inLanguage: "zh-CN",
    keywords: site.keywords.join(","),
  };

  return (
    <html lang="zh-CN" className="h-full" style={{ fontFamily: PORTAL_FONT_FAMILY }}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: PORTAL_FONT_CRITICAL_CSS }} />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <SiteHeader />
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </body>
    </html>
  );
}
