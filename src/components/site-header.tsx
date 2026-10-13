import Link from "next/link";
import { site } from "@/lib/site";

const links: { href: string; label: string; external?: boolean }[] = [
  { href: "/", label: "首页" },
  { href: "/downloads", label: "下载" },
  {
    href: "https://my.feishu.cn/wiki/SkOKwhsYUiQGrWkFTyPcNpMDnwd?from=from_copylink",
    label: "开源",
    external: true,
  },
  { href: "/about", label: "关于我" },
];

export function SiteHeader() {
  return (
    <header className="z-20 shrink-0 border-b border-ink/10 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="font-serif text-lg tracking-wide text-ink">
          {site.name}
        </Link>
        <nav className="hidden items-center gap-6 text-sm sm:flex" aria-label="主导航">
          {links.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink/80 transition hover:text-accent"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="text-ink/80 transition hover:text-accent"
              >
                {link.label}
              </Link>
            ),
          )}
        </nav>
        <details className="relative sm:hidden">
          <summary className="cursor-pointer list-none rounded-full border border-ink/15 px-3 py-1 text-sm">
            菜单
          </summary>
          <nav
            className="absolute right-0 mt-2 flex w-36 flex-col rounded-2xl border border-ink/10 bg-paper p-2 shadow-lg"
            aria-label="移动导航"
          >
            {links.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl px-3 py-2 text-sm hover:bg-ink/5"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-xl px-3 py-2 text-sm hover:bg-ink/5"
                >
                  {link.label}
                </Link>
              ),
            )}
          </nav>
        </details>
      </div>
    </header>
  );
}
