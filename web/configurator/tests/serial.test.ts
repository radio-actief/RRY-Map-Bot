import { describe, expect, it } from "vitest";
import { FakePort, type FakePortOptions } from "./fakes/fake-port";
import { SerialLink } from "../src/device/serial";

const FAST = { interCommandDelayMs: 0, bootDrainMs: 0, disconnectSettleMs: 0, replyTimeoutMs: 40 };

async function linkTo(replies: Record<string, string>, opts: FakePortOptions = {}) {
  const port = new FakePort(replies, opts);
  const link = new SerialLink(port, FAST);
  await link.open();
  return { port, link };
}

const OWNER = "Beheer: Radio-Actief vzw|Contact via #BEmesh op Discord|Zonnepaneel 20W + 18650 accu op de mast";
const PUBKEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("reply framing", () => {
  it("a reply split over many USB chunks arrives whole", async () => {
    const replies = {
      "get owner.info": `> ${OWNER}`,
      "get public.key": `> ${PUBKEY}`,
      "get name": "> BE-RON-Kluisberg🌞",
    };
    const { link } = await linkTo(replies, { chunkSize: 5 });
    expect(await link.command("get owner.info", 2000)).toBe(`> ${OWNER}`);
    expect(await link.command("get public.key", 2000)).toBe(`> ${PUBKEY}`);
    expect(await link.command("get name", 2000)).toBe("> BE-RON-Kluisberg🌞");
  });

  it("a late reply to a timed-out command is not taken by the next one", async () => {
    const { link } = await linkTo({ slow: "SLOW", "get a": "A" }, { delayMs: { slow: 80 } });
    expect(await link.command("slow")).toBe("");
    expect(await link.command("get a", 1000)).toBe("A");
  });

  it("on timeout the started part of the reply line is returned", async () => {
    const { link } = await linkTo({}, { raw: { "get x": "get x\r\n  -> partial rep" } });
    expect(await link.command("get x")).toBe("partial rep");
  });

  it("reads a room server, which echoes the line without a newline", async () => {
    const { link } = await linkTo({}, { raw: { "get name": "get name\r  -> > Room\r\n" } });
    expect(await link.command("get name")).toBe("> Room");
  });
});

describe("what send refuses", () => {
  it.each([
    "set name x\rerase",
    "set guest.password g\rset prv.key aa",
    "set owner.info a\nb",
    "set owner.info a\tb",
    "set owner.info a\x7fb",
  ])("a line with a control character: %j", async (line) => {
    const { link, port } = await linkTo({});
    await expect(link.command(line)).rejects.toThrow(/control character/);
    expect(port.received).toEqual([]);
  });

  it("measures the line limit in UTF-8 bytes", async () => {
    const { link, port } = await linkTo({});
    const line = `set owner.info ${"é".repeat(70)}`;
    expect(line.length).toBeLessThan(151);
    await expect(link.command(line)).rejects.toThrow(/too long \(155 > 151/i);
    expect(port.received).toEqual([]);
    const fits = `set owner.info ${"é".repeat(68)}`;
    expect(await link.command(fits)).toBe("unknown config: owner.info");
  });
});
