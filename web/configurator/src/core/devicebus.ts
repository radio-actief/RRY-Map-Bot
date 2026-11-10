/**
 * The site's device convention (shared with NodeBook and MeshMate): one way to connect on every
 * tool. Tools in other tabs talk on the BroadcastChannel `bemesh-device`; the device last
 * connected in this browser is kept in localStorage `bemesh.device.last`, so the next tool can
 * offer "Reconnect <name>" for a port the person already chose (one click, never by itself).
 */
import type { UsbInfo } from "../device/usb";

export const CHANNEL = "bemesh-device";
export const LAST_KEY = "bemesh.device.last";
/** A remembered device older than this is not offered again. */
export const LAST_MAX_AGE_MS = 12 * 3600_000;
/** Nobody waits longer than this for an answer on the channel. */
export const ANSWER_MS = 2000;
export const TOOL = "configurator";

export type Transport = "usb" | "ble" | "bridge";
export type DeviceRole = "repeater" | "room" | "sensor" | "companion" | null;
export type MessageType = "who" | "held" | "release" | "released" | "busy";

export type DeviceMessage = {
  kind: "bemesh.device";
  v: 1;
  type: MessageType;
  tool: string;
  transport: Transport | null;
  role: DeviceRole;
  usbVendorId: number | null;
  usbProductId: number | null;
  name: string | null;
  publicKey: string | null;
};

export type LastDevice = {
  transport: Transport;
  usbVendorId: number | null;
  usbProductId: number | null;
  role: DeviceRole;
  name: string | null;
  publicKey: string | null;
  at: number;
};

const TYPES: MessageType[] = ["who", "held", "release", "released", "busy"];
const TRANSPORTS: Transport[] = ["usb", "ble", "bridge"];
const ROLES = ["repeater", "room", "sensor", "companion"];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const idOrNull = (v: unknown) => v === null || v === undefined || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffff);
const textOrNull = (v: unknown, max: number) => v === null || v === undefined || (typeof v === "string" && v.length <= max);

/** Whether `data` is a device message of this convention. */
export function isDeviceMessage(data: unknown): data is DeviceMessage {
  if (!isObject(data) || data.kind !== "bemesh.device" || data.v !== 1) return false;
  if (!TYPES.includes(data.type as MessageType) || typeof data.tool !== "string" || !data.tool || data.tool.length > 40) return false;
  if (!(data.transport === null || data.transport === undefined || TRANSPORTS.includes(data.transport as Transport))) return false;
  if (!(data.role === null || data.role === undefined || ROLES.includes(data.role as string))) return false;
  return idOrNull(data.usbVendorId) && idOrNull(data.usbProductId) && textOrNull(data.name, 64) && textOrNull(data.publicKey, 64);
}

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

type Store = Pick<Storage, "getItem" | "setItem">;

/** The device last connected in this browser, unless it is older than 12 hours or unreadable. */
export function readLast(storage: Store | null, now = Date.now()): LastDevice | null {
  try {
    const raw = storage?.getItem(LAST_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (!isObject(v) || !TRANSPORTS.includes(v.transport as Transport) || typeof v.at !== "number") return null;
    if (now - v.at > LAST_MAX_AGE_MS || v.at > now + 60_000) return null;
    if (!idOrNull(v.usbVendorId) || !idOrNull(v.usbProductId) || !textOrNull(v.name, 64) || !textOrNull(v.publicKey, 64)) return null;
    return {
      transport: v.transport as Transport,
      usbVendorId: (v.usbVendorId as number | null) ?? null,
      usbProductId: (v.usbProductId as number | null) ?? null,
      role: ROLES.includes(v.role as string) ? (v.role as DeviceRole) : null,
      name: (v.name as string | null) ?? null,
      publicKey: (v.publicKey as string | null) ?? null,
      at: v.at,
    };
  } catch {
    return null;
  }
}

/** Remember the connected USB device for the next tool (nothing secret in it). */
export function writeLast(storage: Store | null, d: Omit<LastDevice, "transport" | "at">, now = Date.now()): void {
  try {
    storage?.setItem(LAST_KEY, JSON.stringify({ transport: "usb", ...d, at: now }));
  } catch {
    /* private window or blocked storage: no reconnect offer next time */
  }
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
