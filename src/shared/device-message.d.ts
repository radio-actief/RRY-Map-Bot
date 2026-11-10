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

type Store = Pick<Storage, "getItem" | "setItem">;

export const CHANNEL: "bemesh-device";
export const LAST_KEY: "bemesh.device.last";
export const LAST_MAX_AGE_MS: number;
/** Whether `data` is a device message of this convention. */
export function isDeviceMessage(data: unknown): data is DeviceMessage;
/** The device last connected in this browser, unless it is older than 12 hours or unreadable. */
export function readLast(storage: Store | null, now?: number): LastDevice | null;
/** Remember the connected USB device for the next tool (nothing secret in it). */
export function writeLast(storage: Store | null, d: Omit<LastDevice, "transport" | "at">, now?: number): void;
/** Another tool's remembered device as writeLast stores it, stamped `now`; null when malformed. */
export function lastFromInput(v: unknown, now?: number): LastDevice | null;
