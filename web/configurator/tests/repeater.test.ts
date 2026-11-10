import { describe, expect, it, vi } from "vitest";
import read from "./fixtures/read-ronse.json";
import { FakePort, type FakePortOptions } from "./fakes/fake-port";
import { SerialLink, isErrorReply } from "../src/device/serial";
import { READ_BACK_COMMANDS, READ_COMMANDS, apply, checkFirmware, readAll, readCount, run, stoppedApply } from "../src/device/repeater";
import { regionReplies, type FwRegion } from "./fakes/region-firmware";

const FAST = { interCommandDelayMs: 0, bootDrainMs: 0, disconnectSettleMs: 0, replyTimeoutMs: 40 };

async function linkTo(replies: Record<string, string>, disconnectAfter?: number, opts: FakePortOptions = {}) {
  const port = new FakePort(replies, { disconnectAfter, ...opts });
  const link = new SerialLink(port, FAST);
  await link.open();
  return { port, link };
}

/** A repeater with many regions: be, Vlaanderen, Oost-Vlaanderen and `n` municipalities under it, the last one denied. */
function bigTable(n: number): FwRegion[] {
  const munis = Array.from({ length: n }, (_, i) => ({ name: `be${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}x`, parent: "be-vov", flood: i < n - 1 }));
  return [{ name: "be", flood: true }, { name: "be-vlg", parent: "be", flood: true }, { name: "be-vov", parent: "be-vlg", flood: true }, ...munis];
}

describe("readAll: regions longer than one reply", () => {
  it("a tree the firmware cut off is completed with region get for the names in the lists", async () => {
    const table = bigTable(16);
    const { replies, fullTree } = regionReplies(table);
    expect(fullTree.length).toBeGreaterThan(159);
    expect(replies.region.length).toBe(159);
    const { port, link } = await linkTo({ ...read, ...replies });
    const s = await readAll(link);
    const asked = port.received.filter((c) => c.startsWith("region get "));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.length).toBeLessThan(table.length);
    expect(Object.keys(s.regions!.parents!).sort()).toEqual(table.map((r) => r.name).sort());
    for (const r of table) expect(s.regions!.parents![r.name]).toBe(r.parent ?? null);
    expect(s.regions!.allowed.sort()).toEqual(["*", ...table.filter((r) => r.flood).map((r) => r.name)].sort());
    expect(s.regions!.denied).toEqual([table.at(-1)!.name]);
    expect(s.regions!.incomplete).toBeFalsy();
  });

  it("when the allowed list is cut too, every region it knows is asked for, and the read says it may be incomplete", async () => {
    const table = bigTable(28);
    const { replies } = regionReplies(table);
    expect(replies["region list allowed"].length).toBeGreaterThanOrEqual(127);
    const listed = replies["region list allowed"].split(",");
    const skipped = table.filter((r) => r.flood && !listed.includes(r.name));
    expect(skipped.length).toBeGreaterThan(0);
    const { port, link } = await linkTo({ ...read, ...replies });
    const s = await readAll(link, READ_COMMANDS, () => table.map((r) => r.name));
    for (const r of skipped) expect(port.received).toContain(`region get ${r.name}`);
    expect(s.regions!.allowed.sort()).toEqual(["*", ...table.filter((r) => r.flood).map((r) => r.name)].sort());
    expect(Object.keys(s.regions!.parents!).length).toBe(table.length);
    expect(s.regions!.incomplete).toBe(true);
  });

  it("reads the neighbour table, and the read-back after Apply does not ask it again", async () => {
    const { link } = await linkTo(read);
    const s = await readAll(link, READ_COMMANDS, () => []);
    expect(s.neighbours).toEqual([
      { prefix: "a1b2c3d4", agoS: 300, snr: 7 },
      { prefix: "5e6f7a8b", agoS: 7200, snr: -2.5 },
    ]);
    expect(READ_BACK_COMMANDS).not.toContain("neighbors");
  });

  it("a short tree and short lists ask nothing more", async () => {
    const { port, link } = await linkTo(read);
    const s = await readAll(link, READ_COMMANDS, () => ["be", "beron", "bexyz"]);
    expect(port.received.some((c) => c.startsWith("region get"))).toBe(false);
    expect(s.regions!.incomplete).toBeFalsy();
  });
});

describe("readAll: radio.fem.rxgain, on a few boards only", () => {
  it("is read; a board without it answers an error, which is not a missing read", async () => {
    expect(READ_COMMANDS).toContain("get radio.fem.rxgain");
    const { link } = await linkTo({ ...read, "get radio.fem.rxgain": "Error: unsupported" });
    const s = await readAll(link);
    expect(s.missing).toEqual([]);
    expect(s.settings.radioFemRxgain).toBeUndefined();
    expect(readCount(s)).toBe(READ_COMMANDS.length - 1);
  });

  it("a board with it gives its value", async () => {
    const { link } = await linkTo({ ...read, "get radio.fem.rxgain": "off" });
    const s = await readAll(link);
    expect(s.settings.radioFemRxgain).toBe("off");
    expect(readCount(s)).toBe(READ_COMMANDS.length);
  });
});

describe("readAll", () => {
  it("reads every setting from the ronse fixture", async () => {
    const { link } = await linkTo(read);
    const s = await readAll(link);
    expect(s.name).toBe("BE-RON-Proefberg🌞");
    expect(s.radio).toEqual({ freq: 869.618, sf: 8, bw: 62.5, cr: 8 });
    expect(s.missing).toEqual([]);
    expect(s.version).toBe("v1.17.1 (Build: 12-Oct-2026)");
    await link.close();
  });

  it("reads the same when every reply arrives in small USB chunks", async () => {
    const port = new FakePort(read, { chunkSize: 5 });
    const link = new SerialLink(port, { ...FAST, replyTimeoutMs: 2000 });
    await link.open();
    const s = await readAll(link);
    const { link: whole } = await linkTo(read);
    expect(s).toEqual(await readAll(whole));
    expect(s.missing).toEqual([]);
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
    expect(s.name).toBe("BE-RON-Proefberg🌞");
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
    expect(await apply(link, lines, (n) => seen.push(n))).toEqual({ ok: true, silent: [] });
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

describe("apply: lines that get no reply", () => {
  const lines = Array.from({ length: 8 }, (_, i) => `set k${i} v`);
  const replies = Object.fromEntries(lines.map((l) => [l, "OK"]));
  const sent = (port: FakePort, line: string) => port.received.filter((l) => l === line).length;

  it("a line with no reply is tried again, and counts once it answers", async () => {
    const { link, port } = await linkTo(replies, undefined, { sequence: { "set k2 v": ["", "", "OK"] } });
    const seen: number[] = [];
    expect(await apply(link, lines, (n) => seen.push(n))).toEqual({ ok: true, silent: [] });
    expect(sent(port, "set k2 v")).toBe(3);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("gives up on a line after 4 tries and carries on; the result names it", async () => {
    const { link, port } = await linkTo({ ...replies, "set k2 v": "" });
    expect(await apply(link, lines, () => {})).toEqual({ ok: true, silent: ["set k2 v"] });
    expect(sent(port, "set k2 v")).toBe(4);
    expect(port.received.at(-1)).toBe("set k7 v");
  });

  it("stops when 3 lines in a row get no reply", async () => {
    const { link, port } = await linkTo({ ...replies, "set k2 v": "", "set k3 v": "", "set k4 v": "" });
    const r = await apply(link, lines, () => {});
    expect(r).toEqual({ ok: false, failedAt: 5, command: "set k4 v", error: "", remaining: lines.slice(5), silent: 3 });
    expect(port.received).not.toContain("set k5 v");
  });

  it("a reply between them starts the count again", async () => {
    const { link } = await linkTo({ ...replies, "set k1 v": "", "set k2 v": "", "set k4 v": "", "set k5 v": "" });
    expect(await apply(link, lines, () => {})).toEqual({ ok: true, silent: ["set k1 v", "set k2 v", "set k4 v", "set k5 v"] });
  });

  it("an error that only comes on a retry counts as no reply: the first try may have run", async () => {
    const lines2 = ["region remove be-old", "region save"];
    const { link } = await linkTo({ "region save": "OK" }, undefined, { sequence: { "region remove be-old": ["", "Err - not found"] } });
    expect(await apply(link, lines2, () => {})).toEqual({ ok: true, silent: ["region remove be-old"] });
  });

  it("an error reply is not tried again", async () => {
    const { link, port } = await linkTo({ ...replies, "set k2 v": "Err - bad value" });
    await apply(link, lines, () => {});
    expect(sent(port, "set k2 v")).toBe(1);
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

  it("carries on past gps advert on firmware built without GPS", async () => {
    const lines = ["set lat 0", "set lon 0", "gps advert none", "region home be"];
    const { link, port } = await linkTo({ "set lat 0": "OK", "set lon 0": "OK", "gps advert none": "Unknown command", "region home be": "OK" });
    expect(await apply(link, lines, () => {})).toEqual({ ok: true, silent: [] });
    expect(port.received).toEqual(lines);
  });

  it("still stops at a gps advert Err reply", async () => {
    const { link } = await linkTo({ "gps advert share": "Err - no GPS" });
    expect(await apply(link, ["gps advert share", "set x 1"], () => {})).toMatchObject({ ok: false, failedAt: 1 });
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

describe("stoppedApply", () => {
  const lines = ["set name X", "region put be", "region allowf be", "region save", "set repeat on"];

  it("counts the commands that went through before the failed one", () => {
    expect(stoppedApply(lines, 3).done).toBe(2);
    expect(stoppedApply(lines, 1).done).toBe(0);
  });

  it("region changes that went through stay unsaved until region save went through too", () => {
    expect(stoppedApply(lines, 3).regionsUnsaved).toBe(true);
    expect(stoppedApply(lines, 4).regionsUnsaved).toBe(true);
    expect(stoppedApply(lines, 5).regionsUnsaved).toBe(false);
    expect(stoppedApply(lines, 2).regionsUnsaved).toBe(false);
  });

  it("a region save that got no reply does not count as saved", () => {
    expect(stoppedApply(lines, 5, ["region save"]).regionsUnsaved).toBe(true);
    expect(stoppedApply(lines, 5, ["set name X"]).regionsUnsaved).toBe(false);
  });
});
