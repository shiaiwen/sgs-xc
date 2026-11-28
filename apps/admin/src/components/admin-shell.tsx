"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSessionToken } from "@/lib/ticket-api";

const NAV_ITEMS = [{ href: "/tickets", label: "工单中心", icon: "票" }];

/** 左侧菜单 + 顶栏的管理台骨架。 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  function signOut() {
    clearSessionToken();
    router.replace("/login");
  }

  return (
    <div className="admin-shell">
      <aside className="admin-shell__aside" aria-label="主导航">
        <div className="admin-shell__brand">
          <p className="admin-shell__brand-name">小抄管理台</p>
          <p className="admin-shell__brand-sub">用户反馈处理</p>
        </div>
        <nav aria-label="业务菜单">
          <p className="admin-shell__nav-label">业务</p>
          <ul className="admin-shell__nav">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={active ? "admin-shell__nav-item admin-shell__nav-item--active" : "admin-shell__nav-item"}
                  >
                    <span className="admin-shell__nav-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <div className="admin-shell__main">
        <header className="admin-shell__header">
          <span className="admin-shell__header-title">工单中心</span>
          <button type="button" className="admin-shell__signout" onClick={signOut}>
            退出登录
          </button>
        </header>
        <div className="admin-shell__content">{children}</div>
      </div>
    </div>
  );
}