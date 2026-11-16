import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The account page (account.html + src/account.js) and its top bar, signed in. */

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const run = (f: string) => (0, eval)(read(f));
const body = () => /<body[^>]*>([\s\S]*?)<script/.exec(read("account.html"))![1];
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const $ = (id: string) => document.getElementById(id)!;

type Answer = { status: number; body: unknown };
let account: Answer;
const go = vi.fn();

const NODES = [
  { public_key: "b2".repeat(32), name: "Ann <img src=x>", type: 1 },
  { public_key: "a1".repeat(32), name: "", type: 2 },
];
const NODEBOOK = { key: "nodebook", label: "NodeBook", url: "https://nodebook.example/#/account" };

/** Draws the page from the current `account` answer. */
async function load() {
  document.querySelector("main")!.outerHTML = /<main[\s\S]*<\/main>/.exec(body())![0];
  run("src/account.js");
  (window as unknown as { BEmeshAccount: { go: typeof go } }).BEmeshAccount.go = go;
  await settle();
}

beforeAll(async () => {
  history.replaceState(null, "", "/account");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/v1/account") return { ok: account.status === 200, status: account.status, json: async () => account.body };
      if (url === "/auth/me") return { ok: true, status: 200, json: async () => ({ authenticated: true, user: { username: "ann", global_name: "Ann" } }) };
      return { ok: true, status: 200, json: async () => [] };
    }),
  );
  document.body.innerHTML = body();
  run("src/shared/i18n.js");
  const i18n = (window as unknown as { BEmeshI18n: { add(l: string, d: unknown): void } }).BEmeshI18n;
  i18n.add("en", { ...JSON.parse(read("src/shared/i18n/shared.en.json")), ...JSON.parse(read("src/shared/i18n/account.en.json")) });
  run("src/shared/about.js");
  run("src/shared/menu-place.js");
  run("src/shared/topbar.js");
  await settle();
});

beforeEach(() => {
  go.mockReset();
  account = { status: 200, body: { name: "Ann", nodes: NODES, tools: [NODEBOOK] } };
});

describe("the account page", () => {
  it("shows the name and each claimed node as a link to it on the map", async () => {
    await load();
    expect($("account-title").textContent).toBe("#BEmesh account");
    expect($("account-name").textContent).toBe("Ann");
    const links = Array.from($("account-nodes").querySelectorAll("a"));
    expect(links.map((a) => [a.querySelector(".account-row-name")!.textContent, a.querySelector(".muted")?.textContent, a.getAttribute("href")])).toEqual([
      ["Ann <img src=x>", "Client", `/?node=${"b2".repeat(32)}`],
      ["Unnamed node", "Repeater", `/?node=${"a1".repeat(32)}`],
    ]);
    expect(links[0].title).toBe("Show Ann <img src=x> on the map");
    // Names are text, never markup.
    expect(document.querySelector("main img")).toBeNull();
    expect($("account-nodes").hidden).toBe(false);
    expect($("account-nodes-empty").hidden).toBe(true);
  });

  it("without claimed nodes says so in plain words, with the way to the map", async () => {
    account.body = { name: "Ann", nodes: [], tools: [] };
    await load();
    expect($("account-nodes").hidden).toBe(true);
    const empty = $("account-nodes-empty");
    expect(empty.hidden).toBe(false);
    expect(empty.querySelector("p")!.textContent).toBe("You haven't claimed a node yet. Open your node on the map and choose Claim.");
    expect(empty.querySelector("a")!.getAttribute("href")).toBe("/");
  });

  it("links each tool's account part; NodeBook as My NodeBook fleet", async () => {
    await load();
    expect($("account-tools-card").hidden).toBe(false);
    const a = Array.from($("account-tools").querySelectorAll("a")).map((x) => [x.textContent, x.getAttribute("href"), x.querySelector("i.bi-chevron-right")?.getAttribute("aria-hidden")]);
    expect(a).toEqual([["My NodeBook fleet", "https://nodebook.example/#/account", "true"]]);
  });

  it("hides the tools when there are none, and never links an odd address", async () => {
    account.body = { name: "Ann", nodes: [], tools: [{ key: "x", label: "X", url: "javascript:alert(1)" }] };
    await load();
    expect($("account-tools-card").hidden).toBe(true);
    expect($("account-tools").children.length).toBe(0);
  });

  it("signed out by now: back through sign-in to this page", async () => {
    account = { status: 401, body: { error: "Authentication required" } };
    await load();
    expect(go).toHaveBeenCalledWith("/auth/login?next=/account");
  });

  it("an error says so in plain words", async () => {
    account = { status: 500, body: {} };
    await load();
    expect($("account-name").textContent).toBe("Your account couldn't be loaded. Try again in a moment.");
    expect(go).not.toHaveBeenCalled();
  });

  it("logs out with two forms: this browser, and everywhere with its line under it", () => {
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>("main form"));
    expect(forms.map((f) => [f.getAttribute("method"), f.getAttribute("action"), f.querySelector("button")!.textContent])).toEqual([
      ["post", "/auth/logout", "Log out"],
      ["post", "/auth/logout-everywhere", "Log out everywhere"],
    ]);
    const everywhere = forms[1].querySelector("button")!;
    expect($(everywhere.getAttribute("aria-describedby")!).textContent).toBe("Also on your other devices.");
  });
});

describe("the account page's top bar", () => {
  it("marks no tool as current; Account is current in both menus", () => {
    expect(document.querySelector('.switcher a[aria-current="page"]')).toBeNull();
    expect(document.querySelector('#page-menu a.menu-page[aria-current="page"]')).toBeNull();
    expect($("account-menu").querySelector('a.menu-account')!.getAttribute("aria-current")).toBe("page");
    expect($("page-menu").querySelector('a.menu-account')!.getAttribute("aria-current")).toBe("page");
  });

  it("Log out in the menus returns to the map, not to this page (it needs a sign-in)", () => {
    for (const id of ["account-menu", "page-menu"]) {
      expect($(id).querySelector("form")!.getAttribute("action")).toBe("/auth/logout?next=/");
    }
  });
});
