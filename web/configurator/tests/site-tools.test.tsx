import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu, resetAccount } from "../src/app/AccountMenu";
import { loadSiteTools, siteTools } from "../src/app/pages";
import { PageSwitcher } from "../src/app/TopBar";

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

beforeEach(() => {
  resetAccount();
  siteTools.value = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  siteTools.value = [];
});

describe("site tools", () => {
  it("keeps listed tools besides the four pages, in order", async () => {
    await loadSiteTools(
      reply([
        { key: "map", label: "Map", url: "/" },
        { key: "nodebook", label: "NodeBook", url: "/nodebook/" },
        { key: "meshmate", label: "MeshMate", url: "/app/" },
      ]),
    );
    expect(siteTools.value.map((x) => x.url)).toEqual(["/nodebook/", "/app/"]);
  });

  it("drops anything that is not a path on this site", async () => {
    await loadSiteTools(
      reply([
        { key: "a", label: "A", url: "https://example.com/" },
        { key: "b", label: "B", url: "//example.com/" },
        { key: "c", label: "C" },
      ]),
    );
    expect(siteTools.value).toEqual([]);
  });

  it("a failing or missing list leaves only the four pages", async () => {
    await loadSiteTools(reply([], false));
    expect(siteTools.value).toEqual([]);
    await loadSiteTools(vi.fn(async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch);
    expect(siteTools.value).toEqual([]);
  });

  it("the top bar and the ☰ menu link to each listed tool by its translated name", () => {
    vi.stubGlobal("fetch", reply({ authenticated: false }));
    siteTools.value = [
      { key: "nodebook", label: "NodeBook", url: "/nodebook/" },
      { key: "other", label: "Other tool", url: "/other/" },
    ];
    render(
      <>
        <PageSwitcher />
        <AccountMenu />
      </>,
    );
    const bar = Array.from(document.querySelectorAll(".switcher a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(bar.slice(4)).toEqual([
      ["NodeBook", "/nodebook/"],
      ["Other tool", "/other/"],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const menu = Array.from(document.querySelectorAll("#page-menu a.menu-page")).map((a) => a.getAttribute("href"));
    expect(menu).toEqual(["/", "/stats", "/region-map", "/configurator", "/nodebook/", "/other/"]);
  });
});
