import { signal } from "@preact/signals";
import { I18N, t } from "../i18n/t";

/** The four tool pages: in the top bar on a computer, at the top of the ☰ menu on a phone. */
export const PAGES = [
  ["/", "page.map"],
  ["/stats", "page.stats"],
  ["/region-map", "page.regionMap"],
  ["/configurator", "page.configurator"],
] as const;

/** This page, marked as current in both places. */
export const HERE = "/configurator";

/** A tool the site runs besides the map (GET /api/v1/site-tools), e.g. NodeBook. */
export type SiteTool = { key: string; label: string; url: string };

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
    const own: string[] = PAGES.map(([href]) => href);
    siteTools.value = list.filter(
      (x): x is SiteTool =>
        !!x && typeof x.key === "string" && typeof x.label === "string" && typeof x.url === "string" && x.url.startsWith("/") && !x.url.startsWith("//") && !own.includes(x.url),
    );
  } catch {
    /* no tool list: the four pages only */
  }
}
