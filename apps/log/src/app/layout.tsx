import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: site.title,
    template: `%s · ${site.name}`,
  },
  description: site.description,
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
  },
  robots: {
    index: true,
    follow: true,
  },
};

const nav = [
  { href: "https://xc.95chong.cn/", label: "首页", external: true },
  { href: "/", label: "更新日志", external: false },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="flex h-dvh flex-col overflow-hidden antialiased">
        <header className="z-10 flex h-16 shrink-0 items-center gap-8 border-b border-[#eee] bg-white px-6 sm:px-8">
          <a href="https://xc.95chong.cn/" className="text-[20px] font-semibold tracking-wide text-[#1a1a1a]">
            {site.name}
          </a>
          <nav className="flex items-center gap-7 text-[15px]" aria-label="主导航">
            {nav.map((item) =>
              item.external ? (
                <a key={item.label} href={item.href} className="text-[#333] hover:text-[#1677ff]">
                  {item.label}
                </a>
              ) : (
                <Link key={item.label} href={item.href} className="text-[#1677ff]">
                  {item.label}
                </Link>
              ),
            )}
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
