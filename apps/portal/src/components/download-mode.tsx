"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { useState, type ReactNode } from "react";

const modes = [
  { value: "client", label: "微端" },
  { value: "script", label: "油猴脚本" },
] as const;

type ModeId = (typeof modes)[number]["value"];

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
      <SegmentedControl
        options={modes}
        value={mode}
        onChange={setMode}
        role="tablist"
        ariaLabel="下载方式"
      />
      <div className="mt-8" role="tabpanel">
        {mode === "client" ? client : script}
      </div>
    </div>
  );
}
