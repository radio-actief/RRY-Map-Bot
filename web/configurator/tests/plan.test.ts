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
      rxdelay: 0,
      txPower: 22,
      loopDetect: "minimal",
    });
    expect([s.lat, s.lon, s.advertLoc]).toEqual([50.74755, 3.60209, "prefs"]);
    expect(s.regions).toEqual({
      home: "beron",
      default: "be",
      allowed: ["*", "be", "be-vov", "beron"],
      denied: ["bemak"],
    });
    expect(s.version).toBe("v1.17.1 (Build: 12-Oct-2026)");
    expect([s.role, s.clock]).toEqual(["repeater", "14:05 - 24/10/2026 UTC"]);
    expect(s.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(s.missing).toEqual([]);
  });

  it("leaves unanswered commands out and keeps the missing list it is given", () => {
    const s = snapshotFromReplies({ "get name": "> X", "region list denied": "-none-" }, ["get radio"]);
    expect(s.radio).toBeUndefined();
    expect(s.regions).toEqual({ allowed: [], denied: [] });
    expect(s.missing).toEqual(["get radio"]);
    expect(snapshotFromReplies({}).regions).toBeUndefined();
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

  it("finds the location, name suffix and power from the name (fake-port transcript)", () => {
    expect(plan.nameSuffix).toBe("Kluisberg");
    expect(plan.power).toBe("🌞");
    expect(plan.anchor?.mode).toBe("city");
    expect(plan.anchor?.place?.plaats).toBe("Ronse");
    expect(plan.prefixFormat).toBe("city");
    expect(planName(plan)).toBe("BE-RON-Kluisberg🌞");
    expect(plan.location).toEqual({ lat: 50.74755, lon: 3.60209 });
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
  it("reports the admin password as kept unless one is entered", () => {
    expect(summarize(defaultPlan()).adminPassword).toBe("kept");
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

  it("an unchanged read lists no changes", () => {
    const s = snapshotFromReplies(RONSE);
    expect(summarize(planFromSnapshot(s, PLACES), s).changes).toEqual([]);
  });
});
