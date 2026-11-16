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

  it("signed in, ☰ has the account group of the account menu: name (@handle under it), My nodes, Account, Log out; no chip", async () => {
    mockMe({ authenticated: true, user: { id: "1", username: "tester", global_name: "Tess" } });
    render(<AccountMenu />);
    await screen.findAllByText("@tester");
    const group = (menu: Element) => {
      const user = menu.querySelector(".menu-user")!;
      const out: string[] = [`${user.querySelector(".menu-name")!.textContent} / ${user.querySelector(".menu-handle")?.textContent}`];
      for (let el = user.nextElementSibling; el && !el.classList.contains("menu-lang"); el = el.nextElementSibling) {
        out.push(el.tagName === "HR" ? "|" : el.tagName === "FORM" ? `${el.textContent} → ${el.getAttribute("action")}` : `${el.textContent} ${el.getAttribute("href")}`);
      }
      return out;
    };
    const want = ["Tess / @tester", "My nodes /account#my-nodes", "Account /account", "|", "Log out → /auth/logout?next=/configurator"];
    expect(group(document.getElementById("page-menu")!)).toEqual(want);
    expect(group(document.getElementById("account-menu")!)).toEqual(want);
    // Log out is a POST (a link elsewhere can't sign someone out), in ☰ and in the account menu.
    const outs = screen.getAllByRole("button", { name: "Log out", hidden: true });
    expect(outs.length).toBe(2);
    for (const out of outs) {
      const form = out.closest("form")!;
      expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["post", "/auth/logout?next=/configurator"]);
    }
    expect(document.querySelector(".signin-chip")).toBeNull();
  });

  it("signed in, the account button takes the chip's place: the initial in a circle, named for screen readers", async () => {
    mockMe({ authenticated: true, user: { id: "1", username: "tester", global_name: "Émile" } });
    render(<AccountMenu />);
    const button = await screen.findByRole("button", { name: "Account: Émile" });
    expect(button.id).toBe("account-toggle");
    expect(button.classList.contains("icon")).toBe(true);
    expect(button.textContent).toBe("É");
    expect(button.querySelector(".account-initial")?.getAttribute("aria-hidden")).toBe("true");
    expect(button.querySelector("img")).toBeNull();
  });

  it("the account button opens the name, My nodes, Account and Log out; a click keeps the focus, the keyboard moves it in", async () => {
    mockMe({ authenticated: true, user: { id: "1", username: "tester", global_name: null } });
    const place = vi.spyOn(window.BEmeshMenu, "place");
    render(<AccountMenu />);
    const button = await screen.findByRole("button", { name: "Account: tester" });
    const menu = document.getElementById("account-menu")!;
    expect(menu.hidden).toBe(true);
    button.focus();
    fireEvent.click(button, { detail: 1 });
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(button);
    expect(place).toHaveBeenCalledWith(menu);
    const rows = Array.from(menu.children).map((el) =>
      el.tagName === "HR" ? "|" : el.tagName === "FORM" ? `${el.textContent} → ${el.getAttribute("action")}` : `${el.textContent} ${el.getAttribute("href") ?? ""}`.trim(),
    );
    expect(rows).toEqual(["tester", "My nodes /account#my-nodes", "Account /account", "|", "Log out → /auth/logout?next=/configurator"]);
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(button, { detail: 0 });
    expect(document.activeElement?.textContent).toBe("My nodes");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    place.mockRestore();
  });

  it("one menu at a time: opening ☰ closes the account menu", async () => {
    mockMe({ authenticated: true, user: { id: "1", username: "tester" } });
    render(<AccountMenu />);
    const button = await screen.findByRole("button", { name: "Account: tester" });
    fireEvent.click(button, { detail: 1 });
    const menuButton = screen.getByRole("button", { name: "Menu" });
    fireEvent.pointerDown(menuButton);
    fireEvent.click(menuButton, { detail: 1 });
    expect(document.getElementById("account-menu")!.hidden).toBe(true);
    expect(document.getElementById("page-menu")!.hidden).toBe(false);
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

describe("the configurator tells the other tools' hubs about a sign-in", () => {
  it("records whether someone is signed in after /auth/me", async () => {
    const { recordSeen } = await import("../src/app/AccountMenu");
    localStorage.removeItem("bemesh.account.seen");
    recordSeen(true);
    expect(localStorage.getItem("bemesh.account.seen")).toBe('{"signedIn":true}');
    recordSeen(false);
    expect(localStorage.getItem("bemesh.account.seen")).toBe('{"signedIn":false}');
  });
});

describe("the configurator follows the site's other tabs", () => {
  it("a log out or sign-in in another tab re-asks /auth/me and redraws the account button or chip", async () => {
    let me: unknown = { authenticated: true, user: { id: "1", username: "tester", global_name: "Tess" } };
    let asked = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        asked++;
        return { ok: true, json: async () => me };
      }),
    );
    render(<AccountMenu />);
    await screen.findByRole("button", { name: "Account: Tess" });
    expect(asked).toBe(1);
    me = { authenticated: false };
    window.dispatchEvent(new StorageEvent("storage", { key: "bemesh.account.seen", newValue: '{"signedIn":false}' }));
    await waitFor(() => expect(document.querySelector(".signin-chip")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Account: Tess" })).toBeNull();
    me = { authenticated: true, user: { id: "1", username: "tester", global_name: "Tess" } };
    window.dispatchEvent(new StorageEvent("storage", { key: "bemesh.account.seen", newValue: '{"signedIn":true}' }));
    await screen.findByRole("button", { name: "Account: Tess" });
    window.dispatchEvent(new StorageEvent("storage", { key: "configurator.theme", newValue: "dark" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(asked).toBe(3);
  });

  it("stops listening when it is gone", async () => {
    let asked = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        asked++;
        return { ok: true, json: async () => ({ authenticated: false }) };
      }),
    );
    render(<AccountMenu />);
    await waitFor(() => expect(document.querySelector(".signin-chip")).toBeTruthy());
    cleanup();
    // Preact runs an unmounted component's effect clean-ups after the next paint.
    await new Promise((r) => setTimeout(r, 50));
    window.dispatchEvent(new StorageEvent("storage", { key: "bemesh.account.seen", newValue: '{"signedIn":true}' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(asked).toBe(1);
  });
});

describe("the configurator after a log out", () => {
  afterEach(() => {
    document.querySelectorAll(".bemesh-toast").forEach((t) => t.remove());
    history.replaceState(null, "", "/");
  });

  it("says so once and takes the word out of the address", async () => {
    mockMe({ authenticated: false });
    history.replaceState(null, "", "/configurator?logout=success");
    render(<AccountMenu />);
    const toast = await waitFor(() => document.querySelector<HTMLElement>(".bemesh-toast")!);
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.textContent).toBe("You're logged out.");
    expect(location.pathname + location.search).toBe("/configurator");
  });

  it("says nothing without the word", async () => {
    mockMe({ authenticated: false });
    history.replaceState(null, "", "/configurator");
    render(<AccountMenu />);
    await waitFor(() => expect(document.querySelector(".signin-chip")).toBeTruthy());
    expect(document.querySelector(".bemesh-toast")).toBeNull();
  });
});
