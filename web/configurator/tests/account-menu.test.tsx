import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu, resetAccount } from "../src/app/AccountMenu";

function mockMe(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));
}

beforeEach(() => resetAccount());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("account menu", () => {
  it("☰ lists the five links in order", async () => {
    mockMe({ authenticated: false });
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const labels = Array.from(document.querySelectorAll('#page-menu a[target="_blank"]')).map((a) => a.textContent?.replace(/\s*↗$/, "").trim());
    expect(labels).toEqual(["Radio-Actief Website", "#BEmesh Website", "Documentation", "Discord", "GitHub"]);
    expect(screen.getByRole("button", { name: "Menu" }).getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(document.querySelector(".signin-chip")).toBeTruthy());
  });

  it("signed out shows the Sign in with Discord chip and menu link, returning to the configurator", async () => {
    mockMe({ authenticated: false });
    render(<AccountMenu />);
    await waitFor(() => expect(document.querySelector(".signin-chip")).toBeTruthy());
    const links = screen.getAllByRole("link", { name: "Sign in with Discord", hidden: true });
    expect(links.length).toBe(2);
    for (const a of links) expect(a.getAttribute("href")).toBe("/auth/login?next=/configurator");
  });

  it("signed in shows @tester and Log out, and no chip", async () => {
    mockMe({ authenticated: true, user: { id: "1", username: "tester" } });
    render(<AccountMenu />);
    await screen.findByText("@tester");
    // Log out is a POST (a link elsewhere can't sign someone out).
    const out = screen.getByRole("button", { name: "Log out", hidden: true });
    const form = out.closest("form")!;
    expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["post", "/auth/logout?next=/configurator"]);
    expect(document.querySelector(".signin-chip")).toBeNull();
  });

  it("☰ follows the suite's order: tools, links, About, account, language; the account once known", async () => {
    let answer: (body: unknown) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise((res) => (answer = (body) => res({ ok: true, json: async () => body })))));
    render(<AccountMenu />);
    const groups = () => {
      const out: string[] = [];
      for (const el of Array.from(document.getElementById("page-menu")!.children)) {
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
    };
    // Rendered at once, before /auth/me answers.
    expect(groups()).toEqual(["tools", "|", "links", "about", "|", "language"]);
    answer({ authenticated: false });
    await waitFor(() => expect(groups()).toEqual(["tools", "|", "links", "about", "|", "account", "|", "language"]));
    const here = document.querySelector('#page-menu a[aria-current="page"]')!;
    expect(here.getAttribute("href")).toBe("/configurator");
    expect(here.querySelector("i.bi-check-lg")).not.toBeNull();
  });

  it("a click opens ☰ without moving the focus; Enter or Space moves it to the first row; the menu stays in the window", () => {
    mockMe({ authenticated: false });
    const place = vi.spyOn(window.BEmeshMenu, "place");
    render(<AccountMenu />);
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button.querySelector("i.bi-list")).not.toBeNull();
    expect(button.textContent).toBe("");
    button.focus();
    fireEvent.click(button, { detail: 1 });
    expect(document.activeElement).toBe(button);
    expect(place).toHaveBeenCalledWith(document.getElementById("page-menu"));
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(button, { detail: 0 });
    expect(document.activeElement).toBe(document.querySelector("#page-menu a"));
    place.mockRestore();
  });

  it("the selected language is pressed, in the bar and in the menu", () => {
    mockMe({ authenticated: false });
    render(<AccountMenu />);
    const groups = Array.from(document.querySelectorAll(".lang-switch"));
    expect(groups.length).toBe(2);
    for (const g of groups) {
      expect(Array.from(g.querySelectorAll("button")).map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    }
  });

  it("a failing /auth/me counts as signed out, and Escape closes the menu", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    render(<AccountMenu />);
    await waitFor(() => expect(document.querySelector(".signin-chip")).toBeTruthy());
    const button = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(button);
    expect(document.querySelector<HTMLElement>("#page-menu")!.hidden).toBe(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector<HTMLElement>("#page-menu")!.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});
