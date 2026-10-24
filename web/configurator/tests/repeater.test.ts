import { describe, expect, it, vi } from "vitest";
import read from "./fixtures/read-ronse.json";
import { FakePort } from "./fakes/fake-port";
import { SerialLink, isErrorReply } from "../src/device/serial";
import { READ_COMMANDS, apply, checkFirmware, readAll, run } from "../src/device/repeater";

const FAST = { interCommandDelayMs: 0, bootDrainMs: 0, disconnectSettleMs: 0, replyTimeoutMs: 40 };

async function linkTo(replies: Record<string, string>, disconnectAfter?: number) {
  const port = new FakePort(replies, { disconnectAfter });
  const link = new SerialLink(port, FAST);
  await link.open();
  return { port, link };
}

describe("readAll", () => {
  it("reads every setting from the ronse fixture", async () => {
    const { link } = await linkTo(read);
    const s = await readAll(link);
    expect(s.name).toBe("BE-RON-Kluisberg🌞");
    expect(s.radio).toEqual({ freq: 869.618, sf: 8, bw: 62.5, cr: 8 });
    expect(s.missing).toEqual([]);
    expect(s.version).toBe("v1.17.1 (Build: 12-Oct-2026)");
    await link.close();
  });

  it("puts error replies in missing", async () => {
    const { link } = await linkTo({ ...read, "get multi.acks": "Err - unknown", "get tx": "" });
    const s = await readAll(link);
    expect(s.missing.sort()).toEqual(["get multi.acks", "get tx"]);
    expect(s.settings.multiAcks).toBeUndefined();
  });

  it("keeps what was read when the link drops, and fires onDisconnect", async () => {
    const { link } = await linkTo(read, 6);
    const lost = vi.fn();
    link.onDisconnect(lost);
    const s = await readAll(link);
    expect(s.name).toBe("BE-RON-Kluisberg🌞");
    expect(s.radio).toBeDefined();
    expect(s.missing).toEqual(READ_COMMANDS.slice(5));
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe("apply", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `set k${i} v`);
  const replies = Object.fromEntries(lines.map((l) => [l, "OK"]));

  it("sends every line", async () => {
    const { link, port } = await linkTo(replies);
    const seen: number[] = [];
    expect(await apply(link, lines, (n) => seen.push(n))).toEqual({ ok: true });
    expect(port.received).toEqual(lines);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("stops at the failing line when the link drops during it", async () => {
    const { link } = await linkTo(replies, 4);
    const seen: number[] = [];
    const r = await apply(link, lines, (n) => seen.push(n));
    expect(r).toMatchObject({ ok: false, failedAt: 4, command: "set k3 v" });
    if (!r.ok) {
      expect(r.remaining).toEqual(lines.slice(4));
      expect(r.remaining).toHaveLength(6);
    }
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it("stops at an Err reply and does not retry", async () => {
    const { link, port } = await linkTo({ ...replies, "set k2 v": "Err - bad value" });
    const r = await apply(link, lines, () => {});
    expect(r).toMatchObject({ ok: false, failedAt: 3, error: "Err - bad value" });
    expect(port.received.filter((l) => l === "set k2 v")).toHaveLength(1);
    expect(port.received).toHaveLength(3);
  });
});

describe("after a timeout", () => {
  it("the next replies are not stolen, and apply stops on the Err", async () => {
    const { link } = await linkTo({ silent: "", "get a": "A", "set b 1": "Err - bad value", "set c 1": "OK" });
    expect(await link.command("silent")).toBe("");
    expect(await link.command("get a")).toBe("A");
    expect(await link.command("set b 1")).toBe("Err - bad value");
    const r = await apply(link, ["silent", "set b 1", "set c 1"], () => {});
    expect(r).toMatchObject({ ok: false, failedAt: 2, error: "Err - bad value", remaining: ["set c 1"] });
  });

  it("an unknown key or command fails apply and lands in readAll's missing", async () => {
    const { "get tx": _tx, ...withoutTx } = read;
    const { link } = await linkTo(withoutTx);
    expect(await link.command("get nope")).toBe("??: nope");
    expect(await link.command("set nope 1")).toBe("unknown config: nope");
    expect(await link.command("bogus")).toBe("Unknown command");
    expect(["??: x", "unknown config: x", "Unknown command"].every(isErrorReply)).toBe(true);
    expect((await readAll(link)).missing).toEqual(["get tx"]);
    expect(await apply(link, ["set nope 1"], () => {})).toMatchObject({ ok: false, failedAt: 1 });
  });

  it("close wakes a pending command at once", async () => {
    const { link } = await linkTo({ silent: "" });
    const p = link.command("silent", 5000);
    const rejected = expect(p).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    await link.close();
    await rejected;
  });
});

describe("run and checkFirmware", () => {
  it("run returns the reply", async () => {
    const { link } = await linkTo({ clock: "14:05" });
    expect(await run(link, "clock")).toBe("14:05");
  });

  it.each([
    ["v1.15.0 (Build: x)", "old", "v1.15.0"],
    ["", "unknown", null],
    ["v1.17.1", "ok", "v1.17.1"],
  ])("ver %j is %s", async (ver, state, version) => {
    const { link } = await linkTo({ ver });
    const r = await checkFirmware(link);
    expect(r).toEqual({ state, version });
  });
});
