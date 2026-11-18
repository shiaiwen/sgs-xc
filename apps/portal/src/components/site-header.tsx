import Link from "next/link";
import { AuthorTipEntry } from "@/components/author-tip-entry";
import { site } from "@/lib/site";

const links: { href: string; label: string; external?: boolean }[] = [
  { href: "/", label: "首页" },
  { href: "https://log.95chong.cn", label: "更新日志", external: true },
  {
    href: "https://my.feishu.cn/wiki/SkOKwhsYUiQGrWkFTyPcNpMDnwd?from=from_copylink",
    label: "开源",
    external: true,
  },
];

function NavLinks({ className }: { className: string }) {
  return links.map((link) =>
    link.external ? (
      <a
        key={link.href}
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {link.label}
      </a>
    ) : (
      <Link key={link.href} href={link.href} className={className}>
        {link.label}
      </Link>
    ),
  );
}

export function SiteHeader() {
  return (
    <header className="site-header z-20 flex shrink-0 items-center">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 sm:px-8">
        <Link href="/" className="site-header__brand">
          {site.name}
        </Link>
        <nav className="site-header__nav hidden sm:flex" aria-label="主导航">
          <div className="site-header__nav-links">
            <NavLinks className="site-header__link" />
          </div>
          <AuthorTipEntry triggerClassName="site-header__tip" />
        </nav>
        <details className="relative sm:hidden">
          <summary className="site-header__link cursor-pointer list-none">菜单</summary>
          <nav
            className="site-header__menu absolute right-0 mt-3 flex w-40 flex-col p-2"
            aria-label="移动导航"
          >
            <NavLinks className="site-header__link" />
            <AuthorTipEntry triggerClassName="site-header__tip site-header__tip--menu" />
          </nav>
        </details>
      </div>
    </header>
  );
}
