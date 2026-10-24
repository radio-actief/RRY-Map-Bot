/**
 * A readable name for the USB serial device. Web Serial only exposes the vendor and product ids;
 * the OS port path and the product string the browser's port picker shows stay hidden from pages.
 */

export type UsbInfo = { usbVendorId?: number; usbProductId?: number };

const hex = (n: number) => n.toString(16).padStart(4, "0");

/** Boards by vendor:product id. */
const BOARDS: Record<string, string> = {
  "239a:8029": "RAK4631",
};

/** The board maker or the USB-serial chip, by vendor id. */
const VENDORS: Record<string, string> = {
  "239a": "Adafruit nRF52",
  "303a": "Espressif",
  "10c4": "Silicon Labs CP210x",
  "1a86": "WCH CH34x",
  "0403": "FTDI",
  "2886": "Seeed",
  "1915": "Nordic",
  "2e8a": "Raspberry Pi",
};

/** "RAK4631 (239a:8029)", "Espressif (303a:1001)", "USB 1234:0abc", or null without ids. */
export function usbLabel(info: UsbInfo | undefined | null): string | null {
  if (!info || info.usbVendorId === undefined || info.usbProductId === undefined) return null;
  const vid = hex(info.usbVendorId);
  const id = `${vid}:${hex(info.usbProductId)}`;
  const name = BOARDS[id] ?? VENDORS[vid];
  return name ? `${name} (${id})` : `USB ${id}`;
}
