import type { ReactNode } from "react";
import Link from "next/link";

function QuickLinkIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="home-hero__icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const links = [
  {
    href: "/downloads",
    label: "去下载",
    external: false,
    primary: true,
    icon: (
      <>
        <path d="M12 4v11" />
        <path d="m7 11 5 5 5-5" />
        <path d="M5 20h14" />
      </>
    ),
  },
  {
    href: "/about",
    label: "关于我",
    external: false,
    primary: false,
    icon: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 19.2c1.3-2.8 3.5-4.2 6.5-4.2s5.2 1.4 6.5 4.2" />
      </>
    ),
  },
  {
    href: "https://my.feishu.cn/share/base/form/shrcnkAw07JyIvNIkpNr4lgPJQf",
    label: "需求与 bug 反馈",
    external: true,
    primary: false,
    icon: (
      <>
        <path d="M5 6.5h14v8.5H9.2L5 18.2z" />
        <path d="M8.5 10.5h7" />
        <path d="M8.5 13h4.5" />
      </>
    ),
  },
  {
    href: "https://qm.qq.com/q/RJYR8KT2Aq",
    label: "加入 QQ 群",
    external: true,
    primary: false,
    icon: (
      <>
        <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M16.5 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
        <path d="M3.5 19c.6-2.4 2.4-3.6 4.5-3.6s3.9 1.2 4.5 3.6" />
        <path d="M13 18.6c.4-1.6 1.6-2.5 3.4-2.5 1.6 0 2.8.8 3.3 2.2" />
      </>
    ),
  },
] as const;

export function HomeQuickLinks() {
  return (
    <nav className="home-hero__actions" aria-label="站点入口">
      {links.map((item) => {
        const className = item.primary
          ? "home-hero__action home-hero__action--primary"
          : "home-hero__action";
        const body = (
          <>
            <QuickLinkIcon>{item.icon}</QuickLinkIcon>
            <span>{item.label}</span>
          </>
        );
        if (item.external) {
          return (
            <a
              key={item.href}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className={className}
            >
              {body}
            </a>
          );
        }
        return (
          <Link key={item.href} href={item.href} className={className}>
            {body}
          </Link>
        );
      })}
    </nav>
  );
}