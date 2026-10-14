import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "桌游助手 · 三国杀打小抄下载",
  description:
    "三国杀打小抄下载。永久免费、持续更新、代码开源，一键获取记牌助手安装包。",
  keywords: ["三国杀", "打小抄", "记牌", "桌游助手", "免费下载"],
  alternates: { canonical: "/" },
  openGraph: {
    title: "桌游助手 · 三国杀打小抄下载",
    description:
      "三国杀打小抄下载。永久免费、持续更新、代码开源，一键获取记牌助手安装包。",
    url: "/",
    images: [{ url: "/og.jpg", alt: "桌游助手 · 三国杀打小抄" }],
  },
};

const buttonClass =
  "inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/70 bg-white/10 px-5 py-3 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/20 sm:w-auto sm:px-8 sm:text-base";

function ButtonIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4 shrink-0 sm:size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export default function Home() {
  return (
    <main className="h-full">
      <section className="relative isolate h-full overflow-hidden">
        <img
          src="/bg.jpg"
          alt="桌游助手背景，三国杀打小抄下载站"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-black/62" />
        <div className="relative mx-auto flex h-full w-full max-w-7xl flex-col items-center justify-center px-6 text-center text-paper">
          <h1 className="font-serif text-5xl leading-tight sm:text-7xl">
            桌游助手
          </h1>
          <p className="mt-6 text-lg font-medium tracking-[0.22em] text-[#f0c9a0] sm:text-2xl">
            永久免费 · 持续更新 · 代码开源
          </p>
          <p className="sr-only">
            三国杀打小抄下载站，提供记牌助手微端安装包和浏览器油猴脚本。进入游戏后可查看记牌面板，项目只用于学习技术，不是游戏官方产品。
          </p>
          <div className="mt-10 grid w-full max-w-md grid-cols-2 gap-3 sm:flex sm:w-auto sm:max-w-none sm:flex-nowrap sm:justify-center sm:gap-5">
            <Link
              href="/downloads"
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#f0c9a0] px-5 py-3 text-sm font-medium text-ink shadow-lg shadow-black/20 transition hover:bg-white sm:w-auto sm:px-8 sm:text-base"
            >
              <ButtonIcon>
                <path d="M12 4v11" />
                <path d="m7 11 5 5 5-5" />
                <path d="M5 20h14" />
              </ButtonIcon>
              去下载
            </Link>
            <Link href="/about" className={buttonClass}>
              <ButtonIcon>
                <circle cx="12" cy="8" r="3.2" />
                <path d="M5.5 19.2c1.3-2.8 3.5-4.2 6.5-4.2s5.2 1.4 6.5 4.2" />
              </ButtonIcon>
              关于我
            </Link>
            <a
              href="https://my.feishu.cn/share/base/form/shrcnkAw07JyIvNIkpNr4lgPJQf"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass}
            >
              <ButtonIcon>
                <path d="M5 6.5h14v8.5H9.2L5 18.2z" />
                <path d="M8.5 10.5h7" />
                <path d="M8.5 13h4.5" />
              </ButtonIcon>
              需求bug反馈
            </a>
            <a
              href="https://qm.qq.com/q/RJYR8KT2Aq"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass}
            >
              <ButtonIcon>
                <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                <path d="M16.5 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                <path d="M3.5 19c.6-2.4 2.4-3.6 4.5-3.6s3.9 1.2 4.5 3.6" />
                <path d="M13 18.6c.4-1.6 1.6-2.5 3.4-2.5 1.6 0 2.8.8 3.3 2.2" />
              </ButtonIcon>
              加入QQ群
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
