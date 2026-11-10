import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module of the map page
import { nodebookApiUrl, nodebookState, toolByKey, toolLinksHtml } from "../../../src/site-tools.js";

const KEY = "ab".repeat(32);
const TOOLS = [
  { key: "nodebook", label: "NodeBook", url: "/nodebook/" },
  { key: "meshmate", label: "MeshMate", url: "/app/" },
];
const t = (k: string) => ({ "map.nodebook.in": "In your NodeBook", "map.nodebook.add": "Add to NodeBook", "map.connectLive": "Connect live" })[k] ?? k;
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const links = (html: string) => Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);

describe("map popup and the site's tools", () => {
  it("finds a tool only by a site path ending in /", () => {
    expect(toolByKey(TOOLS, "nodebook")?.url).toBe("/nodebook/");
    expect(toolByKey([{ key: "nodebook", url: "https://x/" }], "nodebook")).toBeNull();
    expect(toolByKey([{ key: "nodebook", url: "//x/" }], "nodebook")).toBeNull();
    expect(toolByKey(undefined, "nodebook")).toBeNull();
  });

  it("asks NodeBook only for a full hex key", () => {
    expect(nodebookApiUrl(TOOLS, KEY.toUpperCase())).toBe(`/nodebook/api/nodes/${KEY}`);
    expect(nodebookApiUrl(TOOLS, "abcd")).toBeNull();
    expect(nodebookApiUrl([], KEY)).toBeNull();
  });

  it("reads NodeBook's answer: in a fleet, not in one, or unknown", () => {
    expect(nodebookState(200, { fleets: [{ id: 1 }] })).toBe("in");
    expect(nodebookState(200, { fleets: [] })).toBe("out");
    expect(nodebookState(401, null)).toBeNull();
    expect(nodebookState(500, { fleets: [{ id: 1 }] })).toBeNull();
  });

  it("a signed-in visitor sees the NodeBook line; a companion also gets Connect live", () => {
    const html = toolLinksHtml({ tools: TOOLS, node: { public_key: KEY, type: 1 }, signedIn: true, nodebook: "in", t, escape });
    expect(links(html)).toEqual([
      ["In your NodeBook", `/nodebook/node/${KEY}`],
      ["Connect live", `/app/?node=${KEY}`],
    ]);
  });

  it("a repeater gets no Connect live, and a node outside the fleets gets Add to NodeBook", () => {
    const html = toolLinksHtml({ tools: TOOLS, node: { public_key: KEY, type: 2 }, signedIn: true, nodebook: "out", t, escape });
    expect(links(html)).toEqual([["Add to NodeBook", `/nodebook/node/${KEY}`]]);
  });

  it("nothing for a signed-out visitor's repeater, an unknown NodeBook answer, or a site without the tools", () => {
    expect(toolLinksHtml({ tools: TOOLS, node: { public_key: KEY, type: 2 }, signedIn: false, nodebook: "in", t, escape })).toBe("");
    expect(toolLinksHtml({ tools: TOOLS, node: { public_key: KEY, type: 2 }, signedIn: true, nodebook: null, t, escape })).toBe("");
    expect(toolLinksHtml({ tools: [], node: { public_key: KEY, type: 1 }, signedIn: true, nodebook: "in", t, escape })).toBe("");
    expect(toolLinksHtml({ tools: TOOLS, node: { public_key: "x'onclick", type: 1 }, signedIn: true, nodebook: "in", t, escape })).toBe("");
  });
});
