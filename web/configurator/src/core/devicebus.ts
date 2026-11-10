/**
 * The site's device convention (shared with NodeBook and MeshMate): one way to connect on every
 * tool. Tools in other tabs talk on the BroadcastChannel `bemesh-device`; the device last
 * connected in this browser is kept in localStorage `bemesh.device.last`, so the next tool can
 * offer "Reconnect <name>" for a port the person already chose (one click, never by itself).
 */
import type { UsbInfo } from "../device/usb";
import type { DeviceMessage, DeviceRole, LastDevice, MessageType } from "../../../../src/shared/device-message.js";

// The shape and storage rules are shared with the device hub page (src/shared/device-message.js).
export { CHANNEL, isDeviceMessage, LAST_KEY, LAST_MAX_AGE_MS, readLast, writeLast } from "../../../../src/shared/device-message.js";
export type { DeviceMessage, DeviceRole, LastDevice, MessageType, Transport } from "../../../../src/shared/device-message.js";

/** Nobody waits longer than this for an answer on the channel. */
export const ANSWER_MS = 2000;
export const TOOL = "configurator";

/** The firmware's `get role` reply as the convention's role (a repeater build answers "repeater"). */
export function roleOf(reply: string | undefined | null): DeviceRole {
  const r = (reply ?? "").trim().toLowerCase();
  if (r.includes("room")) return "room";
  if (r.includes("sensor")) return "sensor";
  if (r.includes("repeater")) return "repeater";
  if (r.includes("companion")) return "companion";
  return null;
}

/** A message from this tool about the device it holds. */
export function message(
  type: MessageType,
  d: { usb?: UsbInfo | null; role?: DeviceRole; name?: string | null; publicKey?: string | null } = {},
): DeviceMessage {
  return {
    kind: "bemesh.device",
    v: 1,
    type,
    tool: TOOL,
    transport: d.usb === undefined ? null : "usb",
    role: d.role ?? null,
    usbVendorId: d.usb?.usbVendorId ?? null,
    usbProductId: d.usb?.usbProductId ?? null,
    name: d.name ?? null,
    publicKey: d.publicKey ?? null,
  };
}

/** Whether a message is about this USB device: no ids in it means any device. */
export function samePort(m: Pick<DeviceMessage, "usbVendorId" | "usbProductId">, usb: UsbInfo | null | undefined): boolean {
  if (m.usbVendorId == null && m.usbProductId == null) return true;
  return m.usbVendorId === (usb?.usbVendorId ?? null) && m.usbProductId === (usb?.usbProductId ?? null);
}

/** The granted port that matches the remembered device by its USB ids; null when none or several. */
export function matchPort<P extends { getInfo?(): UsbInfo }>(ports: P[], last: LastDevice | null): P | null {
  if (!last || last.transport !== "usb" || last.usbVendorId == null || last.usbProductId == null) return null;
  const hits = ports.filter((p) => {
    const i = p.getInfo?.();
    return i?.usbVendorId === last.usbVendorId && i?.usbProductId === last.usbProductId;
  });
  return hits.length === 1 ? hits[0] : null;
}
