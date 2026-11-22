import { signal } from "@preact/signals";
import { I18N, t } from "../i18n/t";
import { otherTools, readSiteLinks, type PageKey, type SiteLinks, type SiteTool } from "../../../../src/shared/site-urls.js";

/** The links the server gave this page for its host; null: the four pages' paths on this address. */
export const SITE: SiteLinks | null = readSiteLinks();

/** The map's address when the configurator is on another one; "" on the map's own. */
export const MAP = SITE?.map ?? "";

const OWN: [string, string, PageKey][] = [
  ["/", "page.map", "map"],
  ["/stats", "page.stats", "stats"],
  ["/region-map", "page.regionMap", "regionMap"],
  ["/configurator", "page.configurator", "configurator"],
];

/** The four tool pages, [link, text key, page]: in the top bar on a computer, at the top of the ☰
 * menu on a phone. Their links for this host when the server gave them, else their paths. */
export const PAGES = OWN.map(([path, key, page]) => [SITE?.pages[page] ?? path, key, page] as const);

/** This page, marked as current in both places. */
export const HERE: PageKey = "configurator";

/** The configurator's own address for sign in and log out: its path here, its address on its own. */
export function selfUrl(): string {
  return MAP ? `${location.origin}/` : "/configurator";
}

/** A tool the site runs besides the map (GET /api/v1/site-tools), e.g. NodeBook, on a path of this
 * site or on its own address. */
export type { SiteTool };

/** The listed tools that are not one of the four pages above; [] on a site that only runs the map. */
export const siteTools = signal<SiteTool[]>([]);

/** A listed tool's link text: its translated page.<key>, else the label the site gave. */
export function toolText(tool: SiteTool): string {
  const key = `page.${tool.key}`;
  return I18N.has(key) ? t(key) : tool.label;
}

/** Fetches the site's tool list once; any failure leaves it empty. */
export async function loadSiteTools(fetcher: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetcher("/api/v1/site-tools");
    if (!res.ok) return;
    const list: unknown = await res.json();
    if (!Array.isArray(list)) return;
    siteTools.value = otherTools(list);
  } catch {
    /* no tool list: the four pages only */
  }
}
