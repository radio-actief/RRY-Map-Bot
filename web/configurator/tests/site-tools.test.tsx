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

  it("keeps tools on their own https address", async () => {
    await loadSiteTools(
      reply([
        { key: "map", label: "Map", url: "https://map.example/" },
        { key: "configurator", label: "Configurator", url: "https://map.example/configurator" },
        { key: "nodebook", label: "NodeBook", url: "https://nodebook.example/" },
        { key: "meshmate", label: "MeshMate", url: "https://app.example:8445/" },
        { key: "local", label: "Local", url: "http://127.0.0.1:4791/" },
      ]),
    );
    expect(siteTools.value.map((x) => x.url)).toEqual(["https://nodebook.example/", "https://app.example:8445/", "http://127.0.0.1:4791/"]);
  });

  it("drops anything that is not a path on this site or a plain https address", async () => {
    await loadSiteTools(
      reply([
        { key: "a", label: "A", url: "https://example.com" },
        { key: "b", label: "B", url: "//example.com/" },
        { key: "c", label: "C" },
        { key: "d", label: "D", url: "http://example.com/" },
        { key: "e", label: "E", url: "https://user@example.com/" },
        { key: "f", label: "F", url: "https://example.com/../" },
        { key: "g", label: "G", url: "javascript:alert(1)//" },
        { key: "h", label: "H", url: "https://example.com/?x=/" },
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

  it("links to a tool on its own address by that address", () => {
    vi.stubGlobal("fetch", reply({ authenticated: false }));
    siteTools.value = [{ key: "nodebook", label: "NodeBook", url: "https://nodebook.example/" }];
    render(<PageSwitcher />);
    const bar = Array.from(document.querySelectorAll(".switcher a")).map((a) => a.getAttribute("href"));
    expect(bar.slice(4)).toEqual(["https://nodebook.example/"]);
  });
});
