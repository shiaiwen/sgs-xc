import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DownloadMode } from "@/components/download-mode";
import { InstallerDownload } from "@/components/installer-download";

const userscriptHref = "/downloads/sgs-xc.user.js";

export const metadata: Metadata = {
  title: "下载",
  description:
    "三国杀打小抄下载。可选微端安装包，或在浏览器安装油猴脚本，永久免费。",
  keywords: ["三国杀小抄下载", "微端安装", "油猴脚本", "Tampermonkey", "记牌助手"],
  alternates: { canonical: "/downloads" },
  openGraph: {
    title: "下载 · 桌游助手",
    description:
      "三国杀打小抄下载。可选微端安装包，或在浏览器安装油猴脚本，永久免费。",
    url: "/downloads",
    images: [{ url: "/og.jpg", alt: "桌游助手下载" }],
  },
};

function Path({ children }: { children: string }) {
  return (
    <code className="rounded bg-ink/5 px-1.5 py-0.5 text-[0.92em] text-ink">
      {children}
    </code>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-3 list-decimal space-y-2 pl-5 text-ink/80">
      {items.map((item, index) => (
        <li key={index} className="pl-1">
          {item}
        </li>
      ))}
    </ol>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-ink/10 bg-card p-5 sm:p-6">
      <h3 className="font-serif text-xl text-ink">{title}</h3>
      <div className="mt-3 space-y-5 text-sm leading-7 sm:text-base">{children}</div>
    </section>
  );
}

const actionClass =
  "inline-flex min-w-28 items-center justify-center rounded-full bg-ink px-6 py-3 text-sm font-medium text-paper transition hover:bg-accent";

export default function DownloadsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="font-serif text-4xl">下载</h1>
      <div className="mt-6">
      <DownloadMode
        client={
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 pb-6">
              <p className="max-w-xl text-sm leading-7 text-ink/70 sm:text-base">
                解压下载的测试包后，请先完全关闭三国杀官方微端，再按系统选择对应步骤。
              </p>
              <InstallerDownload />
            </div>
            <div className="mt-8 space-y-8">
        <div>
          <h2 className="font-serif text-2xl text-ink">Windows</h2>
          <div className="mt-4 space-y-4">
            <Section title="自动安装（推荐）">
              <Steps
                items={[
                  <>
                    把 <Path>app.zip</Path>、<Path>install.bat</Path>、
                    <Path>restore.bat</Path> 放进官方微端的{" "}
                    <Path>resources</Path> 目录，通常位于：
                    <div className="mt-2">
                      <Path>C:\Program Files\SGSOL\resources</Path>
                    </div>
                  </>,
                  <>
                    右键 <Path>install.bat</Path>
                    ，选择“以管理员身份运行”，完成后重新打开官方微端。
                  </>,
                ]}
              />
            </Section>

            <Section title="卸载">
              <p>
                右键 <Path>restore.bat</Path>
                ，选择“以管理员身份运行”，即可恢复官方微端。
              </p>
            </Section>

            <Section title="手动安装（无法运行 install.bat 时）">
              <Steps
                items={[
                  <>
                    进入官方微端的 <Path>resources</Path> 目录。
                  </>,
                  <>
                    如果已有 <Path>app\config.json</Path>
                    ，先复制一份到桌面备份。
                  </>,
                  <>
                    删除 <Path>resources</Path> 下的 <Path>app</Path>{" "}
                    文件夹（如果没有则跳过）。
                  </>,
                  <>
                    把 <Path>app.zip</Path> 解压到 <Path>resources</Path>{" "}
                    目录，确保 <Path>resources\app\package.json</Path>{" "}
                    直接存在。
                  </>,
                  <>
                    把第 2 步备份的 <Path>config.json</Path> 复制回{" "}
                    <Path>resources\app\config.json</Path>
                    （无备份则跳过）。
                  </>,
                  <>
                    把 <Path>resources\app.asar</Path> 重命名为{" "}
                    <Path>app.asar.bak</Path>
                    （让 Electron 使用 app 文件夹）。
                  </>,
                  <>重新打开三国杀微端。</>,
                ]}
              />
            </Section>

            <Section title="手动恢复官方微端（无法运行 restore.bat 时）">
              <Steps
                items={[
                  <>
                    删除 <Path>resources\app</Path> 文件夹。
                  </>,
                  <>
                    把 <Path>resources\app.asar.bak</Path> 重命名为{" "}
                    <Path>app.asar</Path>。
                  </>,
                  <>重新打开三国杀微端。</>,
                ]}
              />
            </Section>
          </div>
        </div>

        <div>
          <h2 className="font-serif text-2xl text-ink">macOS</h2>
          <div className="mt-4 space-y-4">
            <Section title="自动安装（推荐）">
              <Steps
                items={[
                  <>
                    把 <Path>app.zip</Path>、<Path>install.sh</Path>、
                    <Path>restore.sh</Path> 放进官方微端的{" "}
                    <Path>Resources</Path> 目录，通常位于：
                    <div className="mt-2">
                      <Path>/Applications/SGSOL.app/Contents/Resources</Path>
                    </div>
                  </>,
                  <>
                    在该目录打开“终端”，执行：
                    <div className="mt-2">
                      <Path>sudo bash install.sh</Path>
                    </div>
                    按提示输入系统密码，完成后重新打开官方微端。
                  </>,
                ]}
              />
            </Section>

            <Section title="卸载">
              <p>
                在同一目录执行：
                <span className="mt-2 block">
                  <Path>sudo bash restore.sh</Path>
                </span>
                即可恢复官方微端。
              </p>
            </Section>

            <Section title="手动安装（无法运行 install.sh 时）">
              <Steps
                items={[
                  <>
                    进入官方微端的 <Path>Resources</Path> 目录：
                    <div className="mt-2">
                      <Path>/Applications/SGSOL.app/Contents/Resources</Path>
                    </div>
                  </>,
                  <>
                    如果已有 <Path>app/config.json</Path>
                    ，先复制一份到桌面备份。
                  </>,
                  <>
                    删除 <Path>Resources</Path> 下的 <Path>app</Path>{" "}
                    文件夹（如果没有则跳过）。
                  </>,
                  <>
                    把 <Path>app.zip</Path> 解压到 <Path>Resources</Path>{" "}
                    目录，确保 <Path>Resources/app/package.json</Path>{" "}
                    直接存在。
                  </>,
                  <>
                    把第 2 步备份的 <Path>config.json</Path> 复制回{" "}
                    <Path>Resources/app/config.json</Path>
                    （无备份则跳过）。
                  </>,
                  <>
                    把 <Path>Resources/app.asar</Path> 重命名为{" "}
                    <Path>app.asar.bak</Path>
                    （让 Electron 使用 app 文件夹）。
                  </>,
                  <>重新打开三国杀微端。</>,
                ]}
              />
            </Section>

            <Section title="手动恢复官方微端（无法运行 restore.sh 时）">
              <Steps
                items={[
                  <>
                    删除 <Path>Resources/app</Path> 文件夹。
                  </>,
                  <>
                    把 <Path>Resources/app.asar.bak</Path> 重命名为{" "}
                    <Path>app.asar</Path>。
                  </>,
                  <>重新打开三国杀微端。</>,
                ]}
              />
            </Section>
          </div>
        </div>

        <section className="rounded-2xl border border-accent/20 bg-accent/5 p-5 sm:p-6">
          <h2 className="font-serif text-xl text-ink">注意</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-ink/80 sm:text-base">
            <li>
              Windows：修改 <Path>C:\Program Files</Path>{" "}
              需要管理员权限，建议先把文件复制到桌面操作后再粘贴回去。
            </li>
            <li>
              macOS：修改 <Path>/Applications</Path>{" "}
              需要管理员权限；若终端提示 Operation not permitted，请先确认微端已完全退出。
            </li>
            <li>
              若删除/重命名 <Path>app.asar</Path>{" "}
              后仍是旧界面，重启电脑即可。
            </li>
            <li>
              微端启动后会自动检查整包与小抄脚本更新；安装完成后一般无需手动重复上述步骤。
            </li>
          </ul>
        </section>
            </div>
          </>
        }
        script={
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 pb-6">
              <p className="max-w-xl text-sm leading-7 text-ink/70 sm:text-base">
                在浏览器里安装小抄脚本，打开三国杀网页端即可使用，不用替换微端文件。
              </p>
              <a href={userscriptHref} className={actionClass}>
                脚本小抄
              </a>
            </div>
            <div className="mt-8">
              <Section title="安装">
                <Steps
                  items={[
                    <>
                      先在浏览器安装{" "}
                      <a
                        href="https://www.tampermonkey.net/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline-offset-2 hover:underline"
                      >
                        Tampermonkey
                      </a>{" "}
                      / 篡改猴扩展。
                    </>,
                    <>点击“脚本小抄”，在 Tampermonkey 页面确认安装或更新。</>,
                    <>打开三国杀网页端，进入游戏后即可看到小抄面板。</>,
                  ]}
                />
              </Section>
            </div>
          </>
        }
      />
      </div>
    </main>
  );
}
