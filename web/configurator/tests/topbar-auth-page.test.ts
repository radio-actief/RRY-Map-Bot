import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/** The top bar on the sign-out and failed pages (served by backend/api/app.py, _top_bar): the bar of
 * the other pages without the account part, and no page marked as the current one. */

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const run = (f: string) => (0, eval)(read(f));
const app = read("backend/api/app.py");

beforeAll(async () => {
  history.replaceState(null, "", "/auth/signout?next=%2Fstats");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url === "/auth/me"
          ? { authenticated: true, user: { id: "1", username: "ann", global_name: "Ann" } }
          : [{ key: "nodebook", label: "NodeBook", url: "https://nodebook.example/" }],
    })),
  );
  // The same slots the server writes.
  expect(app).toContain("'<span class=\"menu-wrap\" data-page-menu data-no-account>'");
  document.body.innerHTML = `<header class="topbar">
    <span class="wordmark"><b>#BE</b><span>mesh</span></span>
    <nav class="switcher" aria-label="Pages"><a href="/" data-i18n="page.map">Map</a></nav>
    <span class="spacer"></span>
    <span data-lang-switch></span>
    <span class="menu-wrap" data-page-menu data-no-account><button type="button" class="icon" aria-label="Menu"><i class="bi bi-list" aria-hidden="true"></i></button><nav class="menu page-menu" aria-label="Menu" hidden></nav></span>
    <button type="button" class="icon" data-theme-toggle aria-label="Theme"></button>
  </header>`;
  run("src/shared/i18n.js");
  run("src/shared/about.js");
  run("src/shared/menu-place.js");
  run("src/shared/topbar.js");
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
});

describe("the bar on the sign-out and failed pages", () => {
  it("has the pages, the site's tools, the links and the language in ☰, but no account", () => {
    const menu = document.getElementById("page-menu")!;
    expect(Array.from(menu.querySelectorAll("a.menu-page")).map((a) => a.getAttribute("href"))).toEqual([
      "/", "/stats", "/region-map", "/configurator", "https://nodebook.example/",
    ]);
    expect(menu.querySelector(".lang-switch")).not.toBeNull();
    expect(menu.querySelector(".menu-user, .menu-logout, .menu-signin")).toBeNull();
    expect(document.getElementById("account-toggle")).toBeNull();
  });

  it("marks no page as the current one", () => {
    expect(document.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("adds the site's tools to the switcher", () => {
    expect(document.querySelector('.switcher [data-site-tool="nodebook"]')!.getAttribute("href")).toBe("https://nodebook.example/");
  });
});
