"use client";

import { useState, type ReactNode } from "react";

const modes = [
  { id: "client", label: "微端" },
  { id: "script", label: "油猴脚本" },
] as const;

type ModeId = (typeof modes)[number]["id"];

export function DownloadMode({
  client,
  script,
}: {
  client: ReactNode;
  script: ReactNode;
}) {
  const [mode, setMode] = useState<ModeId>("client");

  return (
    <div>
      <div
        className="flex gap-2 rounded-full border border-ink/10 bg-card p-1"
        role="tablist"
        aria-label="下载方式"
      >
        {modes.map((item) => {
          const selected = mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition sm:flex-none sm:px-6 ${
                selected
                  ? "bg-ink text-paper"
                  : "text-ink/70 hover:text-ink"
              }`}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="mt-8" role="tabpanel">
        {mode === "client" ? client : script}
      </div>
    </div>
  );
}
