import Link from "next/link";
import { site } from "@/lib/site";

const links: { href: string; label: string; external?: boolean }[] = [
  { href: "/", label: "首页" },
  { href: "/downloads", label: "下载" },
  { href: "https://log.95chong.cn", label: "更新日志", external: true },
  {
    href: "https://my.feishu.cn/wiki/SkOKwhsYUiQGrWkFTyPcNpMDnwd?from=from_copylink",
    label: "开源",
    external: true,
  },
  { href: "/about", label: "关于我" },
];

export function SiteHeader() {
  return (
    <header className="z-20 flex h-20 shrink-0 items-center border-b border-[#eee] bg-white">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 sm:px-8">
        <Link href="/" className="text-[20px] font-semibold tracking-wide text-[#1a1a1a]">
          {site.name}
        </Link>
        <nav className="hidden items-center gap-7 text-[15px] sm:flex" aria-label="主导航">
          {links.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#333] transition hover:text-[#1677ff]"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="text-[#333] transition hover:text-[#1677ff]"
              >
                {link.label}
              </Link>
            ),
          )}
        </nav>
        <details className="relative sm:hidden">
          <summary className="cursor-pointer list-none rounded-full border border-[#ddd] px-3 py-1.5 text-sm text-[#333]">
            菜单
          </summary>
          <nav
            className="absolute right-0 mt-2 flex w-36 flex-col rounded-xl border border-[#eee] bg-white p-2 shadow-lg"
            aria-label="移动导航"
          >
            {links.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg px-3 py-2 text-sm text-[#333] hover:bg-[#f5f6f7]"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-lg px-3 py-2 text-sm text-[#333] hover:bg-[#f5f6f7]"
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
