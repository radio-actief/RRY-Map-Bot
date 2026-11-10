/* The site's device convention, the rules every tool checks the same way: the message shape on the
 * BroadcastChannel "bemesh-device" and the device remembered in localStorage "bemesh.device.last".
 * Used by the configurator (web/configurator/src/core/devicebus.ts) and the device hub
 * (device-hub.html, src/device-hub.js), which other tools load in a hidden frame. */

export const CHANNEL = "bemesh-device";
export const LAST_KEY = "bemesh.device.last";
/** A remembered device older than this is not offered again. */
export const LAST_MAX_AGE_MS = 12 * 3600_000;

const TYPES = ["who", "held", "release", "released", "busy"];
const TRANSPORTS = ["usb", "ble", "bridge"];
const ROLES = ["repeater", "room", "sensor", "companion"];
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const idOrNull = (v) => v === null || v === undefined || (Number.isInteger(v) && v >= 0 && v <= 0xffff);
const textOrNull = (v, max) => v === null || v === undefined || (typeof v === "string" && v.length <= max);

/** Whether `data` is a device message of this convention. */
export function isDeviceMessage(data) {
  if (!isObject(data) || data.kind !== "bemesh.device" || data.v !== 1) return false;
  if (!TYPES.includes(data.type) || typeof data.tool !== "string" || !data.tool || data.tool.length > 40) return false;
  if (!(data.transport === null || data.transport === undefined || TRANSPORTS.includes(data.transport))) return false;
  if (!(data.role === null || data.role === undefined || ROLES.includes(data.role))) return false;
  return idOrNull(data.usbVendorId) && idOrNull(data.usbProductId) && textOrNull(data.name, 64) && textOrNull(data.publicKey, 64);
}

/** The device last connected in this browser, unless it is older than 12 hours or unreadable. */
export function readLast(storage, now = Date.now()) {
  try {
    const raw = storage?.getItem(LAST_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!isObject(v) || !TRANSPORTS.includes(v.transport) || typeof v.at !== "number") return null;
    if (now - v.at > LAST_MAX_AGE_MS || v.at > now + 60_000) return null;
    if (!idOrNull(v.usbVendorId) || !idOrNull(v.usbProductId) || !textOrNull(v.name, 64) || !textOrNull(v.publicKey, 64)) return null;
    return {
      transport: v.transport,
      usbVendorId: v.usbVendorId ?? null,
      usbProductId: v.usbProductId ?? null,
      role: ROLES.includes(v.role) ? v.role : null,
      name: v.name ?? null,
      publicKey: v.publicKey ?? null,
      at: v.at,
    };
  } catch {
    return null;
  }
}

/** Remember the connected USB device for the next tool (nothing secret in it). */
export function writeLast(storage, d, now = Date.now()) {
  try {
    storage?.setItem(LAST_KEY, JSON.stringify({ transport: "usb", ...d, at: now }));
  } catch {
    /* private window or blocked storage: no reconnect offer next time */
  }
}

/**
 * Another tool's remembered device (a hub's setLast) as writeLast stores it, stamped `now`; null
 * when any field breaks the rules. The transport defaults to "usb", as in writeLast.
 */
export function lastFromInput(v, now = Date.now()) {
  if (!isObject(v)) return null;
  const transport = v.transport === undefined || v.transport === null ? "usb" : v.transport;
  if (!TRANSPORTS.includes(transport)) return null;
  if (!(v.role === null || v.role === undefined || ROLES.includes(v.role))) return null;
  if (!idOrNull(v.usbVendorId) || !idOrNull(v.usbProductId) || !textOrNull(v.name, 64) || !textOrNull(v.publicKey, 64)) return null;
  return {
    transport,
    usbVendorId: v.usbVendorId ?? null,
    usbProductId: v.usbProductId ?? null,
    role: v.role ?? null,
    name: v.name ?? null,
    publicKey: v.publicKey ?? null,
    at: now,
  };
}
