import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** The word after a log out (src/shared/logout-notice.js) on a map page with the shared top bar. */

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const run = (f: string) => (0, eval)(read(f));
const header = (page: string) => /<header class="topbar">[\s\S]*?<\/header>/.exec(read(page))![0];

type Notice = { run(): string | null; show(message: string): HTMLElement; SHOW_MS: number };
type I18n = { add(lang: string, dict: Record<string, string>): void; use(lang: string): void };
const notice = () => (window as unknown as { BEmeshLogoutNotice: Notice }).BEmeshLogoutNotice;
const i18n = () => (window as unknown as { BEmeshI18n: I18n }).BEmeshI18n;
const toast = () => document.querySelector<HTMLElement>(".bemesh-toast");
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const SHARED = Object.fromEntries(
  ["en", "nl", "fr"].map((l) => [l, JSON.parse(read(`src/shared/i18n/shared.${l}.json`)) as Record<string, string>]),
);

beforeAll(async () => {
  // Back from Log out on the stats page, with the page's own address parts around the word.
  history.replaceState(null, "", "/stats?preset=eu&logout=success#chart");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({ ok: true, json: async () => (url === "/auth/me" ? { authenticated: false } : []) })),
  );
  document.body.innerHTML = header("stats.html");
  run("src/shared/i18n.js");
  i18n().add("en", SHARED.en);
  run("src/shared/about.js");
  run("src/shared/menu-place.js");
  run("src/shared/logout-notice.js");
  run("src/shared/topbar.js");
  await settle();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("after a log out", () => {
  it("the page says so in a snackbar that screen readers read out", () => {
    const bar = toast()!;
    expect(bar).not.toBeNull();
    expect(bar.hidden).toBe(false);
    expect(bar.getAttribute("role")).toBe("status");
    expect(bar.textContent).toBe("You're logged out.");
    expect(bar.querySelector(".bi")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("takes the word out of the address and keeps the rest", () => {
    expect(location.pathname + location.search + location.hash).toBe("/stats?preset=eu#chart");
    // A reload now says nothing.
    expect(notice().run()).toBeNull();
  });

  it("goes after six seconds", () => {
    vi.useFakeTimers();
    const bar = notice().show("x");
    vi.advanceTimersByTime(notice().SHOW_MS - 1);
    expect(bar.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(bar.hidden).toBe(true);
    expect(notice().SHOW_MS).toBe(6000);
  });

  it("names a log out everywhere", () => {
    history.replaceState(null, "", "/?logout=everywhere");
    expect(notice().run()).toBe("You're logged out everywhere.");
    expect(toast()!.textContent).toBe("You're logged out everywhere.");
    expect(location.search).toBe("");
    // One snackbar, reused.
    expect(document.querySelectorAll(".bemesh-toast").length).toBe(1);
  });

  it.each([
    ["nl", "Je bent afgemeld.", "Je bent overal afgemeld."],
    ["fr", "Vous êtes déconnecté.", "Vous êtes déconnecté partout."],
  ])("speaks %s", (lang, done, everywhere) => {
    i18n().add(lang, SHARED[lang]);
    i18n().use(lang);
    history.replaceState(null, "", "/?logout=success");
    expect(notice().run()).toBe(done);
    history.replaceState(null, "", "/?logout=everywhere");
    expect(notice().run()).toBe(everywhere);
    i18n().use("en");
  });

  it("an unknown word is taken out of the address and shows nothing", () => {
    const before = toast()!.textContent;
    history.replaceState(null, "", "/region-map?logout=<b>hi</b>");
    expect(notice().run()).toBeNull();
    expect(location.search).toBe("");
    expect(toast()!.textContent).toBe(before);
  });
});
