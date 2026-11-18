import type { Metadata } from "next";
import { HomeQuickLinks } from "@/components/home-quick-links";

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

export default function Home() {
  return (
    <main className="home-page h-full">
      <section className="home-hero h-full w-full px-6 pb-24 pt-16 sm:px-10">
        <div className="home-hero__content">
          <h1 className="home-hero__title">桌游助手</h1>
          <p className="home-hero__lead">永久免费 · 持续更新 · 代码开源</p>
          <p className="sr-only">
            三国杀打小抄下载站，提供记牌助手微端安装包和浏览器油猴脚本。进入游戏后可查看记牌面板，项目只用于学习技术，不是游戏官方产品。
          </p>
          <HomeQuickLinks />
        </div>
      </section>
    </main>
  );
}