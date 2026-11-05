/** The four tool pages: in the top bar on a computer, at the top of the ☰ menu on a phone. */
export const PAGES = [
  ["/", "page.map"],
  ["/stats", "page.stats"],
  ["/region-map", "page.regionMap"],
  ["/configurator", "page.configurator"],
] as const;

/** This page, marked as current in both places. */
export const HERE = "/configurator";
