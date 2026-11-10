import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAST_KEY, type DeviceMessage } from "../src/core/devicebus";
import { askRelease, deviceHeld, heldElsewhere, holderOf, reconnect, refreshReconnect, startDeviceBus, type Channel } from "../src/state/devicebus";
import { store } from "../src/state/store";
import { TopBar } from "../src/app/TopBar";

type Fake = { postMessage: ReturnType<typeof vi.fn>; close: () => void; onmessage: ((e: MessageEvent) => void) | null };
const fakeChannel = () => ({ postMessage: vi.fn(), close: () => {}, onmessage: null }) as unknown as Fake & Channel;
const deliver = async (ch: Fake, data: unknown) => {
  ch.onmessage?.({ data } as MessageEvent);
  await Promise.resolve();
  await Promise.resolve();
};
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const USB = { usbVendorId: 0x303a, usbProductId: 0x1001 };
const from = (tool: string, type: DeviceMessage["type"], extra: Partial<DeviceMessage> = {}): DeviceMessage => ({
  kind: "bemesh.device",
  v: 1,
  type,
  tool,
  transport: "usb",
  role: null,
  usbVendorId: null,
  usbProductId: null,
  name: null,
  publicKey: null,
  ...extra,
});
const sent = (ch: Fake) => ch.postMessage.mock.calls.map((c) => (c[0] as DeviceMessage).type);

let stop: () => void = () => {};
beforeEach(() => {
  store.device.value = { status: "none", link: null, firmware: null };
  store.snapshot.value = null;
  store.applying.value = false;
  store.reading.value = false;
  store.commandBusy.value = false;
  heldElsewhere.value = {};
  reconnect.value = null;
});
afterEach(() => {
  stop();
  cleanup();
});

const connected = () => {
  store.device.value = { status: "connected", link: null, firmware: "v1.17.1", usb: USB };
  store.snapshot.value = { settings: {}, missing: [], name: "BE-GEN-Tower", publicKey: "ab".repeat(32), role: "repeater" };
};

describe("device convention in the configurator", () => {
  it("asks who holds a device when it starts, and answers who once it holds one", async () => {
    const ch = fakeChannel();
    stop = startDeviceBus({ channel: ch, storage: mem(), getPorts: async () => [], disconnect: async () => {} });
    expect(sent(ch)).toEqual(["who"]);
    connected();
    await deliver(ch, from("nodebook", "who"));
    expect(ch.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: "held", tool: "configurator", role: "repeater", name: "BE-GEN-Tower", ...USB });
  });

  it("lets go on release, and answers busy while it sends", async () => {
    const ch = fakeChannel();
    const disconnect = vi.fn(async () => {});
    stop = startDeviceBus({ channel: ch, storage: mem(), getPorts: async () => [], disconnect });
    connected();
    store.applying.value = true;
    await deliver(ch, from("nodebook", "release", USB));
    expect(sent(ch).at(-1)).toBe("busy");
    expect(disconnect).not.toHaveBeenCalled();
    store.applying.value = false;
    await deliver(ch, from("nodebook", "release", USB));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(sent(ch).at(-1)).toBe("released");
  });

  it("a release for another USB device is not for it", async () => {
    const ch = fakeChannel();
    const disconnect = vi.fn(async () => {});
    stop = startDeviceBus({ channel: ch, storage: mem(), getPorts: async () => [], disconnect });
    connected();
    await deliver(ch, from("nodebook", "release", { usbVendorId: 1, usbProductId: 2 }));
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("remembers what other tabs hold, and forgets it on released", async () => {
    const ch = fakeChannel();
    stop = startDeviceBus({ channel: ch, storage: mem(), getPorts: async () => [], disconnect: async () => {} });
    await deliver(ch, from("meshmate", "held", USB));
    expect(holderOf(USB)).toBe("meshmate");
    await deliver(ch, from("meshmate", "released", USB));
    expect(holderOf(USB)).toBeNull();
  });

  it("remembers the connected device for the next tool, and offers it again when its port is granted", async () => {
    const storage = mem();
    const port = { getInfo: () => USB } as never;
    stop = startDeviceBus({ channel: fakeChannel(), storage, getPorts: async () => [port], disconnect: async () => {} });
    connected();
    deviceHeld();
    expect(JSON.parse(storage.m.get(LAST_KEY)!)).toMatchObject({ transport: "usb", name: "BE-GEN-Tower", ...USB });
    store.device.value = { status: "none", link: null, firmware: null };
    await refreshReconnect();
    expect(reconnect.value).toEqual({ name: "BE-GEN-Tower", port });
  });

  it("offers no Reconnect for a port another tab says it holds", async () => {
    const storage = mem();
    const ch = fakeChannel();
    const port = { getInfo: () => USB } as never;
    stop = startDeviceBus({ channel: ch, storage, getPorts: async () => [port], disconnect: async () => {} });
    connected();
    deviceHeld();
    store.device.value = { status: "none", link: null, firmware: null };
    await deliver(ch, from("nodebook", "held", USB));
    await refreshReconnect();
    expect(reconnect.value).toBeNull();
  });

  it("names the device from what it said at connect, before any Read", async () => {
    const storage = mem();
    stop = startDeviceBus({ channel: fakeChannel(), storage, getPorts: async () => [], disconnect: async () => {} });
    store.device.value = { status: "connected", link: null, firmware: "v1.17.1", usb: USB, name: "BE-GEN-Tower", board: "Heltec V3" };
    deviceHeld();
    expect(JSON.parse(storage.m.get(LAST_KEY)!)).toMatchObject({ name: "BE-GEN-Tower" });
  });

  it("the chip shows name · board · version from connect", () => {
    store.device.value = { status: "connected", link: null, firmware: "v1.17.1", usb: USB, name: "BE-GEN-Tower", board: "Heltec V3" };
    render(<TopBar />);
    expect(screen.getByText("BE-GEN-Tower · Heltec V3 · v1.17.1")).toBeTruthy();
  });

  it("the chip offers Reconnect <name> for a remembered, granted device", async () => {
    vi.stubGlobal("navigator", { ...navigator, serial: {} });
    try {
      reconnect.value = { name: "BE-GEN-Tower", port: { getInfo: () => USB } as never };
      render(<TopBar />);
      expect(screen.getByRole("button", { name: "Reconnect BE-GEN-Tower" })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("asks the holder to let go and reports its answer", async () => {
    const ch = fakeChannel();
    const r = askRelease(USB, () => ch, 1000);
    expect(ch.postMessage.mock.calls[0][0]).toMatchObject({ type: "release", tool: "configurator", ...USB });
    await deliver(ch, from("meshmate", "released", USB));
    expect(await r).toBe("released");
    const ch2 = fakeChannel();
    const r2 = askRelease(USB, () => ch2, 1000);
    await deliver(ch2, from("nodebook", "busy", USB));
    expect(await r2).toBe("busy");
    expect(await askRelease(USB, () => fakeChannel(), 10)).toBe("noAnswer");
  });
});

describe("a companion on the configurator", () => {
  it("is pointed at the site's tools that can use it", async () => {
    const { siteTools } = await import("../src/app/pages");
    const { connectUsb } = await import("../src/state/device");
    const { FakePort } = await import("./fakes/fake-port");
    siteTools.value = [
      { key: "nodebook", label: "NodeBook", url: "/nodebook/" },
      { key: "meshmate", label: "MeshMate", url: "/app/" },
    ];
    try {
      const port = new FakePort({ ver: "" });
      await connectUsb({ requestPort: async () => port, timing: { interCommandDelayMs: 0, bootDrainMs: 0, disconnectSettleMs: 0, replyTimeoutMs: 30, rawQuietMs: 20 } });
      await waitFor(() => expect(store.notice.value?.links?.map((l) => l.href)).toEqual(["/nodebook/", "/app/"]));
    } finally {
      siteTools.value = [];
      store.notice.value = null;
    }
  });
});

