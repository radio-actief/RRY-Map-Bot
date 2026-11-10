/**
 * The configurator's side of the site's device convention (core/devicebus.ts): it says on the
 * `bemesh-device` channel which device it holds, answers `who`, lets go on `release` (or answers
 * `busy` while it sends to the device), remembers the device for the next tool, and offers
 * "Reconnect <name>" for a remembered port this browser already granted.
 */
import { signal } from "@preact/signals";
import {
  ANSWER_MS,
  CHANNEL,
  isDeviceMessage,
  matchPort,
  message,
  readLast,
  roleOf,
  samePort,
  TOOL,
  writeLast,
  type DeviceMessage,
  type MessageType,
} from "../core/devicebus";
import type { PortLike } from "../device/serial";
import { busy, store } from "./store";

/** A remembered device whose port is granted and plugged in: the chip offers to open it again. */
export const reconnect = signal<{ name: string; port: PortLike } | null>(null);
/** What the other tabs hold, by tool. */
export const heldElsewhere = signal<Record<string, DeviceMessage>>({});

export type Channel = Pick<BroadcastChannel, "postMessage" | "close"> & { onmessage: ((e: MessageEvent) => void) | null };
type Deps = {
  channel?: Channel | null;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  getPorts?: () => Promise<PortLike[]>;
  /** Closes this tab's device (the release a `release` asks for). */
  disconnect: () => Promise<void>;
};

let deps: Deps | null = null;

function storageOrNull(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function defaultGetPorts(): Promise<PortLike[]> {
  const serial = (typeof navigator !== "undefined" ? (navigator as unknown as { serial?: { getPorts?: () => Promise<PortLike[]> } }).serial : undefined);
  return serial?.getPorts ? serial.getPorts() : Promise.resolve([]);
}

/** This tab's device, as the convention describes it; null when none is connected. */
function held(): Parameters<typeof message>[1] | null {
  const d = store.device.peek();
  if (d.status !== "connected") return null;
  const snap = store.snapshot.peek();
  return { usb: d.usb ?? null, role: roleOf(snap?.role) ?? (d.firmware ? "repeater" : null), name: snap?.name ?? d.name ?? null, publicKey: snap?.publicKey ?? null };
}

function post(type: MessageType, about: Parameters<typeof message>[1] = {}): void {
  try {
    deps?.channel?.postMessage(message(type, about));
  } catch {
    /* channel closed */
  }
}

/** Sending, reading or counting: a release has to wait. */
const working = () => busy.peek() || store.applying.peek() || store.reading.peek() || store.tune.peek().phase === "counting";

async function onMessage(data: unknown): Promise<void> {
  if (!isDeviceMessage(data) || data.tool === TOOL) return;
  if (data.type === "held") {
    heldElsewhere.value = { ...heldElsewhere.peek(), [data.tool]: data };
    // An offer made before that tab said so is no one-click Reconnect any more.
    void refreshReconnect();
    return;
  }
  if (data.type === "released") {
    const { [data.tool]: _gone, ...rest } = heldElsewhere.peek();
    heldElsewhere.value = rest;
    void refreshReconnect();
    return;
  }
  const mine = held();
  if (!mine) return;
  if (data.type === "who") return post("held", mine);
  if (data.type === "release" && samePort(data, mine.usb)) {
    if (working()) return post("busy", mine);
    await deps?.disconnect();
    post("released", mine);
  }
}

/** Starts the convention for this page: says who it is, then listens. Returns a stop function. */
export function startDeviceBus(d: Deps): () => void {
  const channel =
    d.channel !== undefined ? d.channel : typeof BroadcastChannel === "undefined" ? null : (new BroadcastChannel(CHANNEL) as Channel);
  deps = { storage: storageOrNull(), getPorts: defaultGetPorts, ...d, channel };
  if (channel) channel.onmessage = (e) => void onMessage(e.data);
  post("who");
  void refreshReconnect();
  return () => {
    if (channel) channel.onmessage = null;
    try {
      channel?.close();
    } catch {
      /* already closed */
    }
    deps = null;
  };
}

/** Connected (or its Read told its name and key): tell the other tabs, and remember it for the next tool. */
export function deviceHeld(): void {
  const mine = held();
  if (!mine) return;
  reconnect.value = null;
  post("held", mine);
  writeLast(deps?.storage ?? null, {
    usbVendorId: mine.usb?.usbVendorId ?? null,
    usbProductId: mine.usb?.usbProductId ?? null,
    role: mine.role ?? null,
    name: mine.name ?? null,
    publicKey: mine.publicKey ?? null,
  });
}

/** This tab let go of its device. */
export function deviceReleased(usb: { usbVendorId?: number; usbProductId?: number } | null | undefined): void {
  post("released", { usb: usb ?? null });
  void refreshReconnect();
}

/** Look for the remembered device among the granted ports, for the chip's "Reconnect <name>". */
export async function refreshReconnect(): Promise<void> {
  if (!deps || store.device.peek().status !== "none") return void (reconnect.value = null);
  const last = readLast(deps.storage ?? null);
  let ports: PortLike[] = [];
  try {
    ports = (await deps.getPorts?.()) ?? [];
  } catch {
    ports = [];
  }
  const port = matchPort(ports, last);
  // A port another tab says it holds is no one-click reconnect: Connect offers to take it over.
  const heldThere = !!port && holderOf(port.getInfo?.()) !== null;
  reconnect.value = port && last && !heldThere && store.device.peek().status === "none" ? { name: last.name || "USB", port } : null;
}

/** The tool in another tab that holds this USB device, if one said so. */
export function holderOf(usb: { usbVendorId?: number; usbProductId?: number } | null | undefined): string | null {
  const hit = Object.values(heldElsewhere.peek()).find((m) => m.transport === "usb" && m.usbVendorId != null && samePort(m, usb));
  return hit ? hit.tool : null;
}

/**
 * Ask the tab that holds this device to let go. Resolves "released", "busy", or "noAnswer"
 * after ANSWER_MS.
 */
export function askRelease(
  usb: { usbVendorId?: number; usbProductId?: number } | null | undefined,
  channelFactory: () => Channel | null = () => (typeof BroadcastChannel === "undefined" ? null : (new BroadcastChannel(CHANNEL) as Channel)),
  waitMs = ANSWER_MS,
): Promise<"released" | "busy" | "noAnswer"> {
  const ch = channelFactory();
  if (!ch) return Promise.resolve("noAnswer");
  return new Promise((resolve) => {
    const done = (r: "released" | "busy" | "noAnswer") => {
      clearTimeout(timer);
      ch.onmessage = null;
      try {
        ch.close();
      } catch {
        /* closed */
      }
      resolve(r);
    };
    ch.onmessage = (e) => {
      const m = e.data;
      if (!isDeviceMessage(m) || m.tool === TOOL || !samePort(m, usb)) return;
      if (m.type === "released") done("released");
      if (m.type === "busy") done("busy");
    };
    const timer = setTimeout(() => done("noAnswer"), waitMs);
    ch.postMessage(message("release", { usb: usb ?? null }));
  });
}
