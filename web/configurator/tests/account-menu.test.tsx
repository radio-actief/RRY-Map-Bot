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
    expect(screen.getByRole("link", { name: "Log out", hidden: true }).getAttribute("href")).toBe("/auth/logout?next=/configurator");
    expect(document.querySelector(".signin-chip")).toBeNull();
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
