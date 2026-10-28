import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildScript, commandLines } from "../src/core/cli";
import {
  defaultPlan,
  deviceRegionsFromSnapshot,
  planFromSnapshot,
  planErrors,
  planName,
  snapshotFromReplies,
  summarize,
  type DeviceSnapshot,
} from "../src/core/plan";
import { DEFAULT_SCOPE_NONE, HOME_OVERRIDE_OMIT, regionsByState } from "../src/core/regions";
import type { Place } from "../src/core/search";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(process.cwd(), "data/be-locode.json"), "utf8"));
const RONSE: Record<string, string> = JSON.parse(readFileSync(resolve(__dirname, "fixtures/read-ronse.json"), "utf8"));
const PARITY = resolve(__dirname, "fixtures/parity");

const snapshot = (over: Partial<DeviceSnapshot> = {}): DeviceSnapshot => ({ settings: {}, missing: [], ...over });

describe("defaultPlan", () => {
  it("is the #BEmesh recommendation on EU/UK Narrow with no location", () => {
    const p = defaultPlan();
    expect(p.radio).toEqual({ freq: 869.618, sf: 8, bw: 62.5, cr: 8 });
    expect([p.anchor, p.location, p.regions, p.advertLoc, p.prefixFormat]).toEqual([null, null, null, "prefs", "city"]);
    expect(p.settings).toMatchObject({
      dutycycle: "10",
      floodMaxUnscoped: 12,
      pathHashMode: "1",
      loopDetect: "minimal",
    });
    expect(p.settings.adminPassword).toBe("");
    expect("txPower" in p.settings).toBe(false);
  });
});

describe("the region tree from a Read", () => {
  const replies = {
    "region home": "home is be-vov",
    "region default": "default scope is be",
    "region list allowed": "be,be-vov,zone",
    "region list denied": "-none-",
  };

  it("gives the device regions their parents", () => {
    const s = snapshotFromReplies({ ...replies, region: "* F\n be F\n  be-vov^ F\n zone F\n" });
    expect(deviceRegionsFromSnapshot(s)?.parents).toEqual({ be: null, "be-vov": "be", zone: null });
  });

  it("leaves the parents unknown when the tree was not read", () => {
    const s = snapshotFromReplies(replies, ["region"]);
    expect(deviceRegionsFromSnapshot(s)?.named.sort()).toEqual(["be", "be-vov", "zone"]);
    expect(deviceRegionsFromSnapshot(s)?.parents).toBeUndefined();
  });
});

describe("snapshotFromReplies", () => {
  it("parses the read replies like the old page", () => {
    const s = snapshotFromReplies(RONSE);
    expect(s.name).toBe("BE-RON-Kluisberg🌞");
    expect(s.radio).toEqual({ freq: 869.618, sf: 8, bw: 62.5, cr: 8 });
    expect(s.settings).toMatchObject({
      repeat: "on",
      ownerInfo: "Kluisberg site\nops@example.org",
      guestPassword: "",
      dutycycle: "10",
      floodAdvertHours: 3,
      advertIntervalMinutes: 120,
      floodMaxUnscoped: 12,
      txdelay: 0.5,
      directTxdelay: 0.2,
      rxdelay: 0,
      txPower: 22,
      loopDetect: "minimal",
    });
    expect([s.lat, s.lon, s.advertLoc]).toEqual([50.7475509, 3.6020898, "prefs"]);
    expect(s.regions).toEqual({
      home: "beron",
      default: "be",
      allowed: ["*", "be", "be-vov", "beron"],
      denied: ["bemak"],
      parents: { be: null, "be-vov": "be", beron: "be-vov", bemak: "be-vov" },
    });
    expect(s.version).toBe("v1.17.1 (Build: 12-Oct-2026)");
    expect([s.role, s.clock]).toEqual(["repeater", "14:05 - 24/10/2026 UTC"]);
    expect(s.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(s.missing).toEqual([]);
  });

  it("keeps the duty cycle as read next to the snapped one", () => {
    expect(snapshotFromReplies(RONSE).dutycycleRaw).toBe(10);
    const odd = snapshotFromReplies({ "get dutycycle": "> 9.9%" });
    expect([odd.settings.dutycycle, odd.dutycycleRaw]).toEqual(["10", 9.9]);
    const quarter = snapshotFromReplies({ "get dutycycle": "> 25.0%" });
    expect([quarter.settings.dutycycle, quarter.dutycycleRaw]).toEqual(["10", 25]);
    expect(snapshotFromReplies({ "get dutycycle": "> ?" }).dutycycleRaw).toBeUndefined();
    const low = snapshotFromReplies({ "get dutycycle": "> 1.0%" });
    expect([low.settings.dutycycle, low.dutycycleRaw]).toEqual(["10", 1]);
  });

  it("leaves unanswered commands out and keeps the missing list it is given", () => {
    const s = snapshotFromReplies({ "get name": "> X", "region list denied": "-none-" }, ["get radio"]);
    expect(s.radio).toBeUndefined();
    expect(s.regions).toEqual({ allowed: [], denied: [] });
    expect(s.missing).toEqual(["get radio"]);
    expect(snapshotFromReplies({}).regions).toBeUndefined();
  });

  it("rounds the frequency the firmware prints as a float to 3 decimals", () => {
    expect(snapshotFromReplies({ "get radio": "> 869.6179809,62.5,8,8" }).radio).toEqual({ freq: 869.618, sf: 8, bw: 62.5, cr: 8 });
    expect(snapshotFromReplies({ "get radio": "> 869.5250244,250,11,5" }).radio?.freq).toBe(869.525);
  });

  it("rounds the timing the firmware prints as a float to 3 decimals", () => {
    const s = snapshotFromReplies({ "get txdelay": "> 0.8", "get direct.txdelay": "> 0.3999999", "get rxdelay": "> 3.0" });
    expect(s.settings).toEqual({ txdelay: 0.8, directTxdelay: 0.4, rxdelay: 3 });
    expect(snapshotFromReplies({ "get direct.txdelay": "> 0.0999999" }).settings.directTxdelay).toBe(0.1);
  });

  it("ignores replies it cannot parse", () => {
    const s = snapshotFromReplies({ "get radio": "> 869.6", "get repeat": "> maybe", "get flood.max": "> ?" });
    expect(s.radio).toBeUndefined();
    expect(s.settings).toEqual({});
  });
});

describe("deviceRegionsFromSnapshot", () => {
  it.each(["region list allowed", "region list denied", "region home", "region default"])(
    "is undefined when %s is missing from the Read, so Apply removes nothing",
    (cmd) => {
      const { [cmd]: _gone, ...rest } = RONSE;
      expect(deviceRegionsFromSnapshot(snapshotFromReplies(rest, [cmd]))).toBeUndefined();
    },
  );
  it("is defined when every region command answered", () => {
    expect(deviceRegionsFromSnapshot(snapshotFromReplies(RONSE))?.named).toContain("bemak");
  });
});

describe("planFromSnapshot", () => {
  const plan = planFromSnapshot(snapshotFromReplies(RONSE), PLACES);

  it("follows the hop preset only when the read max flood hops is that preset's", () => {
    // Ronse reads 12 / 8 (no preset) with 64.
    expect(plan.floodMaxFollow).toBe(false);
    const hops = (u: string, a: string, m: string) =>
      planFromSnapshot(
        snapshotFromReplies({ ...RONSE, "get flood.max.unscoped": u, "get flood.max.advert": a, "get flood.max": m }),
        PLACES,
      ).floodMaxFollow;
    expect(hops("> 8", "> 12", "> 18")).toBe(true);
    expect(hops("> 8", "> 12", "> 64")).toBe(false);
    expect(hops("> 64", "> 64", "> 64")).toBe(true);
  });

  it("finds the location, name suffix and power from the name (fake-port transcript)", () => {
    expect(plan.nameSuffix).toBe("Kluisberg");
    expect(plan.power).toBe("🌞");
    expect(plan.anchor?.mode).toBe("city");
    expect(plan.anchor?.place?.plaats).toBe("Ronse");
    expect(plan.prefixFormat).toBe("city");
    expect(planName(plan)).toBe("BE-RON-Kluisberg🌞");
    expect(plan.location).toEqual({ lat: 50.7475509, lon: 3.6020898 });
  });

  it("takes radio and settings from the device", () => {
    expect(plan.radio).toEqual({ freq: 869.618, sf: 8, bw: 62.5, cr: 8 });
    expect(plan.settings.floodAdvertHours).toBe(3);
    expect(plan.settings.advertIntervalMinutes).toBe(120);
    expect(plan.settings.txPower).toBe(22);
    expect(plan.settings.adminPassword).toBe("");
  });

  it("maps the device regions onto the policy, including a neighbour deny", () => {
    expect(regionsByState(plan.regions!)).toEqual({ allowed: ["be", "be-vov", "beron"], denied: ["bemak"] });
    expect([plan.regions!.untaggedFlood, plan.regions!.homeOverride, plan.regions!.defaultScope]).toEqual([
      true,
      null,
      null,
    ]);
    const regionLines = commandLines(
      buildScript(plan, PLACES, {
        includeDefaults: false,
        device: deviceRegionsFromSnapshot(snapshotFromReplies(RONSE)),
      }),
    ).filter((l) => l.startsWith("region"));
    const fixture = readFileSync(resolve(PARITY, "neighbour-deny.script.txt"), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("region"));
    expect(regionLines).toEqual(fixture);
  });

  it("keeps explicit home and default scopes, and a cleared default", () => {
    const read = (home: string, def: string) =>
      planFromSnapshot(
        snapshotFromReplies({
          ...RONSE,
          "region home": ` home is ${home}`,
          "region default": ` default scope is ${def}`,
        }),
        PLACES,
      ).regions!;
    expect(read("be", "be-vov")).toMatchObject({ homeOverride: "be", defaultScope: "be-vov" });
    expect(read("*", "<null>")).toMatchObject({ homeOverride: HOME_OVERRIDE_OMIT, defaultScope: DEFAULT_SCOPE_NONE });
  });

  it("falls back to region hints, and keeps a name that does not match the prefix", () => {
    const p = planFromSnapshot(snapshotFromReplies({ ...RONSE, "get name": "> Kluisberg⚡" }), PLACES);
    expect(p.anchor?.place?.city_code).toBe("beron");
    expect([p.nameSuffix, p.power]).toEqual(["Kluisberg", "⚡"]);
    const q = planFromSnapshot(snapshotFromReplies({ ...RONSE, "get name": "> Old-Name" }), PLACES);
    expect(planName(q)).toBe("Old-Name");
  });

  it("detects a province or the country from the name prefix", () => {
    const only = (name: string) => planFromSnapshot(snapshot({ name }), PLACES);
    expect(only("BE-VOV-Hill").anchor).toEqual({ mode: "province", province_code: "be-vov", place: null });
    expect(only("BE-VOV-Hill").nameSuffix).toBe("Hill");
    expect(only("BE-Hill").anchor).toEqual({ mode: "country", province_code: null, place: null });
    expect(only("BE-XYZ-Hill").anchor).toBeNull();
    expect(only("BE-XYZ-Hill").regions).toBeNull();
  });

  it("drops coordinates that are unset (0,0)", () => {
    expect(planFromSnapshot(snapshot({ lat: 0, lon: 0 }), PLACES).location).toBeNull();
  });
});

describe("planErrors", () => {
  it("flags an empty, too long or badly formed name", () => {
    const base = { ...defaultPlan(), anchor: planFromSnapshot(snapshotFromReplies(RONSE), PLACES).anchor };
    const errs = (over: object) => planErrors({ ...base, ...over }).filter((e) => e.key === "name");
    expect(errs({ nameSuffix: " " })).toEqual([{ key: "name", errorKey: "nameEmpty" }]);
    expect(errs({ nameSuffix: "A:B" })).toEqual([{ key: "name", errorKey: "nameBadChars" }]);
    expect(errs({ nameSuffix: "ABCDEFGHIJKLMNOPQ" })).toEqual([{ key: "name", errorKey: "nameTooLong" }]);
    expect(errs({ nameSuffix: "ABCDEFGHIJKLMNOPQ", advertLoc: "none" })).toEqual([]);
  });

  it("flags invalid coordinates, and missing ones only with Fixed position (old coordsRequiredForApply)", () => {
    const p = { ...defaultPlan(), nameSuffix: "X" };
    expect(p.advertLoc).toBe("prefs");
    expect(planErrors(p)).toEqual([{ key: "location", errorKey: "coordsRequired" }]);
    expect(planErrors({ ...p, advertLoc: "none" })).toEqual([]);
    expect(planErrors({ ...p, advertLoc: "share" })).toEqual([]);
    expect(planErrors({ ...p, location: { lat: 50.8, lon: 4.3 } })).toEqual([]);
    expect(planErrors({ ...p, location: { lat: 0, lon: 0 } })).toEqual([{ key: "location", errorKey: "coords" }]);
  });
});

describe("summarize", () => {
  it("on a repeater that was not read, an empty admin password is missing until Don't set a password is ticked", () => {
    const p = defaultPlan();
    expect(summarize(p).adminPassword).toBe("missing");
    expect(summarize({ ...p, adminPasswordSkip: true }).adminPassword).toBe("factory");
    expect(summarize({ ...p, adminPasswordSkip: true, settings: { ...p.settings, adminPassword: "x" } }).adminPassword).toBe("changed");
  });

  it("reports the admin password as kept on a read repeater unless one is entered", () => {
    expect(summarize(defaultPlan(), { settings: {}, missing: [] }).adminPassword).toBe("kept");
    const p = defaultPlan();
    expect(summarize({ ...p, settings: { ...p.settings, adminPassword: "x" } }).adminPassword).toBe("changed");
    expect(
      summarize({ ...p, settings: { ...p.settings, adminPassword: "x" } }).changes.map((c) => c.labelKey),
    ).not.toContain("adminPassword");
  });

  it("compares with the device snapshot", () => {
    const p = defaultPlan();
    const plan = { ...p, settings: { ...p.settings, floodAdvertHours: 12 } };
    const { changes } = summarize(plan, snapshot({ settings: { floodAdvertHours: 3, floodMaxUnscoped: 12 } }));
    expect(changes).toContainEqual({ group: "settings", labelKey: "floodAdvertHours", from: "3", to: "12" });
    expect(changes.map((c) => c.labelKey)).not.toContain("floodMaxUnscoped");
  });

  it("without a snapshot lists what the script sets", () => {
    const { changes } = summarize(planFromSnapshot(snapshotFromReplies(RONSE), PLACES));
    expect(changes.map((c) => c.labelKey)).toEqual(
      expect.arrayContaining(["name", "radio", "dutycycle", "floodAdvertHours", "location", "regionsAllowed"]),
    );
    expect(changes.find((c) => c.labelKey === "name")).toEqual({
      group: "name",
      labelKey: "name",
      to: "BE-RON-Kluisberg🌞",
    });
    expect(changes.map((c) => c.labelKey)).not.toContain("floodMax");
  });

  it("lists the location only when the script sends it", () => {
    const p = { ...defaultPlan(), location: { lat: 95, lon: 3 } };
    expect(summarize(p).changes.map((c) => c.labelKey)).not.toContain("location");
    expect(summarize({ ...p, location: { lat: 50.5, lon: 3 } }).changes.map((c) => c.labelKey)).toContain("location");
  });

  it("compares the location within the firmware's float precision", () => {
    const p = { ...defaultPlan(), location: { lat: 51.412069, lon: 4.395 } };
    const read = snapshotFromReplies({ "get lat": "> 51.4120674", "get lon": "> 4.3949999" });
    expect(summarize(p, read).changes.map((c) => c.labelKey)).not.toContain("location");
    const moved = { ...p, location: { lat: 51.41209, lon: 4.395 } };
    expect(summarize(moved, read).changes).toContainEqual({
      group: "location",
      labelKey: "location",
      from: "51.4120674, 4.3949999",
      to: "51.41209, 4.395",
    });
  });

  it("an unchanged read lists no changes", () => {
    const s = snapshotFromReplies(RONSE);
    expect(summarize(planFromSnapshot(s, PLACES), s).changes).toEqual([]);
  });
});

describe("summarize: the access list", () => {
  const K1 = "a1".repeat(32);
  const K2 = "b2".repeat(32);
  it("lists the access list changes against the Read as one line", () => {
    const s = snapshot({ acl: [{ key: K1, role: 3 }] });
    const plan = { ...defaultPlan(), acl: [{ key: K1, role: 1 as const }, { key: K2, role: 3 as const }] };
    expect(summarize(plan, s).changes).toContainEqual({ group: "acl", labelKey: "acl", to: "2 changes" });
    expect(summarize({ ...plan, acl: [{ key: K1, role: 3 }] }, s).changes.map((c) => c.group)).not.toContain("acl");
  });
  it("without the repeater's list counts every key as an addition; no list, no line", () => {
    const plan = { ...defaultPlan(), acl: [{ key: K2, role: 3 as const }] };
    expect(summarize(plan, snapshot()).changes).toContainEqual({ group: "acl", labelKey: "acl", to: "1 change" });
    expect(summarize(plan).changes).toContainEqual({ group: "acl", labelKey: "acl", to: "1 change" });
    expect(summarize(defaultPlan()).changes.map((c) => c.group)).not.toContain("acl");
  });
});

describe("the access list from a Read", () => {
  const K1 = "a1".repeat(32);
  it("is in the snapshot and the plan", () => {
    const s = snapshotFromReplies({ "get acl": `ACL:\n03 ${K1}\n` });
    expect(s.acl).toEqual([{ key: K1, role: 3 }]);
    expect(planFromSnapshot(s, PLACES).acl).toEqual(s.acl);
  });
  it("is absent when the reply has no ACL: line", () => {
    expect(snapshotFromReplies({ "get acl": "??: acl" }).acl).toBeUndefined();
  });
});
