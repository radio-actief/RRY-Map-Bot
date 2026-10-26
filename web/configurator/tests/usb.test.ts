import { describe, expect, it } from "vitest";
import { usbBoard, usbLabel } from "../src/device/usb";

describe("usbLabel", () => {
  it("names a known board by its vendor and product id", () => {
    expect(usbLabel({ usbVendorId: 0x239a, usbProductId: 0x8029 })).toBe("RAK4631 (239a:8029)");
  });

  it("falls back to the USB chip vendor", () => {
    expect(usbLabel({ usbVendorId: 0x10c4, usbProductId: 0xea60 })).toBe("Silicon Labs CP210x (10c4:ea60)");
    expect(usbLabel({ usbVendorId: 0x303a, usbProductId: 0x1001 })).toBe("Espressif (303a:1001)");
  });

  it("shows the bare ids for an unknown vendor, and nothing without ids", () => {
    expect(usbLabel({ usbVendorId: 0x1234, usbProductId: 0xabc })).toBe("USB 1234:0abc");
    expect(usbLabel({})).toBeNull();
    expect(usbLabel(undefined)).toBeNull();
  });
});

describe("usbBoard", () => {
  it("names the board without its ids, or the bare ids for an unknown vendor", () => {
    expect(usbBoard({ usbVendorId: 0x239a, usbProductId: 0x8029 })).toBe("RAK4631");
    expect(usbBoard({ usbVendorId: 0x303a, usbProductId: 0x1001 })).toBe("Espressif");
    expect(usbBoard({ usbVendorId: 0x1234, usbProductId: 0xabc })).toBe("USB 1234:0abc");
    expect(usbBoard(undefined)).toBeNull();
  });
});
