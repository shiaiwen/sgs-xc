"use client";

import { useEffect, useState } from "react";
import { Markdown } from "@/components/markdown";

type Release = {
  version: string;
  title: string;
  date: string;
  content: string;
};

function versionFromLocation(releases: Release[]) {
  const requested = new URLSearchParams(window.location.search).get("v");
  if (requested && releases.some((item) => item.version === requested)) return requested;
  return releases[0]?.version ?? "";
}

export function ChangelogView({ releases }: { releases: Release[] }) {
  const [version, setVersion] = useState(releases[0]?.version ?? "");

  useEffect(() => {
    const apply = () => setVersion(versionFromLocation(releases));
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, [releases]);

  const current = releases.find((item) => item.version === version) ?? releases[0];

  function select(next: string) {
    setVersion(next);
    const url = new URL(window.location.href);
    if (releases[0] && next === releases[0].version) url.searchParams.delete("v");
    else url.searchParams.set("v", next);
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="flex max-h-64 w-full shrink-0 flex-col overflow-hidden bg-[#f5f6f7] md:max-h-none md:w-[320px]">
        <p className="px-6 pb-3 pt-6 text-[20px] font-semibold text-[#1a1a1a]">更新日志</p>
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-6" aria-label="版本列表">
          {releases.map((item) => {
            const selected = item.version === current?.version;
            return (
              <button
                key={item.version}
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => select(item.version)}
                className={`mb-1 block w-full rounded-md px-3 py-2 text-left text-[14px] leading-6 text-[#333] hover:bg-[#ececec] ${selected ? "bg-[#e4e4e4]" : ""}`}
              >
                {item.version} ({item.date})
              </button>
            );
          })}
        </nav>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-white">
        {current ? (
          <article className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 sm:px-16 sm:py-12">
            <h1 className="text-[32px] font-bold leading-tight text-[#1a1a1a] sm:text-[36px]">
              {current.title}
            </h1>
            <p className="mt-4 text-[14px] text-[#666]">发布时间：{current.date}</p>
            {current.content ? (
              <div className="mt-8">
                <Markdown source={current.content} />
              </div>
            ) : null}
          </article>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-[14px] text-[#888]">
            还没有更新日志。
          </div>
        )}
        <footer className="mt-auto border-t border-[#eee] py-6 text-center text-[13px] text-[#999]">
          小抄更新日志
        </footer>
      </section>
    </div>
  );
}
