import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const pagesDir = path.join(process.cwd(), "content", "pages");

export type PageMeta = {
  slug: string;
  title: string;
  description: string;
  updated?: string;
};

export type Page = PageMeta & {
  content: string;
};

function readSlug(filename: string) {
  return filename.replace(/\.md$/, "");
}

function asText(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value == null ? "" : String(value);
}

export function getPageSlugs() {
  if (!fs.existsSync(pagesDir)) return [];
  return fs
    .readdirSync(pagesDir)
    .filter((name) => name.endsWith(".md"))
    .map(readSlug);
}

export function getPage(slug: string): Page | null {
  const file = path.join(pagesDir, `${slug}.md`);
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, "utf8");
  const { data, content } = matter(raw);

  return {
    slug,
    title: asText(data.title) || slug,
    description: asText(data.description),
    updated: data.updated ? asText(data.updated) : undefined,
    content,
  };
}

export function getPages(): PageMeta[] {
  return getPageSlugs()
    .map((slug) => getPage(slug))
    .filter((page): page is Page => page !== null)
    .map(({ slug, title, description, updated }) => ({
      slug,
      title,
      description,
      updated,
    }));
}
