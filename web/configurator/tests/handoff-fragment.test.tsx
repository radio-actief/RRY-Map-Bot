import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeHandoff, encodeHandoff, handoffLink, HANDOFF_MAX_LINK, type HandoffMessage } from "../src/core/handoff";
import { incoming, receiveHandoff, sendHandoff } from "../src/state/handoff";

const KEY = "ab".repeat(32);
const MSG: HandoffMessage = {
  kind: "bemesh.settings",
  v: 1,
  source: "nodebook",
  public_key: KEY,
  at: "2026-11-10T12:00:00Z",
  settings: { name: "Zoë's répéteur 🛰", tx: "22" },
  regions: ["region put be", "region save"],
};

/** A window with this hash, its replaceState and open recorded. */
function fakeWindow(hash: string) {
  const replaced: string[] = [];
  const win = {
    location: { hash, pathname: "/configurator", search: "?lang=nl", origin: "https://map.example" },
    history: { state: { keep: 1 }, replaceState: vi.fn((_s: unknown, _t: string, url: string) => replaced.push(url)) },
    open: vi.fn(() => null),
  };
  return { win: win as unknown as Window, replaced, open: win.open };
}

afterEach(() => {
  incoming.value = null;
  cleanup();
});

describe("hand-off in the address fragment", () => {
  it("encodes as URL-safe base64 of UTF-8 JSON without padding, and back", () => {
    const enc = encodeHandoff(MSG);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeHandoff(enc)).toEqual(MSG);
    // The same bytes in plain base64, for the other tools' decoders.
    const plain = Buffer.from(JSON.stringify(MSG), "utf8").toString("base64").replace(/=+$/, "");
    expect(enc).toBe(plain.replace(/\+/g, "-").replace(/\//g, "_"));
  });

  it("reads nothing from text that is not base64url JSON", () => {
    expect(decodeHandoff("")).toBeNull();
    expect(decodeHandoff("not base64!")).toBeNull();
    expect(decodeHandoff(Buffer.from("not json").toString("base64url"))).toBeNull();
    expect(decodeHandoff(Buffer.from([0xff, 0xfe, 0x7b]).toString("base64url"))).toBeNull();
  });

  it("builds NodeBook's link, and none when it would be too long", () => {
    expect(handoffLink("https://nodebook.example/", MSG)).toBe(`https://nodebook.example/#/handoff?d=${encodeHandoff(MSG)}`);
    const big = { ...MSG, settings: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, "x".repeat(100)])) };
    expect(handoffLink("https://nodebook.example/", big)).toBeNull();
    expect(HANDOFF_MAX_LINK).toBe(16 * 1024);
  });

  it("the configurator takes settings from #handoff= once, removes them from the address, and asks first", () => {
    const { win, replaced } = fakeWindow(`#handoff=${encodeHandoff(MSG)}`);
    receiveHandoff(win);
    expect(replaced).toEqual(["/configurator?lang=nl"]);
    expect(incoming.value?.msg).toEqual(MSG);
    expect(incoming.value?.snapshot.name).toBe("Zoë's répéteur 🛰");
  });

  it("drops a fragment that is not a valid hand-off, and still removes it", () => {
    const bad = { ...MSG, settings: { name: "a\rset password x" } };
    for (const hash of [`#handoff=${encodeHandoff(bad as HandoffMessage)}`, "#handoff=%%%", `#handoff=${"A".repeat(100_000)}`]) {
      const { win, replaced } = fakeWindow(hash);
      receiveHandoff(win);
      expect(replaced).toEqual(["/configurator?lang=nl"]);
      expect(incoming.value).toBeNull();
    }
  });

  it("leaves other fragments alone", () => {
    const { win, replaced } = fakeWindow("#companion");
    receiveHandoff(win);
    expect(replaced).toEqual([]);
    expect(incoming.value).toBeNull();
  });

  it("Save to NodeBook opens NodeBook's link in a new tab, without an opener", () => {
    const { win, open } = fakeWindow("");
    expect(sendHandoff("https://nodebook.example/", MSG, win)).toBe("sent");
    expect(open).toHaveBeenCalledWith(`https://nodebook.example/#/handoff?d=${encodeHandoff(MSG)}`, "_blank", "noopener");
  });

  it("refuses to send settings that make too long a link", () => {
    const { win, open } = fakeWindow("");
    const big = { ...MSG, settings: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, "x".repeat(100)])) };
    expect(sendHandoff("https://nodebook.example/", big, win)).toBe("tooLarge");
    expect(open).not.toHaveBeenCalled();
  });
});

describe("the drawer's Save to NodeBook", () => {
  it("says right away that the settings were sent", async () => {
    const { siteTools } = await import("../src/app/pages");
    const { DeviceDrawer } = await import("../src/app/DeviceDrawer");
    const { store } = await import("../src/state/store");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    siteTools.value = [{ key: "nodebook", label: "NodeBook", url: "https://nodebook.example/" }];
    store.drawerOpen.value = true;
    try {
      render(<DeviceDrawer />);
      fireEvent.click(screen.getByRole("button", { name: "Save to NodeBook" }));
      expect(open).toHaveBeenCalledTimes(1);
      expect(String(open.mock.calls[0][0])).toMatch(/^https:\/\/nodebook\.example\/#\/handoff\?d=[A-Za-z0-9_-]+$/);
      expect(open.mock.calls[0].slice(1)).toEqual(["_blank", "noopener"]);
      expect(await screen.findByText("Sent to NodeBook. Check and save them there.")).toBeTruthy();
    } finally {
      siteTools.value = [];
      store.drawerOpen.value = false;
      open.mockRestore();
    }
  });
});
