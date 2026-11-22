import { describe, expect, it } from "vitest";
import { PAGE_PATHS, readSiteLinks } from "../../../src/shared/site-urls.js";

/** The links the server gives a page for its host (<meta name="bemesh-site">, config/site_tools.py page_links). */

const docWith = (content: string | null) => {
  const doc = document.implementation.createHTMLDocument("t");
  if (content !== null) {
    const meta = doc.createElement("meta");
    meta.name = "bemesh-site";
    meta.setAttribute("content", content);
    doc.head.appendChild(meta);
  }
  return doc;
};

describe("the links for this host", () => {
  it("are absent without the meta: the pages keep their paths", () => {
    expect(readSiteLinks(docWith(null))).toBeNull();
    expect(readSiteLinks(docWith("not json"))).toBeNull();
    expect(readSiteLinks(docWith('{"other":1}'))).toBeNull();
    expect(readSiteLinks(null)).toBeNull();
  });

  it("read each page's link, the map's origin and its hub", () => {
    const links = readSiteLinks(
      docWith(
        JSON.stringify({
          pages: { map: "https://map.example/", stats: "/", regionMap: "https://map.example/region-map", configurator: "https://conf.example/" },
          map: "https://map.example",
          hub: "https://map.example/device-hub.html",
        }),
      ),
    );
    expect(links).toEqual({
      pages: { map: "https://map.example/", stats: "/", regionMap: "https://map.example/region-map", configurator: "https://conf.example/" },
      map: "https://map.example",
      hub: "https://map.example/device-hub.html",
    });
  });

  it("fill a missing page with its path and drop a hub on another origin than the map", () => {
    const links = readSiteLinks(docWith(JSON.stringify({ pages: { stats: "/" }, map: "https://map.example/x", hub: "https://evil.example/device-hub.html" })));
    expect(links).toEqual({ pages: { ...PAGE_PATHS, stats: "/" }, map: "https://map.example", hub: null });
    expect(readSiteLinks(docWith(JSON.stringify({ pages: {}, hub: "https://map.example/device-hub.html" })))?.hub).toBeNull();
  });
});
