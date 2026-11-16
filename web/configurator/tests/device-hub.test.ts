import { describe, expect, it, vi } from "vitest";
import { isDeviceMessage as coreIsDeviceMessage, readLast as coreReadLast } from "../src/core/devicebus";
// @ts-expect-error plain JS module of the device hub page
import { startHub } from "../../../src/device-hub.js";
import { isDeviceMessage, LAST_KEY, lastFromInput, readLast } from "../../../src/shared/device-message.js";

const MAP = "https://map.example";
const NODEBOOK = "https://nodebook.example";
const TOOLS = [
  { key: "map", label: "Map", url: `${MAP}/` },
  { key: "nodebook", label: "NodeBook", url: `${NODEBOOK}/` },
  { key: "meshmate", label: "MeshMate", url: "https://app.example:8445/" },
  { key: "bad", label: "Bad", url: "https://user@evil.example/" },
];
const HELD = {
  kind: "bemesh.device",
  v: 1,
  type: "held",
  tool: "nodebook",
  transport: "usb",
  role: "repeater",
  usbVendorId: 0x303a,
  usbProductId: 0x1001,
  name: "BE-GEN-Zoë",
  publicKey: "ab".repeat(32),
};
const NOW = Date.UTC(2026, 10, 10, 12);

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

/** A hub in a frame of `parent`, with its channel, storage and window's message listener. */
function hub(tools: unknown = TOOLS, waitMs?: number) {
  const parent = { postMessage: vi.fn() };
  let onMessage: ((e: unknown) => unknown) | null = null;
  const win = {
    parent,
    location: { origin: MAP, href: `${MAP}/device-hub.html` },
    addEventListener: (type: string, fn: (e: unknown) => unknown) => {
      if (type === "message") onMessage = fn;
    },
  };
  const channel = { postMessage: vi.fn(), onmessage: null as ((e: { data: unknown }) => void) | null };
  const storage = mem();
  const list = tools instanceof Promise ? tools : Promise.resolve(tools);
  const ready = startHub({ win, channel, storage, tools: list, now: () => NOW, ...(waitMs ? { waitMs } : {}) });
  const send = async (data: unknown, origin = NODEBOOK, source: unknown = parent) => {
    await onMessage?.({ data, origin, source });
  };
  const fromChannel = (data: unknown) => channel.onmessage?.({ data });
  return { parent, channel, storage, send, fromChannel, ready };
}

describe("device hub", () => {
  it("relays a device message from a listed tool onto the channel", async () => {
    const h = hub();
    await h.send(HELD);
    expect(h.channel.postMessage).toHaveBeenCalledWith(HELD);
  });

  it("takes messages from the map's own origin too", async () => {
    const h = hub([]);
    await h.send(HELD, MAP);
    expect(h.channel.postMessage).toHaveBeenCalledWith(HELD);
  });

  it("ignores a tool that is not listed, a malformed message and other windows", async () => {
    const h = hub();
    await h.send(HELD, "https://evil.example");
    await h.send(HELD, "https://app.example");
    await h.send({ ...HELD, type: "steal" });
    await h.send({ ...HELD, usbVendorId: 70000 });
    await h.send(HELD, NODEBOOK, { postMessage: vi.fn() });
    expect(h.channel.postMessage).not.toHaveBeenCalled();
    await h.send({ kind: "bemesh.device.getLast", v: 1 }, "https://evil.example");
    h.fromChannel({ ...HELD, tool: "configurator" });
    expect(h.parent.postMessage).not.toHaveBeenCalled();
  });

  it("passes the channel's device messages to its page, only once it knows the page's origin", async () => {
    const h = hub();
    const who = { ...HELD, type: "who", tool: "configurator", transport: null, role: null, usbVendorId: null, usbProductId: null, name: null, publicKey: null };
    h.fromChannel(who);
    expect(h.parent.postMessage).not.toHaveBeenCalled();
    await h.send(HELD, "https://app.example:8445");
    h.fromChannel(who);
    h.fromChannel({ kind: "other" });
    expect(h.parent.postMessage.mock.calls).toEqual([[who, "https://app.example:8445"]]);
  });

  it("keeps to the first page origin it learnt", async () => {
    const h = hub();
    await h.send(HELD, NODEBOOK);
    await h.send({ ...HELD, tool: "meshmate" }, "https://app.example:8445");
    expect(h.channel.postMessage).toHaveBeenCalledTimes(1);
  });

  it("answers getLast from its storage, within 12 hours", async () => {
    const h = hub();
    await h.send({ kind: "bemesh.device.getLast", v: 1 });
    expect(h.parent.postMessage).toHaveBeenLastCalledWith({ kind: "bemesh.device.last", v: 1, last: null }, NODEBOOK);
    const last = { transport: "usb", usbVendorId: 0x303a, usbProductId: 0x1001, role: "repeater", name: "BE-GEN-Zoë", publicKey: null, at: NOW - 3600_000 };
    h.storage.setItem(LAST_KEY, JSON.stringify(last));
    await h.send({ kind: "bemesh.device.getLast", v: 1 });
    expect(h.parent.postMessage).toHaveBeenLastCalledWith({ kind: "bemesh.device.last", v: 1, last }, NODEBOOK);
    h.storage.setItem(LAST_KEY, JSON.stringify({ ...last, at: NOW - 13 * 3600_000 }));
    await h.send({ kind: "bemesh.device.getLast", v: 1 });
    expect(h.parent.postMessage).toHaveBeenLastCalledWith({ kind: "bemesh.device.last", v: 1, last: null }, NODEBOOK);
  });

  it("stores setLast in writeLast's shape, stamped now, and refuses a malformed one", async () => {
    const h = hub();
    await h.send({ kind: "bemesh.device.setLast", v: 1, last: { usbVendorId: 0x303a, usbProductId: 0x1001, role: "companion", name: "Phone", publicKey: null, at: 1 } });
    expect(JSON.parse(h.storage.getItem(LAST_KEY)!)).toEqual({ transport: "usb", usbVendorId: 0x303a, usbProductId: 0x1001, role: "companion", name: "Phone", publicKey: null, at: NOW });
    await h.send({ kind: "bemesh.device.setLast", v: 1, last: { transport: "ble", name: "Phone 2" } });
    expect(JSON.parse(h.storage.getItem(LAST_KEY)!)).toMatchObject({ transport: "ble", name: "Phone 2", usbVendorId: null, role: null, at: NOW });
    for (const last of [{ usbVendorId: -1 }, { name: "x".repeat(65) }, { transport: "wifi" }, "usb", null]) {
      await h.send({ kind: "bemesh.device.setLast", v: 1, last });
    }
    await h.send({ kind: "bemesh.device.setLast", v: 2, last: { name: "v2" } });
    expect(JSON.parse(h.storage.getItem(LAST_KEY)!)).toMatchObject({ name: "Phone 2" });
    expect(h.channel.postMessage).not.toHaveBeenCalled();
  });
});

describe("device hub, held devices", () => {
  it("remembers a relayed held device as the last device, as writeLast would", async () => {
    const h = hub();
    await h.send(HELD);
    expect(JSON.parse(h.storage.getItem(LAST_KEY)!)).toEqual({
      transport: "usb", usbVendorId: 0x303a, usbProductId: 0x1001, role: "repeater", name: "BE-GEN-Zoë", publicKey: "ab".repeat(32), at: NOW,
    });
    await h.send({ ...HELD, type: "who", name: "Other" });
    expect(JSON.parse(h.storage.getItem(LAST_KEY)!).name).toBe("BE-GEN-Zoë");
  });

  it("answers within its wait even when the tool list is slow, and takes the list once it arrives", async () => {
    let arrive: (v: unknown) => void = () => {};
    const slow = new Promise((r) => (arrive = r));
    const h = hub(slow, 50);
    const t0 = Date.now();
    await h.send({ kind: "bemesh.device.getLast", v: 1 }, MAP);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(h.parent.postMessage).toHaveBeenLastCalledWith({ kind: "bemesh.device.last", v: 1, last: null }, MAP);
    const t1 = Date.now();
    await h.send({ kind: "bemesh.device.getLast", v: 1 }, NODEBOOK);
    expect(Date.now() - t1).toBeLessThan(1000);
    expect(h.parent.postMessage).toHaveBeenCalledTimes(1);
    arrive(TOOLS);
    await h.ready;
    const h2 = hub();
    await h2.send({ kind: "bemesh.device.getLast", v: 1 }, NODEBOOK);
    expect(h2.parent.postMessage).toHaveBeenCalledTimes(1);
  });
});

describe("shared device message rules", () => {
  it("are the configurator's", () => {
    expect(coreIsDeviceMessage).toBe(isDeviceMessage);
    expect(coreReadLast).toBe(readLast);
  });

  it("read a setLast like writeLast writes", () => {
    expect(lastFromInput({ name: "A" }, NOW)).toEqual({ transport: "usb", usbVendorId: null, usbProductId: null, role: null, name: "A", publicKey: null, at: NOW });
    expect(lastFromInput({ role: "boss" }, NOW)).toBeNull();
    expect(lastFromInput([], NOW)).toBeNull();
  });
});

/** A hub whose account check is `account`, with the window's storage events and the document's
 * visibility changes under the test's control. */
function accountHub(account: () => Promise<unknown>, tools: unknown = TOOLS) {
  const parent = { postMessage: vi.fn() };
  const on: Record<string, (e: unknown) => unknown> = {};
  const docOn: Record<string, () => unknown> = {};
  const doc = { visibilityState: "visible", addEventListener: (t: string, fn: () => unknown) => (docOn[t] = fn) };
  const win = {
    parent,
    document: doc,
    location: { origin: MAP, href: `${MAP}/device-hub.html` },
    addEventListener: (type: string, fn: (e: unknown) => unknown) => (on[type] = fn),
  };
  const channel = { postMessage: vi.fn(), onmessage: null };
  const storage = mem();
  startHub({ win, channel, storage, tools: Promise.resolve(tools), now: () => NOW, account, accountMs: 50 });
  const send = (data: unknown, origin = NODEBOOK, source: unknown = parent) => on.message?.({ data, origin, source });
  const answers = () => parent.postMessage.mock.calls.filter(([d]) => d?.kind === "bemesh.account");
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { parent, storage, send, answers, settle, storageEvent: (key: string) => on.storage?.({ key }), visible: () => docOn.visibilitychange?.() };
}

const QUERY = { kind: "bemesh.account.query", v: 1 };
const ANN = { signedIn: true, name: "Ann" };

describe("device hub: who is signed in on the map", () => {
  it("answers a listed tool with the display name only", async () => {
    const h = accountHub(async () => ANN);
    await h.send(QUERY);
    await h.settle();
    expect(h.answers()).toEqual([[{ kind: "bemesh.account", v: 1, signedIn: true, name: "Ann" }, NODEBOOK]]);
  });

  it("answers signed out, and signed out when the check fails or is too slow", async () => {
    for (const account of [
      async () => ({ signedIn: false, name: null }),
      async () => { throw new Error("offline"); },
      () => new Promise(() => {}),
      async () => ({ signedIn: "yes", name: "Ann" }),
    ]) {
      const h = accountHub(account);
      await h.send(QUERY);
      await new Promise((r) => setTimeout(r, 80));
      const [[msg]] = h.answers();
      expect(msg).toEqual({ kind: "bemesh.account", v: 1, signedIn: false, name: null });
    }
  });

  it("sends a name only when it is plain text", async () => {
    const h = accountHub(async () => ({ signedIn: true, name: 42, id: "123", handle: "secret" }));
    await h.send(QUERY);
    await h.settle();
    expect(h.answers()[0][0]).toEqual({ kind: "bemesh.account", v: 1, signedIn: true, name: null });
  });

  it("never answers a tool outside the list, a hidden tool or a window that is not its parent", async () => {
    const h = accountHub(async () => ANN, [...TOOLS, { key: "x", label: "X", url: "https://hidden.example/", hidden: true }]);
    await h.send(QUERY, "https://evil.example");
    await h.send(QUERY, "https://hidden.example");
    await h.send(QUERY, NODEBOOK, { postMessage: vi.fn() });
    await h.settle();
    expect(h.parent.postMessage).not.toHaveBeenCalled();
  });

  it("tells the tool again when the state changes in another tab, and only then", async () => {
    let state: unknown = { signedIn: false, name: null };
    const h = accountHub(async () => state);
    await h.send(QUERY);
    await h.settle();
    h.storageEvent("bemesh.account.seen");
    await h.settle();
    expect(h.answers()).toHaveLength(1);
    state = ANN;
    h.storageEvent("something.else");
    await h.settle();
    expect(h.answers()).toHaveLength(1);
    h.storageEvent("bemesh.account.seen");
    await h.settle();
    expect(h.answers().at(-1)?.[0]).toEqual({ kind: "bemesh.account", v: 1, signedIn: true, name: "Ann" });
    state = { signedIn: false, name: null };
    h.visible();
    await h.settle();
    expect(h.answers().at(-1)?.[0]).toMatchObject({ signedIn: false });
    expect(h.answers()).toHaveLength(3);
  });

  it("records a change so the hubs in the other tabs check too", async () => {
    const h = accountHub(async () => ANN);
    await h.send(QUERY);
    await h.settle();
    expect(JSON.parse(h.storage.m.get("bemesh.account.seen") ?? "null")).toEqual({ signedIn: true });
  });

  it("pushes nothing to a tool that never asked", async () => {
    const h = accountHub(async () => ANN);
    await h.send({ kind: "bemesh.device.getLast", v: 1 });
    h.storageEvent("bemesh.account.seen");
    await h.settle();
    expect(h.answers()).toHaveLength(0);
  });
});

describe("device hub: reading the map's account", () => {
  // @ts-expect-error plain JS module
  const load = () => import("../../../src/device-hub.js");
  const reply = (status: number, body: unknown) => async () => ({ ok: status === 200, json: async () => body });

  it("keeps only the display name from /auth/me", async () => {
    const { mapAccount } = await load();
    const me = { authenticated: true, user: { id: "123", username: "ann", global_name: "Ann", avatar: "a1", is_guild_member: true } };
    expect(await mapAccount(reply(200, me))).toEqual({ signedIn: true, name: "Ann" });
    expect(await mapAccount(reply(200, { ...me, user: { ...me.user, global_name: null } }))).toEqual({ signedIn: true, name: "ann" });
  });

  it("is signed out for a signed-out answer or an error", async () => {
    const { mapAccount } = await load();
    expect(await mapAccount(reply(200, { authenticated: false }))).toEqual({ signedIn: false, name: null });
    expect(await mapAccount(reply(500, null))).toEqual({ signedIn: false, name: null });
  });

  it("asks the map's own address with its cookie, never a cached answer", async () => {
    const { mapAccount } = await load();
    const f = vi.fn(reply(200, { authenticated: false }));
    await mapAccount(f);
    expect(f).toHaveBeenCalledWith("/auth/me", { credentials: "same-origin", cache: "no-store" });
  });
});
