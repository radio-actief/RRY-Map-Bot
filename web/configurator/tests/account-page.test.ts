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
/** What the POST endpoints answer, by URL (200 {} when not set). */
let posted: Record<string, Answer> = {};
const posts: { url: string; body: unknown }[] = [];
const go = vi.fn();
const ask = vi.fn(() => true);
const copy = vi.fn(async () => {});

const NODES = [
  { public_key: "b2".repeat(32), name: "Ann <img src=x>", type: 1 },
  { public_key: "a1".repeat(32), name: "", type: 2 },
];
const NODEBOOK = { key: "nodebook", label: "NodeBook", url: "https://nodebook.example/#/account" };

/** Draws the page from the current `account` answer. */
async function load() {
  document.querySelector("main")!.outerHTML = /<main[\s\S]*<\/main>/.exec(body())![0];
  run("src/account.js");
  const page = (window as unknown as { BEmeshAccount: { go: typeof go; confirm: typeof ask; copy: typeof copy } }).BEmeshAccount;
  page.go = go;
  page.confirm = ask;
  page.copy = copy;
  await settle();
}

beforeAll(async () => {
  history.replaceState(null, "", "/account");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(init.body || "{}") });
        const a = posted[url] ?? { status: 200, body: {} };
        return { ok: a.status === 200, status: a.status, json: async () => a.body };
      }
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
  ask.mockReset();
  ask.mockReturnValue(true);
  copy.mockClear();
  posted = {};
  posts.length = 0;
  account = { status: 200, body: { name: "Ann", nodes: NODES, tools: [NODEBOOK], settings: { show_name: true, share_partners: true } } };
});

describe("the account page", () => {
  it("shows the name and each claimed node as a link to it on the map", async () => {
    await load();
    expect($("account-title").textContent).toBe("#BEmesh account");
    expect($("account-name").textContent).toBe("Ann");
    const links = Array.from($("account-nodes").querySelectorAll("a"));
    expect(links.map((a) => [a.querySelector(".account-row-name")!.textContent, a.querySelector(".muted")?.textContent, a.getAttribute("href")])).toEqual([
      ["Ann <img src=x>", "Companion", `/?node=${"b2".repeat(32)}`],
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
    const open = empty.querySelector("a")!;
    expect([open.getAttribute("href"), open.className]).toEqual(["/", "btn primary"]);
    expect(empty.querySelectorAll("a, button").length).toBe(1);
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

  it("shows the two privacy choices as switches, each with its one line under it", async () => {
    account.body = { ...(account.body as object), settings: { show_name: false, share_partners: true } };
    await load();
    expect($("account-privacy").hidden).toBe(false);
    expect($("account-privacy-title").textContent).toBe("Privacy");
    const rows = Array.from($("account-privacy").querySelectorAll<HTMLInputElement>("input[data-choice]")).map((i) => [
      i.getAttribute("role"),
      document.querySelector(`label[for="${i.id}"]`)!.textContent,
      $(i.getAttribute("aria-describedby")!).textContent,
      i.checked,
    ]);
    expect(rows).toEqual([
      ["switch", "Show my name with my nodes", "Off: the map and partner tools show your nodes as claimed, without your name.", false],
      ["switch", "Share my nodes with partner tools", "Off: partner tools don't see which nodes you own or manage. They never get your Discord account.", true],
    ]);
  });

  it("saves a choice as soon as it is switched, and says so", async () => {
    await load();
    const share = $("choice-share-partners") as HTMLInputElement;
    share.checked = false;
    share.dispatchEvent(new Event("change"));
    await settle();
    expect(posts).toEqual([{ url: "/api/v1/account/settings", body: { share_partners: false } }]);
    expect(share.checked).toBe(false);
    expect(share.disabled).toBe(false);
    expect($("account-choice-status").textContent).toBe("Saved.");
  });

  it("a choice that couldn't be saved switches back and says so", async () => {
    posted["/api/v1/account/settings"] = { status: 500, body: {} };
    await load();
    const name = $("choice-show-name") as HTMLInputElement;
    name.checked = false;
    name.dispatchEvent(new Event("change"));
    await settle();
    expect(name.checked).toBe(true);
    expect($("account-choice-status").textContent).toBe("Couldn't save. Try again in a moment.");
    expect($("account-choice-status").classList.contains("bad")).toBe(true);
  });

  it("shows each node's role; under an owned node its managers and Invite a manager", async () => {
    account.body = {
      ...(account.body as object),
      nodes: [
        { public_key: "a1".repeat(32), name: "Ann relay", type: 2, role: "owner", managers: [{ id: 7, name: "Bob <b>" }] },
        { public_key: "d4".repeat(32), name: "Cat relay", type: 2, role: "manager" },
      ],
    };
    await load();
    const items = Array.from($("account-nodes").children) as HTMLElement[];
    expect(items.map((li) => li.querySelector(".account-role")!.textContent)).toEqual(["Owner", "Manager"]);
    const owned = items[0];
    expect(owned.querySelector(".account-managers-title")!.textContent).toBe("Managers");
    expect(Array.from(owned.querySelectorAll(".account-manager-name")).map((x) => x.textContent)).toEqual(["Bob <b>"]);
    expect(owned.querySelector("b")).toBeNull();
    const remove = owned.querySelector<HTMLButtonElement>(".account-remove")!;
    expect([remove.textContent, remove.getAttribute("aria-label")]).toEqual(["Remove", "Remove Bob <b> as manager"]);
    expect(owned.querySelector(".account-invite-btn")!.textContent).toBe("Invite a manager");
    expect(owned.querySelector(".account-leave")).toBeNull();
    const managed = items[1];
    expect(managed.querySelector(".account-leave")!.textContent).toBe("Stop managing");
    expect(managed.querySelector(".account-invite-btn, .account-remove")).toBeNull();
  });

  it("Invite a manager makes a one-time link to copy", async () => {
    account.body = { ...(account.body as object), nodes: [{ public_key: "a1".repeat(32), name: "Ann relay", type: 2, role: "owner", managers: [] }] };
    posted[`/api/v1/nodes/${"a1".repeat(32)}/invites`] = { status: 200, body: { path: "/invite/tok_en", expires_at: "2026-11-24T10:00:00Z" } };
    await load();
    expect(document.querySelector(".account-managers")).toBeNull();
    (document.querySelector(".account-invite-btn") as HTMLButtonElement).click();
    await settle();
    expect(posts.map((p) => p.url)).toEqual([`/api/v1/nodes/${"a1".repeat(32)}/invites`]);
    const box = document.querySelector<HTMLElement>(".account-invite")!;
    expect(box.hidden).toBe(false);
    const input = box.querySelector<HTMLInputElement>("input")!;
    expect([input.value, input.readOnly, input.getAttribute("aria-label")]).toEqual([`${location.origin}/invite/tok_en`, true, "Invitation link"]);
    expect(box.querySelector(".account-invite-hint")!.textContent).toBe("Send this link to one person. It works once, for 7 days.");
    (box.querySelector(".account-copy") as HTMLButtonElement).click();
    await settle();
    expect(copy).toHaveBeenCalledWith(`${location.origin}/invite/tok_en`);
    expect(document.querySelector(".account-node-tools .account-status")!.textContent).toBe("Copied.");
  });

  it("too many open invitations says so", async () => {
    account.body = { ...(account.body as object), nodes: [{ public_key: "a1".repeat(32), name: "Ann relay", type: 2, role: "owner", managers: [] }] };
    posted[`/api/v1/nodes/${"a1".repeat(32)}/invites`] = { status: 429, body: { error: "too_many_invites" } };
    await load();
    (document.querySelector(".account-invite-btn") as HTMLButtonElement).click();
    await settle();
    expect(document.querySelector<HTMLElement>(".account-invite")!.hidden).toBe(true);
    expect(document.querySelector(".account-node-tools .account-status")!.textContent).toBe("This node has 10 open invitations. Wait until one is used or expires.");
  });

  it("removing a manager asks first, then loads the page again", async () => {
    account.body = { ...(account.body as object), nodes: [{ public_key: "a1".repeat(32), name: "Ann relay", type: 2, role: "owner", managers: [{ id: 7, name: "Bob" }] }] };
    await load();
    ask.mockReturnValueOnce(false);
    (document.querySelector(".account-remove") as HTMLButtonElement).click();
    await settle();
    expect(ask).toHaveBeenCalledWith("Remove Bob as manager of Ann relay?");
    expect(posts).toEqual([]);
    account.body = { ...(account.body as object), nodes: [{ public_key: "a1".repeat(32), name: "Ann relay", type: 2, role: "owner", managers: [] }] };
    (document.querySelector(".account-remove") as HTMLButtonElement).click();
    await settle();
    expect(posts.map((p) => p.url)).toEqual([`/api/v1/nodes/${"a1".repeat(32)}/managers/7/remove`]);
    expect(document.querySelector(".account-remove")).toBeNull();
  });

  it("a manager can stop managing, after a question", async () => {
    account.body = { ...(account.body as object), nodes: [{ public_key: "d4".repeat(32), name: "Cat relay", type: 2, role: "manager" }] };
    await load();
    account.body = { ...(account.body as object), nodes: [] };
    (document.querySelector(".account-leave") as HTMLButtonElement).click();
    await settle();
    expect(ask).toHaveBeenCalledWith("Stop managing Cat relay? The owner can invite you again.");
    expect(posts.map((p) => p.url)).toEqual([`/api/v1/nodes/${"d4".repeat(32)}/leave`]);
    expect($("account-nodes-empty").hidden).toBe(false);
  });

  it("logs out with two forms: this browser, and everywhere with its line under it", () => {
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>("main form"));
    expect(forms.map((f) => [f.getAttribute("method"), f.getAttribute("action"), f.querySelector("button")!.textContent])).toEqual([
      ["post", "/auth/logout", "Log out"],
      ["post", "/auth/logout-everywhere", "Log out everywhere"],
    ]);
    const everywhere = forms[1].querySelector("button")!;
    expect($(everywhere.getAttribute("aria-describedby")!).textContent).toBe("Also on your other devices.");
    // Side by side, the line under the pair (stacked on a phone in css/account.css).
    expect(forms[0].parentElement).toBe(forms[1].parentElement);
    expect(forms[0].parentElement!.nextElementSibling!.id).toBe("account-everywhere-hint");
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
