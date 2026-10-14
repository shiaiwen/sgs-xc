import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { getPage, getPageSlugs } from "@/lib/pages";

type Props = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getPageSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = getPage(slug);
  if (!page) return {};

  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/${slug}` },
    openGraph: {
      title: page.title,
      description: page.description,
      type: "article",
      url: `/${slug}`,
      images: [{ url: "/og.jpg", alt: page.title }],
    },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const page = getPage(slug);
  if (!page) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.title,
    description: page.description,
    dateModified: page.updated,
    inLanguage: "zh-CN",
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="mb-8 border-b border-ink/10 pb-6">
        <h1 className="mt-2 font-serif text-4xl leading-tight">{page.title}</h1>
        {page.description ? (
          <p className="mt-3 text-ink/70">{page.description}</p>
        ) : null}
        {page.updated ? (
          <p className="mt-3 text-xs text-ink/50">更新于 {page.updated}</p>
        ) : null}
      </header>
      <Markdown source={page.content} />
    </main>
  );
}
