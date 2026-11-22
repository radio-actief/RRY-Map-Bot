import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Signed in on a page on its own address: Account on the map, log out through the map's sign-out page. */

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const run = (f: string) => (0, eval)(read(f));
const header = (page: string) => /<header class="topbar">[\s\S]*?<\/header>/.exec(read(page))![0];
const MAP = "https://map.example";

describe("signed in on a page's own address", () => {
  it("links the account to the map and logs out through the map's sign-out page", async () => {
    history.replaceState(null, "", "/");
    document.documentElement.setAttribute("data-bemesh-page", "regionMap");
    const meta = document.createElement("meta");
    meta.name = "bemesh-site";
    meta.setAttribute("content", JSON.stringify({ pages: { map: `${MAP}/`, stats: `${MAP}/stats`, regionMap: "/", configurator: `${MAP}/configurator` }, map: MAP }));
    document.head.appendChild(meta);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({ ok: true, json: async () => (url.endsWith("/auth/me") ? { authenticated: true, user: { username: "ann", global_name: "Ann" } } : []) })),
    );
    document.body.innerHTML = header("region-map.html");
    run("src/shared/i18n.js");
    run("src/shared/about.js");
    run("src/shared/menu-place.js");
    run("src/shared/topbar.js");
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    const menu = document.getElementById("account-menu")!;
    expect(menu.querySelector("a.menu-account")?.getAttribute("href")).toBe(`${MAP}/account`);
    expect(menu.querySelector("a.menu-account-nodes")?.getAttribute("href")).toBe(`${MAP}/account#my-nodes`);
    const form = menu.querySelector("form.menu-logout") as HTMLFormElement;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe(`${MAP}/auth/signout`);
    expect((form.querySelector('input[name="next"]') as HTMLInputElement).value).toBe(`${location.origin}/`);
    expect(document.querySelector('#page-menu a[aria-current="page"]')?.getAttribute("href")).toBe("/");
  });
});
