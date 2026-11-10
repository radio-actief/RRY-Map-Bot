import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module of the map page
import { nodebookApiUrl, nodebookFetchInit, nodebookState, toolByKey, toolLinksHtml } from "../../../src/site-tools.js";

const KEY = "ab".repeat(32);
const TOOLS = [
  { key: "nodebook", label: "NodeBook", url: "/nodebook/" },
  { key: "meshmate", label: "MeshMate", url: "/app/" },
];
const t = (k: string) => ({ "map.nodebook.in": "In your NodeBook", "map.nodebook.add": "Add to NodeBook", "map.connectLive": "Connect live" })[k] ?? k;
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const links = (html: string) => Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);

describe("map popup and the site's tools", () => {
  it("finds a tool by a site path or a plain https address ending in /", () => {
    expect(toolByKey(TOOLS, "nodebook")?.url).toBe("/nodebook/");
    expect(toolByKey([{ key: "nodebook", url: "https://nodebook.example/" }], "nodebook")?.url).toBe("https://nodebook.example/");
    expect(toolByKey([{ key: "nodebook", url: "https://nodebook.example:8444/nb/" }], "nodebook")?.url).toBe("https://nodebook.example:8444/nb/");
    expect(toolByKey([{ key: "nodebook", url: "https://nodebook.example" }], "nodebook")).toBeNull();
    expect(toolByKey([{ key: "nodebook", url: "http://nodebook.example/" }], "nodebook")).toBeNull();
    expect(toolByKey([{ key: "nodebook", url: "https://a@nodebook.example/" }], "nodebook")).toBeNull();
    expect(toolByKey([{ key: "nodebook", url: "javascript:x//" }], "nodebook")).toBeNull();
    expect(toolByKey([{ key: "nodebook", url: "/nodebook" }], "nodebook")).toBeNull();
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
      ["Connect live", `/app/#node=${KEY}`],
    ]);
  });

  it("links to tools on their own address, and asks NodeBook there with the visitor's cookies", () => {
    const full = [
      { key: "nodebook", label: "NodeBook", url: "https://nodebook.example/" },
      { key: "meshmate", label: "MeshMate", url: "https://app.example/" },
    ];
    const html = toolLinksHtml({ tools: full, node: { public_key: KEY, type: 1 }, signedIn: true, nodebook: "out", t, escape });
    expect(links(html)).toEqual([
      ["Add to NodeBook", `https://nodebook.example/node/${KEY}`],
      ["Connect live", `https://app.example/#node=${KEY}`],
    ]);
    expect(nodebookApiUrl(full, KEY)).toBe(`https://nodebook.example/api/nodes/${KEY}`);
    expect(nodebookFetchInit(full, "https://map.example")).toEqual({ credentials: "include" });
    expect(nodebookFetchInit([{ key: "nodebook", label: "N", url: "https://map.example/nodebook/" }], "https://map.example")).toEqual({ credentials: "same-origin" });
    expect(nodebookFetchInit(TOOLS, "https://map.example")).toEqual({ credentials: "same-origin" });
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

describe("the top bar's copy of the tool address check", () => {
  it("matches the shared one", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
    const pattern = (src: string, name: string) => new RegExp(`${name} = (/.*/);`).exec(src)?.[1];
    const shared = read("src/shared/site-urls.js");
    const topbar = read("src/shared/topbar.js");
    expect(pattern(topbar, "TOOL_PATH")).toBe(pattern(shared, "const PATH"));
    expect(pattern(topbar, "TOOL_FULL")).toBe(pattern(shared, "const FULL"));
    expect(pattern(topbar, "DOT_SEGMENT")).toBe(pattern(shared, "const DOT_SEGMENT"));
    expect(pattern(shared, "const FULL")).toBeTruthy();
  });
});
