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
      <div className="segmented" role="tablist" aria-label="下载方式">
        {modes.map((item) => {
          const selected = mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={
                selected ? "segmented__item segmented__item--active" : "segmented__item"
              }
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
