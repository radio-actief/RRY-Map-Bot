import { describe, expect, it } from "vitest";
import { isDeviceMessage, LAST_KEY, matchPort, message, readLast, roleOf, samePort, writeLast } from "../src/core/devicebus";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const port = (usbVendorId: number, usbProductId: number) => ({ getInfo: () => ({ usbVendorId, usbProductId }) });

describe("device convention", () => {
  it("builds messages in the shared shape", () => {
    expect(message("held", { usb: { usbVendorId: 0x303a, usbProductId: 0x1001 }, role: "repeater", name: "BE-GEN-T", publicKey: "ab" })).toEqual({
      kind: "bemesh.device",
      v: 1,
      type: "held",
      tool: "configurator",
      transport: "usb",
      role: "repeater",
      usbVendorId: 0x303a,
      usbProductId: 0x1001,
      name: "BE-GEN-T",
      publicKey: "ab",
    });
    expect(message("who")).toMatchObject({ type: "who", transport: null, usbVendorId: null, name: null });
  });

  it("accepts the other tools' messages and refuses anything else", () => {
    expect(isDeviceMessage({ kind: "bemesh.device", v: 1, type: "held", tool: "meshmate", transport: "ble", role: "companion", name: "Phone" })).toBe(true);
    expect(isDeviceMessage({ ...message("release"), v: 2 })).toBe(false);
    expect(isDeviceMessage({ ...message("release"), type: "steal" })).toBe(false);
    expect(isDeviceMessage({ ...message("release"), usbVendorId: 70000 })).toBe(false);
    expect(isDeviceMessage({ ...message("release"), name: "x".repeat(65) })).toBe(false);
    expect(isDeviceMessage("bemesh.device")).toBe(false);
  });

  it("reads the role from the firmware's reply", () => {
    expect(roleOf("repeater")).toBe("repeater");
    expect(roleOf("> room_server")).toBe("room");
    expect(roleOf("sensor")).toBe("sensor");
    expect(roleOf(undefined)).toBeNull();
  });

  it("a message without USB ids is about any device; with ids only that one", () => {
    const usb = { usbVendorId: 1, usbProductId: 2 };
    expect(samePort(message("release"), usb)).toBe(true);
    expect(samePort({ usbVendorId: 1, usbProductId: 2 }, usb)).toBe(true);
    expect(samePort({ usbVendorId: 1, usbProductId: 3 }, usb)).toBe(false);
  });

  it("remembers the last device for 12 hours, nothing secret", () => {
    const s = mem();
    writeLast(s, { usbVendorId: 1, usbProductId: 2, role: "repeater", name: "BE-GEN-T", publicKey: "ab" }, 1000);
    expect(JSON.parse(s.m.get(LAST_KEY)!)).toEqual({ transport: "usb", usbVendorId: 1, usbProductId: 2, role: "repeater", name: "BE-GEN-T", publicKey: "ab", at: 1000 });
    expect(readLast(s, 1000 + 3600_000)?.name).toBe("BE-GEN-T");
    expect(readLast(s, 1000 + 13 * 3600_000)).toBeNull();
  });

  it("ignores a broken or foreign entry, and storage that throws", () => {
    const s = mem();
    s.m.set(LAST_KEY, "{not json");
    expect(readLast(s)).toBeNull();
    s.m.set(LAST_KEY, JSON.stringify({ transport: "carrier-pigeon", at: Date.now() }));
    expect(readLast(s)).toBeNull();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readLast(broken)).toBeNull();
    expect(() => writeLast(broken, { usbVendorId: 1, usbProductId: 2, role: null, name: null, publicKey: null })).not.toThrow();
  });

  it("finds the granted port of the remembered device, only when exactly one matches", () => {
    const last = { transport: "usb" as const, usbVendorId: 1, usbProductId: 2, role: null, name: "T", publicKey: null, at: Date.now() };
    const a = port(1, 2);
    expect(matchPort([port(3, 4), a], last)).toBe(a);
    expect(matchPort([a, port(1, 2)], last)).toBeNull();
    expect(matchPort([port(3, 4)], last)).toBeNull();
    expect(matchPort([a], null)).toBeNull();
  });
});
