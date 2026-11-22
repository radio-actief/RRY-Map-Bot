export type SiteTool = { key: string; label: string; url: string };
export const OWN_PAGES: string[];
export const OWN_KEYS: string[];
/** Whether `url` is a tool address the site may list. */
export function isToolUrl(url: unknown): url is string;
/** The listed tools besides the map's own pages, in order; anything malformed is left out. */
export function otherTools(list: unknown): SiteTool[];
/** Whether a tool's address is on another origin than `here`. */
export function isOtherOrigin(url: string, here: string): boolean;
export type PageKey = "map" | "stats" | "regionMap" | "configurator";
export const PAGE_PATHS: Record<PageKey, string>;
/** The links for this host: each page's link, and the map's origin and device hub on another address. */
export type SiteLinks = { pages: Record<PageKey, string>; map: string | null; hub: string | null };
/** The links the server gave this page (<meta name="bemesh-site">), or null: the fixed paths. */
export function readSiteLinks(doc?: Document | null): SiteLinks | null;
