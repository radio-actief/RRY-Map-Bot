/* Addresses in the site's tool list (GET /api/v1/site-tools), checked as the server does
 * (config/site_tools.py): a path on this site ("/nodebook/") or a tool on its own address, plain
 * https ending in "/" ("https://nodebook.example/"; http only on this machine, for tests).
 * Shared by the map popup and the configurator; the top bar (a classic script) keeps a copy. */

const PATH = /^\/(?![/\\])[A-Za-z0-9._~\-/]*$/;
const FULL = /^(?:https:\/\/[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|http:\/\/(?:localhost|127\.0\.0\.1))(?::[1-9][0-9]{0,4})?\/(?:[A-Za-z0-9._~-]+\/)*$/;
const DOT_SEGMENT = /(^|\/)\.{1,2}(\/|$)/;

/** The map's own pages, by path and by the key a tool list may give them. */
export const OWN_PAGES = ["/", "/stats", "/region-map", "/configurator"];
export const OWN_KEYS = ["map", "stats", "regionMap", "configurator"];

/** Whether `url` is a tool address the site may list. */
export function isToolUrl(url) {
  if (typeof url !== "string") return false;
  if (PATH.test(url)) return !DOT_SEGMENT.test(url);
  if (!FULL.test(url)) return false;
  return !DOT_SEGMENT.test(url.slice(url.indexOf("/", url.indexOf("//") + 2)));
}

/** The listed tools besides the map's own pages, in order; anything malformed is left out. */
export function otherTools(list) {
  return (Array.isArray(list) ? list : []).filter(
    (x) =>
      !!x &&
      typeof x.key === "string" &&
      typeof x.label === "string" &&
      isToolUrl(x.url) &&
      !OWN_KEYS.includes(x.key) &&
      !OWN_PAGES.includes(x.url),
  );
}

/** Whether a tool's address is on another origin than `here` (e.g. location.origin). */
export function isOtherOrigin(url, here) {
  try {
    return new URL(url, here).origin !== new URL(here).origin;
  } catch {
    return false;
  }
}
