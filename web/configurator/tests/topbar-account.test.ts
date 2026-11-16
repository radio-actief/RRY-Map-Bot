import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/** Signed in on a tool page (src/shared/topbar.js): the account button and its menu, and Account in ☰. */

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const run = (f: string) => (0, eval)(read(f));
const header = (page: string) => /<header class="topbar">[\s\S]*?<\/header>/.exec(read(page))![0];

type Topbar = { closeMenus(): void };
const topbar = () => (window as unknown as { BEmeshTopbar: Topbar }).BEmeshTopbar;
const button = () => document.getElementById("account-toggle") as HTMLButtonElement;
const accountMenu = () => document.getElementById("account-menu")!;
const pageMenu = () => document.getElementById("page-menu")!;
const click = (el: HTMLElement, detail = 1) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));
const rows = (menu: HTMLElement) =>
  Array.from(menu.children).map((el) =>
    el.tagName === "HR" ? "|" : el.tagName === "FORM" ? `${el.textContent} → POST ${el.getAttribute("action")}` : `${el.textContent}${el.getAttribute("href") ? ` → ${el.getAttribute("href")}` : ""}`,
  );

beforeAll(async () => {
  history.replaceState(null, "", "/region-map");
  const answers: Record<string, unknown> = {
    "/auth/me": { authenticated: true, user: { id: "1", username: "ann", global_name: "Ann <b>Ö</b>" } },
    "/api/v1/site-tools": [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({ ok: true, json: async () => answers[url] })),
  );
  document.body.innerHTML = header("region-map.html");
  run("src/shared/i18n.js");
  run("src/shared/about.js");
  run("src/shared/menu-place.js");
  run("src/shared/topbar.js");
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
});

describe("signed in, the top bar's account button", () => {
  it("takes the sign-in chip's place: a circle with the initial, named for screen readers", () => {
    expect(document.querySelector(".signin-chip")).toBeNull();
    const b = button();
    expect(b.closest("[data-account-chip]")).not.toBeNull();
    expect(b.classList.contains("icon")).toBe(true);
    expect(b.textContent).toBe("A");
    expect(b.querySelector(".account-initial")?.getAttribute("aria-hidden")).toBe("true");
    expect(b.getAttribute("aria-label")).toBe("Account: Ann <b>Ö</b>");
    expect(b.getAttribute("aria-haspopup")).toBe("true");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(b.querySelector("img")).toBeNull();
  });

  it("opens a small menu: the name, My nodes, Account, Log out (back to this page)", () => {
    click(button());
    expect(accountMenu().hidden).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(rows(accountMenu())).toEqual([
      "Ann <b>Ö</b>",
      "My nodes → /account#my-nodes",
      "Account → /account",
      "|",
      "Log out → POST /auth/logout?next=/region-map",
    ]);
    // The name is text, never markup.
    expect(accountMenu().querySelector("b")).toBeNull();
    expect(accountMenu().querySelector("form")!.getAttribute("method")).toBe("post");
    topbar().closeMenus();
    expect(accountMenu().hidden).toBe(true);
  });

  it("a click leaves the focus on the button; Enter or Space moves it to the first row", () => {
    button().focus();
    click(button());
    expect(document.activeElement).toBe(button());
    topbar().closeMenus();
    click(button(), 0);
    expect(document.activeElement?.textContent).toBe("My nodes");
    topbar().closeMenus();
  });

  it("stays inside the window", () => {
    const at = (left: number) => () => ({ left, right: left + 220, top: 46, bottom: 246, width: 220, height: 200, x: left, y: 46 }) as DOMRect;
    Object.defineProperty(accountMenu(), "getBoundingClientRect", { configurable: true, value: at(-60) });
    click(button());
    expect(accountMenu().style.right).toBe("-68px");
    topbar().closeMenus();
  });

  it("Escape closes it and puts the focus back on the button", () => {
    click(button());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(accountMenu().hidden).toBe(true);
    expect(document.activeElement).toBe(button());
  });

  it("one menu at a time: ☰ closes the account menu and the account button closes ☰", () => {
    const menuButton = document.getElementById("menu-toggle") as HTMLButtonElement;
    click(button());
    click(menuButton);
    expect(accountMenu().hidden).toBe(true);
    expect(pageMenu().hidden).toBe(false);
    click(button());
    expect(pageMenu().hidden).toBe(true);
    expect(accountMenu().hidden).toBe(false);
    topbar().closeMenus();
  });
});

describe("signed in, the ☰ menu", () => {
  it("keeps the account: the user name, then Account, then Log out", () => {
    const user = pageMenu().querySelector(".menu-user")!;
    const account = user.nextElementSibling!;
    expect(account.textContent).toBe("Account");
    expect(account.getAttribute("href")).toBe("/account");
    expect(account.nextElementSibling!.tagName).toBe("FORM");
    expect(account.nextElementSibling!.getAttribute("action")).toBe("/auth/logout?next=/region-map");
  });
});

describe("the account words", () => {
  const dict = (f: string) => JSON.parse(read(f)) as Record<string, string>;
  it("name the button in every language, with French's space before the colon", () => {
    const label = ["en", "nl", "fr"].map((l) => dict(`src/shared/i18n/shared.${l}.json`)["account.label"]);
    expect(label).toEqual(["Account: {name}", "Account: {name}", "Compte : {name}"]);
  });

  it("are the Designer's, sentence case; the menu says Account, the page heading names #BEmesh", () => {
    const words = (scope: string, key: string) => ["en", "nl", "fr"].map((l) => dict(`src/shared/i18n/${scope}.${l}.json`)[key]);
    expect(words("shared", "menu.signIn")).toEqual(["Sign in with Discord", "Aanmelden met Discord", "Se connecter avec Discord"]);
    expect(words("shared", "account.title")).toEqual(["Account", "Account", "Compte"]);
    expect(words("shared", "menu.myNodes")).toEqual(["My nodes", "Mijn nodes", "Mes nœuds"]);
    expect(words("shared", "menu.logOut")).toEqual(["Log out", "Afmelden", "Se déconnecter"]);
    expect(words("account", "account.logOutEverywhere")).toEqual(["Log out everywhere", "Overal afmelden", "Se déconnecter partout"]);
    expect(words("account", "account.everywhereHint")).toEqual(["Also on your other devices.", "Ook op je andere apparaten.", "Aussi sur vos autres appareils."]);
    expect(words("account", "account.nodebook")).toEqual(["My NodeBook fleet", "Mijn NodeBook-vloot", "Ma flotte NodeBook"]);
    expect(words("account", "account.heading")).toEqual(["#BEmesh account", "#BEmesh-account", "Compte #BEmesh"]);
  });
});
