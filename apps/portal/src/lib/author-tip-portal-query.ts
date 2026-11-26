import { site } from "@/lib/site";

export const AUTHOR_TIP_QUERY_FROM_MICRO = "micro";
export const AUTHOR_TIP_QUERY_OPEN = "tip";
export const AUTHOR_TIP_QUERY_OPEN_VALUE = "1";

export const AUTHOR_TIP_OPEN_EVENT = "portal-author-tip-open";

export const AUTHOR_TIP_PORTAL_ABOUT_PATH = "/about";

export function authorTipPortalUrlFromMicroClient(): string {
  const url = new URL(AUTHOR_TIP_PORTAL_ABOUT_PATH, `${site.url}/`);
  url.searchParams.set(AUTHOR_TIP_QUERY_OPEN, AUTHOR_TIP_QUERY_OPEN_VALUE);
  url.searchParams.set("from", AUTHOR_TIP_QUERY_FROM_MICRO);
  return url.toString();
}

export function shouldOpenAuthorTipFromSearch(search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get(AUTHOR_TIP_QUERY_OPEN) !== AUTHOR_TIP_QUERY_OPEN_VALUE) {
    return false;
  }
  return params.get("from") === AUTHOR_TIP_QUERY_FROM_MICRO;
}

export function stripAuthorTipQueryFromBrowserUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete(AUTHOR_TIP_QUERY_OPEN);
  url.searchParams.delete("from");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", next);
}

export function requestAuthorTipDialogOpen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTHOR_TIP_OPEN_EVENT));
}