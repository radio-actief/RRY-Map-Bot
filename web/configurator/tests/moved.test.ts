import { describe, expect, it, vi } from "vitest";
import { CONFIGURATOR_PREFS } from "../../../src/shared/configurator-prefs.js";
import { LAST_KEY } from "../../../src/shared/device-message.js";
import type { Hub } from "../src/state/hub";
import { MOVED_KEY, moveSettings } from "../src/state/moved";
import { LAYERS_PREF, THEME_PREF } from "../src/state/store";
import { SEND_ALL_PREF } from "../src/steps/Send";
import { SHOW_COMMAND_LOG_PREF } from "../src/state/device";

/** The one-time move of the configurator's settings from the map's address to its own. */

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

const NOW = Date.now();
const last = (at: number, name: string) => ({ transport: "usb", usbVendorId: 0x303a, usbProductId: 0x1001, role: "repeater", name, publicKey: null, at });

/** A hub that answers the settings query with `values` and getLast with `device` (null: no answer). */
function fakeHub(values: Record<string, string | null> | null, device: unknown = null): Hub & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    send: vi.fn(),
    listen: () => () => {},
    close: vi.fn(),
    ask: async (data, kind) => {
      asked.push(kind);
      if (kind === "bemesh.configurator.prefs") return values ? { kind, v: 1, values } : null;
      return { kind, v: 1, last: device };
    },
  };
}

describe("moving the configurator's settings to its own address", () => {
  it("names the configurator's own settings", () => {
    expect(CONFIGURATOR_PREFS).toEqual([THEME_PREF, LAYERS_PREF, SEND_ALL_PREF, SHOW_COMMAND_LOG_PREF]);
  });

  it("copies every setting this address doesn't have, then marks the move done", async () => {
    const p = mem();
    const r = await moveSettings(fakeHub({ [THEME_PREF]: "dark", [LAYERS_PREF]: '{"nodes":false,"borders":true}', [SEND_ALL_PREF]: "1", [SHOW_COMMAND_LOG_PREF]: null }), p, p);
    expect(r).toEqual({ status: "moved", copied: [THEME_PREF, LAYERS_PREF, SEND_ALL_PREF] });
    expect(p.get(THEME_PREF)).toBe("dark");
    expect(p.get(SHOW_COMMAND_LOG_PREF)).toBeNull();
    expect(p.get(MOVED_KEY)).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("never overwrites a setting made here", async () => {
    const p = mem({ [THEME_PREF]: "light" });
    await moveSettings(fakeHub({ [THEME_PREF]: "dark" }), p, p);
    expect(p.get(THEME_PREF)).toBe("light");
  });

  it("asks only once", async () => {
    const p = mem({ [MOVED_KEY]: "2026-11-22T00:00:00.000Z" });
    const hub = fakeHub({ [THEME_PREF]: "dark" });
    expect(await moveSettings(hub, p, p)).toEqual({ status: "already" });
    expect(hub.asked).toEqual([]);
    expect(p.get(THEME_PREF)).toBeNull();
  });

  it("marks nothing when the hub doesn't answer, so the next visit asks again", async () => {
    const p = mem();
    expect(await moveSettings(fakeHub(null), p, p)).toEqual({ status: "noAnswer" });
    expect(p.get(MOVED_KEY)).toBeNull();
  });

  it("ignores values that are not plain text", async () => {
    const p = mem();
    await moveSettings(fakeHub({ [THEME_PREF]: 3 as unknown as string, [LAYERS_PREF]: "x".repeat(3000) }), p, p);
    expect(p.get(THEME_PREF)).toBeNull();
    expect(p.get(LAYERS_PREF)).toBeNull();
  });

  it("takes the remembered device only when it is newer than this address's own", async () => {
    const empty = mem();
    await moveSettings(fakeHub({}, last(NOW - 1000, "Theirs")), empty, empty);
    expect(JSON.parse(empty.get(LAST_KEY)!).name).toBe("Theirs");

    const newer = mem({ [LAST_KEY]: JSON.stringify(last(NOW - 10, "Ours")) });
    await moveSettings(fakeHub({}, last(NOW - 1000, "Theirs")), newer, newer);
    expect(JSON.parse(newer.get(LAST_KEY)!).name).toBe("Ours");

    const older = mem({ [LAST_KEY]: JSON.stringify(last(NOW - 5000, "Ours")) });
    await moveSettings(fakeHub({}, last(NOW - 1000, "Theirs")), older, older);
    expect(JSON.parse(older.get(LAST_KEY)!).name).toBe("Theirs");

    const broken = mem();
    await moveSettings(fakeHub({}, { transport: "usb", at: NOW, name: "x".repeat(100) }), broken, broken);
    expect(broken.get(LAST_KEY)).toBeNull();
  });
});
