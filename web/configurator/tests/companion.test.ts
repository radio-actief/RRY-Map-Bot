import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  channelErrors,
  channelLink,
  channelSecret,
  channelsFor,
  EXCLUDED_CHANNELS,
  pickProvince,
  type Channel,
  type ChannelData,
  type CompanionPick,
} from "../src/core/companion";
import { PROVINCE_CODES } from "../src/core/be-regions";
import { sha256Hex } from "../src/core/sha256";
import type { Place } from "../src/core/search";

const ROOT = resolve(__dirname, "../../..");
const data = JSON.parse(readFileSync(`${ROOT}/data/companion-channels.json`, "utf8")) as ChannelData;
const places = JSON.parse(readFileSync(`${ROOT}/data/be-locode.json`, "utf8")) as Place[];
const place = (name: string) => places.find((p) => p.plaats === name)!;
const names = (list: { channel: Channel }[]) => list.map((c) => c.channel.name);
const scopes = (list: { channel: Channel; scope: string | null }[]) => Object.fromEntries(list.map((c) => [c.channel.name, c.scope]));

describe("sha256Hex", () => {
  it("matches the standard test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // Two blocks: 56 bytes of input push the length into a second block.
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("hashes UTF-8 bytes", () => {
    expect(sha256Hex("é")).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
  });
});

describe("channel secret and link", () => {
  it("the secret of a hashtag channel is the first 16 bytes of sha256 of its name", () => {
    // MeshCore docs/companion_protocol.md: #test has the key 9cd8fcf22a47333b591d96a2b848b73f.
    expect(channelSecret("#test")).toBe("9cd8fcf22a47333b591d96a2b848b73f");
    expect(channelSecret("#bemesh")).toBe("4e92675e10b4a5b3df305e86a6f4f8fa");
  });

  it("builds the exact add-channel link for #bemesh with region be", () => {
    expect(channelLink("#bemesh", "be")).toBe(
      "meshcore://channel/add?name=%23bemesh&secret=4e92675e10b4a5b3df305e86a6f4f8fa&region_scope=be",
    );
  });

  it("leaves region_scope out without a region", () => {
    expect(channelLink("#bemesh", null)).toBe("meshcore://channel/add?name=%23bemesh&secret=4e92675e10b4a5b3df305e86a6f4f8fa");
  });

  it("encodes the region", () => {
    expect(channelLink("#oostende", "be-vwv")).toBe(
      "meshcore://channel/add?name=%23oostende&secret=a10656e857573cb63f14932cfe377368&region_scope=be-vwv",
    );
  });
});

describe("channels for a place", () => {
  const all: CompanionPick = { type: "country" };
  const oostende: CompanionPick = { type: "city", place: place("Oostende") };
  const brugge: CompanionPick = { type: "city", place: place("Brugge") };
  const namur: CompanionPick = { type: "city", place: place("Namur") };
  const westVl: CompanionPick = { type: "province", code: "be-vwv" };

  it("the province of a pick", () => {
    expect(pickProvince(all)).toBeNull();
    expect(pickProvince(oostende)).toBe("be-vwv");
    expect(pickProvince(westVl)).toBe("be-vwv");
  });

  it("the national channels always show, with region be, #bemesh first", () => {
    for (const pick of [all, oostende, namur]) {
      const { national } = channelsFor(data.channels, pick);
      expect(names(national)).toEqual(["#bemesh", "#radionoodnet"]);
      expect(new Set(national.map((c) => c.scope))).toEqual(new Set(["be"]));
    }
  });

  it("the channels active mostly in Flanders always show, in the wiki's order, still with region be", () => {
    for (const pick of [all, oostende, namur]) {
      const { flanders } = channelsFor(data.channels, pick);
      expect(names(flanders)).toEqual(["#73sbe", "#b-stby", "#hamradio", "#radio-actief"]);
      expect(new Set(flanders.map((c) => c.scope))).toEqual(new Set(["be"]));
    }
  });

  it("a city shows its province's channels, its own first", () => {
    expect(names(channelsFor(data.channels, oostende).local)).toEqual(["#oostende", "#brugge"]);
    expect(names(channelsFor(data.channels, brugge).local)).toEqual(["#brugge", "#oostende"]);
    expect(channelsFor(data.channels, brugge).local.map((c) => c.own)).toEqual([true, false]);
  });

  it("local channels use their province as region", () => {
    expect(scopes(channelsFor(data.channels, oostende).local)).toEqual({ "#oostende": "be-vwv", "#brugge": "be-vwv" });
    expect(scopes(channelsFor(data.channels, { type: "province", code: "be-bru" }).local)).toEqual({
      "#bruxelles": "be-bru",
      "#brussels": "be-bru",
    });
  });

  it("a province shows its channels in data order", () => {
    expect(names(channelsFor(data.channels, westVl).local)).toEqual(["#oostende", "#brugge"]);
  });

  it("a city in a province without local channels shows none", () => {
    expect(channelsFor(data.channels, namur).local).toEqual([]);
  });

  it("All of Belgium shows no local channels", () => {
    expect(channelsFor(data.channels, all).local).toEqual([]);
  });

  it("#bot takes the picked place's province as region, and none for All of Belgium", () => {
    expect(scopes(channelsFor(data.channels, oostende).tools)).toEqual({ "#bot": "be-vwv" });
    expect(scopes(channelsFor(data.channels, namur).tools)).toEqual({ "#bot": "be-wna" });
    expect(scopes(channelsFor(data.channels, { type: "province", code: "be-vli" }).tools)).toEqual({ "#bot": "be-vli" });
    expect(scopes(channelsFor(data.channels, all).tools)).toEqual({ "#bot": null });
  });
});

describe("data/companion-channels.json", () => {
  const regionCodes = ["be", ...Object.values(PROVINCE_CODES)];

  it("is valid", () => {
    expect(channelErrors(data, regionCodes, places)).toEqual([]);
  });

  it("was checked on 2026-10-28 and names its sources", () => {
    expect(data.checked).toBe("2026-10-28");
    const urls = Object.values(data.sources).map((s) => s.url ?? "");
    for (const host of ["meshwiki.radio-actief.be", "meshcore.radio-actief.be", "analyzer.on8ar.eu"]) {
      expect(urls.some((u) => new URL(u || "http://x").host === host)).toBe(true);
    }
  });

  it("holds exactly the channels decided on 2026-10-28", () => {
    expect(data.channels.map((c) => c.name)).toEqual([
      "#bemesh",
      "#radionoodnet",
      "#73sbe",
      "#b-stby",
      "#hamradio",
      "#radio-actief",
      "#oostende",
      "#brugge",
      "#gent",
      "#antwerpen",
      "#limburg",
      "#bruxelles",
      "#brussels",
      "#bot",
    ]);
  });

  it("leaves out the channels kept off the page", () => {
    const listed = new Set(data.channels.map((c) => c.name.toLowerCase()));
    for (const n of ["#nerdland", "#ON0WV", "#test", "#mc-radar", "#wardriving", "#coredrive", "#burgernet", "#emergency"]) {
      expect(listed.has(n.toLowerCase())).toBe(false);
    }
  });
});

describe("channelErrors", () => {
  const base: ChannelData = { checked: "2026-10-28", sources: { wiki: { title: "w", url: "https://x" } }, channels: [] };
  const ch = (c: Partial<Channel>): Channel => ({ name: "#x", purpose: "p", scope: "be", group: "national", source: ["wiki"], ...c });
  const errs = (channels: Channel[]) => channelErrors({ ...base, channels }, ["be", "be-vwv"], places);

  it("flags a duplicate name, in any case", () => {
    expect(errs([ch({ name: "#a" }), ch({ name: "#A" })]).filter((e) => e.includes("duplicate"))).toHaveLength(2);
  });

  it("flags a scope that is not a region code", () => {
    expect(errs([ch({ scope: "be-xxx" })])).not.toEqual([]);
    expect(errs([ch({ scope: "own-province", group: "tools" })])).toEqual([]);
  });

  it("flags a private channel: a name that is not a lowercase hashtag, or a secret", () => {
    expect(errs([ch({ name: "Aalterse Radioamateurs" })])).not.toEqual([]);
    expect(errs([{ ...ch({}), secret: "00" } as Channel])).not.toEqual([]);
  });

  it("flags every excluded channel", () => {
    for (const name of EXCLUDED_CHANNELS) expect(errs([ch({ name: name.toLowerCase() })])).not.toEqual([]);
  });

  it("flags a local channel whose province, region or city do not match", () => {
    expect(errs([ch({ group: "local", scope: "be-vwv" })])).not.toEqual([]);
    expect(errs([ch({ group: "local", scope: "be-vwv", province: "be-vwv", city: "begne" })])).not.toEqual([]);
    expect(errs([ch({ group: "local", scope: "be-vwv", province: "be-vwv", city: "beost" })])).toEqual([]);
  });

  it("flags an unknown source or group", () => {
    expect(errs([ch({ source: ["nope"] })])).not.toEqual([]);
    expect(errs([ch({ group: "other" as Channel["group"] })])).not.toEqual([]);
    expect(errs([ch({ group: "flanders" })])).toEqual([]);
    expect(errs([ch({ group: "flanders", province: "be-vwv" })])).not.toEqual([]);
  });
});

describe("provinceShapes", () => {
  it("draws every province of the outlines file in a 100-wide box, north up", async () => {
    const { provinceShapes } = await import("../src/core/shape");
    const shapes = provinceShapes(JSON.parse(readFileSync(`${ROOT}/data/be-provinces.geojson`, "utf8")));
    expect(Object.keys(shapes.paths).sort()).toEqual(Object.values(PROVINCE_CODES).sort());
    const [, , w, h] = shapes.viewBox.split(" ").map(Number);
    expect(w).toBe(100);
    expect(h).toBeGreaterThan(40);
    expect(h).toBeLessThan(100);
    for (const d of Object.values(shapes.paths)) expect(d).toMatch(/^M[\d.]+ [\d.]+L.*Z$/);
  });
});
