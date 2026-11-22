import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceMessage } from "../src/core/devicebus";
import { askRelease, deviceHeld, heldElsewhere, reconnect, refreshReconnect, startDeviceBus, type Channel } from "../src/state/devicebus";
import type { Hub } from "../src/state/hub";
import { store } from "../src/state/store";

/** The configurator on an address of its own joins the device convention through the map's hub. */

const fakeChannel = () => ({ postMessage: vi.fn(), close: () => {}, onmessage: null }) as unknown as Channel & { postMessage: ReturnType<typeof vi.fn> };
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const USB = { usbVendorId: 0x303a, usbProductId: 0x1001 };
const NOW = Date.now();
const from = (tool: string, type: DeviceMessage["type"], extra: Partial<DeviceMessage> = {}): DeviceMessage => ({
  kind: "bemesh.device", v: 1, type, tool, transport: "usb", role: null, usbVendorId: null, usbProductId: null, name: null, publicKey: null, ...extra,
});
const tick = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

/** A hub whose page side we drive: what the configurator sent, and a way to post as the hub. */
function fakeHub(last: unknown = null) {
  const listeners = new Set<(d: unknown) => void>();
  const sent: unknown[] = [];
  const hub: Hub = {
    send: (d) => void sent.push(d),
    listen: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    ask: async (d, kind) => {
      sent.push(d);
      return kind === "bemesh.device.last" ? { kind, v: 1, last } : null;
    },
    close: () => {},
  };
  const post = async (d: unknown) => {
    for (const fn of Array.from(listeners)) fn(d);
    await tick();
  };
  return { hub, sent, post, listeners };
}

let stop: () => void = () => {};
beforeEach(() => {
  store.device.value = { status: "none", link: null, firmware: null };
  store.snapshot.value = null;
  heldElsewhere.value = {};
  reconnect.value = null;
});
afterEach(() => stop());

describe("the device convention through the map's hub", () => {
  it("says who it is to the hub too, and asks for the hub's remembered device", async () => {
    const h = fakeHub();
    const ch = fakeChannel();
    stop = startDeviceBus({ channel: ch, storage: mem(), getPorts: async () => [], disconnect: async () => {}, hub: h.hub });
    expect(h.sent).toContainEqual(expect.objectContaining({ kind: "bemesh.device", type: "who", tool: "configurator" }));
    expect(h.sent).toContainEqual({ kind: "bemesh.device.getLast", v: 1 });
    expect(ch.postMessage).toHaveBeenCalledTimes(1);
  });

  it("hears the hub's device messages as the channel's", async () => {
    const h = fakeHub();
    stop = startDeviceBus({ channel: fakeChannel(), storage: mem(), getPorts: async () => [], disconnect: async () => {}, hub: h.hub });
    await h.post(from("nodebook", "held", USB));
    expect(Object.keys(heldElsewhere.value)).toEqual(["nodebook"]);
    await h.post({ kind: "other" });
    await h.post(from("nodebook", "released", USB));
    expect(heldElsewhere.value).toEqual({});
  });

  it("tells the hub when it holds a device (the hub keeps it as the last device)", async () => {
    const h = fakeHub();
    stop = startDeviceBus({ channel: fakeChannel(), storage: mem(), getPorts: async () => [], disconnect: async () => {}, hub: h.hub });
    store.device.value = { status: "connected", link: null, firmware: "v1.17.1", usb: USB };
    store.snapshot.value = { settings: {}, missing: [], name: "BE-GEN-Tower", role: "repeater" };
    deviceHeld();
    expect(h.sent.at(-1)).toMatchObject({ kind: "bemesh.device", type: "held", name: "BE-GEN-Tower", ...USB });
  });

  it("offers the hub's remembered device when it is newer and its port is granted here", async () => {
    const h = fakeHub({ transport: "usb", ...USB, role: "repeater", name: "From the map", publicKey: null, at: NOW - 1000 });
    const port = { getInfo: () => USB } as never;
    stop = startDeviceBus({ channel: fakeChannel(), storage: mem(), getPorts: async () => [port], disconnect: async () => {}, hub: h.hub });
    await tick();
    await refreshReconnect();
    expect(reconnect.value).toEqual({ name: "From the map", port });
  });

  it("asks the holder through the hub too, and takes its answer from there", async () => {
    const h = fakeHub();
    const ch = fakeChannel();
    const r = askRelease(USB, () => ch, 1000, h.hub);
    expect(h.sent.at(-1)).toMatchObject({ type: "release", ...USB });
    await h.post(from("meshmate", "released", USB));
    expect(await r).toBe("released");
    expect(h.listeners.size).toBe(0);
  });

  it("without a hub nothing changes: the channel only", async () => {
    const ch = fakeChannel();
    stop = startDeviceBus({ channel: ch, storage: mem(), getPorts: async () => [], disconnect: async () => {} });
    expect(ch.postMessage).toHaveBeenCalledTimes(1);
  });
});
