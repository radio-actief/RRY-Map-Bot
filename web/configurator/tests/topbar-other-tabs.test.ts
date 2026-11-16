import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/** A map page's top bar follows a sign-in or log out in another tab ("bemesh.account.seen"). */

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const run = (f: string) => (0, eval)(read(f));
const header = (page: string) => /<header class="topbar">[\s\S]*?<\/header>/.exec(read(page))![0];
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const ANN = { authenticated: true, user: { id: "1", username: "ann", global_name: "Ann" } };
let me: unknown = ANN;
let asked = 0;
// A plain function, not vi.fn: the test setup clears mocks between tests.
const fetchMock = async (url: string) => {
  if (url === "/auth/me") asked++;
  return { ok: true, json: async () => (url === "/auth/me" ? me : []) };
};
const meCalls = () => asked;
const otherTab = async (key: string, signedIn: boolean) => {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: JSON.stringify({ signedIn }) }));
  await settle();
};

beforeAll(async () => {
  history.replaceState(null, "", "/stats");
  vi.stubGlobal("fetch", fetchMock);
  document.body.innerHTML = header("stats.html");
  run("src/shared/i18n.js");
  run("src/shared/about.js");
  run("src/shared/menu-place.js");
  run("src/shared/topbar.js");
  await settle();
});

describe("another tab signs in or out", () => {
  it("starts signed in", () => {
    expect(document.getElementById("account-toggle")).not.toBeNull();
    expect(meCalls()).toBe(1);
  });

  it("a log out there turns the account button back into Sign in with Discord", async () => {
    me = { authenticated: false };
    await otherTab("bemesh.account.seen", false);
    expect(meCalls()).toBe(2);
    expect(document.getElementById("account-toggle")).toBeNull();
    expect(document.querySelector(".signin-chip")!.getAttribute("href")).toBe("/auth/login?next=/stats");
    expect(document.querySelector("#page-menu .menu-signin")).not.toBeNull();
  });

  it("a sign-in there brings the account button back", async () => {
    me = ANN;
    await otherTab("bemesh.account.seen", true);
    expect(meCalls()).toBe(3);
    expect(document.getElementById("account-toggle")!.textContent).toBe("A");
    expect(document.querySelector(".signin-chip")).toBeNull();
  });

  it("other storage changes ask nothing", async () => {
    await otherTab("configurator.theme", true);
    await otherTab("bemesh.lang", true);
    expect(meCalls()).toBe(3);
  });
});
