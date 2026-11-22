import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** The configurator on its own address: the four links from the server's <meta name="bemesh-site">,
 * the account on the map's address, and the map's device hub. */

const MAP = "https://map.example";
const LINKS = {
  pages: { map: `${MAP}/`, stats: "https://stats.example/", regionMap: `${MAP}/region-map`, configurator: "/" },
  map: MAP,
  hub: `${MAP}/device-hub.html`,
};

let mod: typeof import("../src/app/AccountMenu");
let pages: typeof import("../src/app/pages");
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const meta = document.createElement("meta");
  meta.name = "bemesh-site";
  meta.setAttribute("content", JSON.stringify(LINKS));
  document.head.appendChild(meta);
  vi.resetModules();
  pages = await import("../src/app/pages");
  mod = await import("../src/app/AccountMenu");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mod.resetAccount();
});

const me = (body: unknown) => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
};

describe("the configurator on its own address", () => {
  it("takes the four links and the hub from the server", () => {
    expect(pages.PAGES.map(([href, , page]) => [page, href])).toEqual([
      ["map", `${MAP}/`],
      ["stats", "https://stats.example/"],
      ["regionMap", `${MAP}/region-map`],
      ["configurator", "/"],
    ]);
    expect(pages.MAP).toBe(MAP);
    expect(pages.SITE?.hub).toBe(`${MAP}/device-hub.html`);
    expect(pages.selfUrl()).toBe(`${location.origin}/`);
  });

  it("asks the map who is signed in and signs in there, back here", async () => {
    me({ authenticated: false });
    render(<mod.AccountMenu />);
    await waitFor(() => expect(document.querySelector(".signin-chip")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(`${MAP}/auth/me`, { credentials: "include" });
    const links = screen.getAllByRole("link", { name: "Sign in with Discord", hidden: true });
    for (const a of links) expect(a.getAttribute("href")).toBe(`${MAP}/auth/login?next=${encodeURIComponent(`${location.origin}/`)}`);
  });

  it("links the account to the map and logs out through the map's sign-out page", async () => {
    me({ authenticated: true, user: { username: "tester", global_name: "Tess" } });
    render(<mod.AccountMenu />);
    await screen.findAllByText("@tester");
    const menu = document.getElementById("account-menu")!;
    expect(menu.querySelector("a.menu-account")?.getAttribute("href")).toBe(`${MAP}/account`);
    const form = menu.querySelector("form.menu-logout")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe(`${MAP}/auth/signout`);
    expect(form.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe(`${location.origin}/`);
    const current = document.querySelector('#page-menu a[aria-current="page"]');
    expect(current?.getAttribute("href")).toBe("/");
  });
});
