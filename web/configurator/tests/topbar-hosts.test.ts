import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** The top bar (src/shared/topbar.js) of a page on an address of its own: its four links come from
 * the server's <meta name="bemesh-site">, and the account, sign in and log out go to the map. */

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const run = (f: string) => (0, eval)(read(f));
const header = (page: string) => /<header class="topbar">[\s\S]*?<\/header>/.exec(read(page))![0];
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const hrefs = (sel: string) => Array.from(document.querySelectorAll(sel)).map((a) => a.getAttribute("href"));

const MAP = "https://map.example";
const LINKS = {
  pages: { map: `${MAP}/`, stats: "/", regionMap: "https://regions.example/", configurator: `${MAP}/configurator` },
  map: MAP,
};

async function stats(signedIn: boolean) {
  history.replaceState(null, "", "/");
  document.documentElement.setAttribute("data-bemesh-page", "stats");
  const meta = document.createElement("meta");
  meta.name = "bemesh-site";
  meta.setAttribute("content", JSON.stringify(LINKS));
  document.head.appendChild(meta);
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => ({
    ok: true,
    json: async () =>
      url.endsWith("/auth/me") ? (signedIn ? { authenticated: true, user: { username: "ann", global_name: "Ann" } } : { authenticated: false }) : [],
  }));
  vi.stubGlobal("fetch", fetchMock);
  document.body.innerHTML = header("stats.html");
  run("src/shared/i18n.js");
  run("src/shared/about.js");
  run("src/shared/menu-place.js");
  run("src/shared/topbar.js");
  await settle();
  return fetchMock;
}

describe("the top bar on a page's own address", () => {
  it("links the four pages as the server says, marks this one, and asks the map who is signed in", async () => {
    const fetchMock = await stats(false);
    expect(hrefs(".topbar .switcher a")).toEqual([`${MAP}/`, "/", "https://regions.example/", `${MAP}/configurator`]);
    expect(hrefs("#page-menu a.menu-page")).toEqual([`${MAP}/`, "/", "https://regions.example/", `${MAP}/configurator`]);
    expect(document.querySelector('#page-menu a[aria-current="page"]')?.textContent).toBe("Stats");
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(`${MAP}/auth/me`);
    expect(fetchMock.mock.calls.find((c) => c[0] === `${MAP}/auth/me`)?.[1]).toEqual({ credentials: "include" });
    // Sign in on the map's address, back to this page's own.
    const next = encodeURIComponent(`${location.origin}/`);
    expect(document.querySelector(".signin-chip")?.getAttribute("href")).toBe(`${MAP}/auth/login?next=${next}`);
    expect(document.querySelector("a.menu-signin")?.getAttribute("href")).toBe(`${MAP}/auth/login?next=${next}`);
  });
});
