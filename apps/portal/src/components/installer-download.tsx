"use client";

import { useEffect, useState } from "react";

export function InstallerDownload() {
  const [zipName, setZipName] = useState("wd-xc.zip");

  useEffect(() => {
    let cancelled = false;
    fetch("/downloads/manifest.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("manifest");
        return response.json() as Promise<{ version?: string }>;
      })
      .then((manifest) => {
        const version = String(manifest.version || "").trim();
        if (!cancelled && version) setZipName(`wd-xc-${version}.zip`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <a
      href={`/downloads/${zipName}`}
      download={zipName}
      className="inline-flex min-w-28 items-center justify-center rounded-full bg-[#1677ff] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#4096ff]"
    >
      下载
    </a>
  );
}
