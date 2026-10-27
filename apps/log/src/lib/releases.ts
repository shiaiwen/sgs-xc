import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const releasesDir = path.join(process.cwd(), "content", "releases");

export type Release = {
  version: string;
  title: string;
  date: string;
  content: string;
};

function asDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const text = value == null ? "" : String(value).trim();
  const matched = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return matched ? matched[1] : text;
}

function asVersion(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return value == null ? "" : String(value).trim();
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftNumber = Number(leftParts[index] ?? 0);
    const rightNumber = Number(rightParts[index] ?? 0);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    const compared = (leftParts[index] ?? "").localeCompare(rightParts[index] ?? "");
    if (compared !== 0) return compared;
  }
  return left.localeCompare(right);
}

export function getReleases(): Release[] {
  if (!fs.existsSync(releasesDir)) return [];

  const releases: Release[] = [];
  const seen = new Set<string>();
  const files = fs.readdirSync(releasesDir).filter((name) => name.endsWith(".md"));

  for (const name of files) {
    const raw = fs.readFileSync(path.join(releasesDir, name), "utf8");
    const { data, content } = matter(raw);
    const version = asVersion(data.version);
    const date = asDate(data.date);
    if (!version || !date) {
      throw new Error(`更新日志缺少 version 或 date：${name}`);
    }
    if (seen.has(version)) {
      throw new Error(`更新日志版本重复：${version}`);
    }
    seen.add(version);
    const titleText = data.title == null ? "" : String(data.title).trim();
    releases.push({
      version,
      title: titleText || `小抄 ${version}`,
      date,
      content: content.trim(),
    });
  }

  releases.sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? 1 : -1;
    return compareVersions(right.version, left.version);
  });
  return releases;
}
