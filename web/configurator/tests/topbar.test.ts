import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/** The top bar of the map, stats and region map pages (src/shared/topbar.js, a classic script). */

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const run = (f: string) => (0, eval)(read(f));
const header = (page: string) => /<header class="topbar">[\s\S]*?<\/header>/.exec(read(page))![0];

type Topbar = { init(): Promise<void>; closeMenus(): void; siteTools(): Promise<unknown[]> };
const topbar = () => (window as unknown as { BEmeshTopbar: Topbar }).BEmeshTopbar;
const menu = () => document.getElementById("page-menu")!;
const toggle = () => document.getElementById("menu-toggle") as HTMLButtonElement;
const LINKS = JSON.parse(read("src/shared/bemesh-links.json")) as { label: string; href: string }[];
const TOOLS = [
  { key: "nodebook", label: "NodeBook", url: "https://nodebook.example/" },
  { key: "meshmate", label: "MeshMate", url: "https://meshmate.example/" },
];

/** The menu's rows as groups, in order, with "|" for a divider. */
function groups(): string[] {
  const out: string[] = [];
  for (const el of Array.from(menu().children)) {
    const name =
      el.tagName === "HR"
        ? "|"
        : el.classList.contains("menu-page")
          ? "tools"
          : el.getAttribute("target") === "_blank"
            ? "links"
            : el.classList.contains("menu-about")
              ? "about"
              : el.classList.contains("lang-switch")
                ? "language"
                : "account";
    if (out[out.length - 1] !== name || name === "|") out.push(name);
  }
  return out;
}

/** Answers for /auth/me and /api/v1/site-tools, held back until the test lets them through. */
const answers = new Map<string, (body: unknown) => void>();
const answer = async (url: string, body: unknown) => {
  answers.get(url)!(body);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeAll(() => {
  history.replaceState(null, "", "/region-map");
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => new Promise((res) => answers.set(url, (body) => res({ ok: true, json: async () => body })))),
  );
  document.body.innerHTML = header("region-map.html");
  run("src/shared/i18n.js");
  run("src/shared/about.js");
  run("src/shared/menu-place.js");
  run("src/shared/topbar.js");
});

describe("the ☰ menu on the tool pages", () => {
  it("shows the tools, links, About and the language at once, before the network answers", () => {
    expect(answers.has("/auth/me")).toBe(true);
    expect(groups()).toEqual(["tools", "|", "links", "about", "|", "language"]);
    const links = Array.from(menu().querySelectorAll('a[target="_blank"]')).map((a) => [a.textContent?.replace(/\s*↗$/, ""), a.getAttribute("href")]);
    expect(links).toEqual(LINKS.map((l) => [l.label, l.href]));
  });

  it("adds the account and the site's tools when they arrive: tools, links, About, account, language", async () => {
    await answer("/auth/me", { authenticated: false });
    await answer("/api/v1/site-tools", TOOLS);
    expect(groups()).toEqual(["tools", "|", "links", "about", "|", "account", "|", "language"]);
    const tools = Array.from(menu().querySelectorAll("a.menu-page")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(tools).toEqual([
      ["Map", "/"],
      ["Stats", "/stats"],
      ["Region map", "/region-map"],
      ["Configurator", "/configurator"],
      ["NodeBook", "https://nodebook.example/"],
      ["MeshMate", "https://meshmate.example/"],
    ]);
    const here = menu().querySelector('a[aria-current="page"]')!;
    expect(here.getAttribute("href")).toBe("/region-map");
    expect(here.querySelector("i.bi-check-lg")?.getAttribute("aria-hidden")).toBe("true");
    expect(menu().querySelector("a.menu-signin")?.getAttribute("href")).toBe("/auth/login?next=/region-map");
    // The other tools' hubs follow: the page records whether someone is signed in.
    expect(JSON.parse(localStorage.getItem("bemesh.account.seen") ?? "null")).toEqual({ signedIn: false });
    // The switcher: the four pages, then NodeBook and MeshMate.
    expect(Array.from(document.querySelectorAll(".topbar .switcher a")).map((a) => a.textContent)).toEqual([
      "Map",
      "Stats",
      "Region map",
      "Configurator",
      "NodeBook",
      "MeshMate",
    ]);
  });

  it("marks the page language with aria-pressed, in the bar and in the menu", () => {
    for (const group of Array.from(document.querySelectorAll(".lang-switch"))) {
      const pressed = Array.from(group.querySelectorAll("button")).map((b) => [b.textContent, b.getAttribute("aria-pressed")]);
      expect(pressed).toEqual([
        ["EN", "true"],
        ["NL", "false"],
        ["FR", "false"],
      ]);
    }
    expect(document.querySelectorAll(".lang-switch").length).toBe(2);
  });

  it("a click opens it without moving the focus; Enter or Space moves the focus to the first row", () => {
    toggle().focus();
    toggle().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(menu().hidden).toBe(false);
    expect(document.activeElement).toBe(toggle());
    topbar().closeMenus();
    toggle().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(menu().hidden).toBe(false);
    expect(document.activeElement).toBe(menu().querySelector("a"));
    topbar().closeMenus();
  });

  it("never leaves the window: opened near the left edge it moves right, near the right edge left", () => {
    const at = (left: number, top = 46, height = 300) => () => ({ left, right: left + 220, top, bottom: top + height, width: 220, height, x: left, y: top }) as DOMRect;
    const width = window.innerWidth;
    Object.defineProperty(menu(), "getBoundingClientRect", { configurable: true, value: at(-160) });
    toggle().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(menu().style.right).toBe("-168px");
    topbar().closeMenus();
    Object.defineProperty(menu(), "getBoundingClientRect", { configurable: true, value: at(width - 100) });
    toggle().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(menu().style.right).toBe("128px");
    topbar().closeMenus();
    Object.defineProperty(menu(), "getBoundingClientRect", { configurable: true, value: at(100, 46, 5000) });
    toggle().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(menu().style.right).toBe("");
    expect(menu().style.maxHeight).toBe(`${window.innerHeight - 46 - 8}px`);
    topbar().closeMenus();
  });

  it("keeps the menu's links the same as bemesh-links.json", () => {
    const copy = /var LINKS = (\[[\s\S]*?\]);/.exec(read("src/shared/topbar.js"))![1];
    expect((0, eval)(copy)).toEqual(JSON.parse(read("src/shared/bemesh-links.json")));
  });
});

describe("the top bar's markup on the tool pages", () => {
  const GLYPHS = /[☰◐⬇▾🛠📍]|\p{Extended_Pictographic}/u;
  for (const page of ["index.html", "stats.html", "region-map.html"]) {
    it(`${page}: Bootstrap icons, no text glyphs or emoji`, () => {
      const bar = new DOMParser().parseFromString(header(page), "text/html").body;
      expect(bar.textContent).not.toMatch(GLYPHS);
      const icons = Array.from(bar.querySelectorAll("button.icon"));
      expect(icons.length).toBeGreaterThanOrEqual(2);
      for (const b of icons) {
        expect(b.querySelector("i.bi")?.getAttribute("aria-hidden")).toBe("true");
        expect(b.getAttribute("aria-label")).toBeTruthy();
      }
      expect(bar.querySelector("[data-theme-toggle] i.bi-circle-half")).not.toBeNull();
      expect(bar.querySelector("[data-page-menu] button i.bi-list")).not.toBeNull();
      expect(read(page)).toContain('href="./lib/css/bootstrap-icons.css"');
    });
  }

  it("stats: the Preset chip sits before the flexible space, the actions after it", () => {
    const bar = new DOMParser().parseFromString(header("stats.html"), "text/html").body.firstElementChild!;
    const order = Array.from(bar.children).map((el) => el.id || el.className);
    expect(order.indexOf("stats-filter-menu")).toBeLessThan(order.indexOf("spacer"));
    expect(order.indexOf("spacer")).toBeLessThan(order.indexOf("stats-download-chip"));
  });

  it("the configurator links the icon font too", () => {
    expect(read("web/configurator/index.html")).toMatch(/<link rel="stylesheet" href="\/lib\/css\/bootstrap-icons.css" vite-ignore \/>/);
  });
});

describe("the top bar's texts", () => {
  const dict = (f: string) => JSON.parse(read(f)) as Record<string, string>;
  const WORDMARKS: Record<string, [string, string, string]> = {
    map: ["mesh map", "mesh kaart", "mesh carte"],
    stats: ["mesh stats", "mesh statistieken", "mesh statistiques"],
    "region-map": ["mesh region map", "mesh regiokaart", "mesh carte des régions"],
  };
  const KEY: Record<string, string> = { map: "map.wordmark", stats: "stats.wordmark", "region-map": "regionMap.wordmark" };

  it("the wordmark names the page in the page language, lower case", () => {
    for (const [page, want] of Object.entries(WORDMARKS)) {
      const got = ["en", "nl", "fr"].map((l) => dict(`src/shared/i18n/${page}.${l}.json`)[KEY[page]]);
      expect(got).toEqual(want);
    }
    const tail = ["en", "nl", "fr"].map((l) => dict(`web/configurator/src/i18n/${l}.json`)["app.nameTail"]);
    expect(tail).toEqual([" configurator", " configurator", " configurateur"]);
  });

  it("stats: the Preset chip and the tiles' Loading… are translated", () => {
    const [en, nl, fr] = ["en", "nl", "fr"].map((l) => dict(`src/shared/i18n/stats.${l}.json`));
    expect([en["stats.presetAll"], nl["stats.presetAll"], fr["stats.presetAll"]]).toEqual(["Preset: All", "Preset: Alle", "Préréglage : Tous"]);
    expect([en["stats.tile.loading"], nl["stats.tile.loading"], fr["stats.tile.loading"]]).toEqual(["Loading…", "Laden…", "Chargement…"]);
    expect([fr["stats.type.plural.1"], fr["stats.tile.3"]]).toEqual(["Companions", "Rooms"]);
    const html = read("stats.html");
    expect(html).toContain('<span id="stats-preset-label" data-i18n="stats.presetAll">');
    expect(html).not.toMatch(/class="tile-value"[^>]*>—/);
  });
});
