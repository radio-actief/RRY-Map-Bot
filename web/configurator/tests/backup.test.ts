import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BackupError, exportBackup, importBackup } from "../src/core/backup";
import { defaultPlan } from "../src/core/plan";
import { presetForRadio } from "../src/core/presets";
import { addFreeRegion, setRowState } from "../src/core/regions";
import type { Place } from "../src/core/search";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(process.cwd(), "data/be-locode.json"), "utf8"));
const backup = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `fixtures/parity/${name}.backup.json`), "utf8"));

/** A v1 backup with some fields replaced. */
function v1(name: string, fields: Record<string, string | boolean>) {
  const b = backup(name);
  return { ...b, fields: { ...b.fields, ...fields } };
}

describe("importBackup v1", () => {
  const NARROW_FIELDS = {
    "setting-radio-freq": "869.618",
    "setting-radio-sf": "8",
    "setting-radio-bw": "62.5",
    "setting-radio-cr": "8",
  };

  it("reads the preset index against the old 13-entry list and ignores stale fields (Review focus 1)", () => {
    const plan = importBackup(v1("ronse-solar", { "setting-radio-preset": "3", ...NARROW_FIELDS }), PLACES);
    // Old index 3 = EU/UK (Long Range), which the new list calls EU/UK (Deprecated); new index 3 is Australia.
    expect(plan.radio).toEqual({ freq: 869.525, sf: 11, bw: 250, cr: 5 });
    expect(presetForRadio(plan.radio)?.title).toBe("EU/UK (Deprecated)");
    const narrow = importBackup(v1("ronse-solar", { "setting-radio-preset": "2" }), PLACES);
    expect(narrow.radio).toEqual({ freq: 869.618, sf: 8, bw: 62.5, cr: 8 });
    expect(presetForRadio(narrow.radio)?.title).toBe("EU/UK (Narrow)");
  });

  it("maps every legacy backup preset index to its radio", () => {
    const legacy = [
      { freq: 915.8, sf: 10, bw: 250, cr: 5 },
      { freq: 916.675, sf: 7, bw: 62.5, cr: 8 },
      { freq: 869.618, sf: 8, bw: 62.5, cr: 8 },
      { freq: 869.525, sf: 11, bw: 250, cr: 5 },
      { freq: 869.525, sf: 10, bw: 250, cr: 5 },
      { freq: 869.525, sf: 7, bw: 62.5, cr: 5 },
      { freq: 433.65, sf: 11, bw: 250, cr: 5 },
      { freq: 917.375, sf: 11, bw: 250, cr: 5 },
      { freq: 917.375, sf: 7, bw: 62.5, cr: 5 },
      { freq: 433.375, sf: 9, bw: 62.5, cr: 6 },
      { freq: 869.618, sf: 7, bw: 62.5, cr: 6 },
      { freq: 910.525, sf: 7, bw: 62.5, cr: 5 },
      { freq: 920.25, sf: 11, bw: 250, cr: 5 },
    ];
    legacy.forEach((radio, i) => {
      expect(importBackup(v1("ronse-solar", { "setting-radio-preset": String(i) }), PLACES).radio).toEqual(radio);
    });
  });

  it("uses the radio fields for the custom preset", () => {
    const custom = {
      "setting-radio-preset": "custom",
      "setting-radio-freq": "869.525",
      "setting-radio-sf": "11",
      "setting-radio-bw": "250",
      "setting-radio-cr": "5",
    };
    expect(importBackup(v1("ronse-solar", custom), PLACES).radio).toEqual({ freq: 869.525, sf: 11, bw: 250, cr: 5 });
    const narrow = importBackup(v1("ronse-solar", { "setting-radio-preset": "custom", ...NARROW_FIELDS }), PLACES);
    expect(presetForRadio(narrow.radio)?.title).toBe("EU/UK (Narrow)");
  });

  it("falls back to the #BEmesh radio for an unknown preset or invalid custom fields", () => {
    const radio = (fields: Record<string, string>) => importBackup(v1("ronse-solar", fields), PLACES).radio;
    expect(radio({ "setting-radio-preset": "99" })).toEqual(defaultPlan().radio);
    expect(radio({ "setting-radio-preset": "" })).toEqual(defaultPlan().radio);
    expect(radio({ "setting-radio-preset": "custom", ...NARROW_FIELDS, "setting-radio-sf": "x" })).toEqual(
      defaultPlan().radio,
    );
  });

  it("reads location, name and settings fields", () => {
    const plan = importBackup(backup("ronse-solar"), PLACES);
    expect(plan.anchor?.place?.city_code).toBe("beron");
    expect(plan.location).toEqual({ lat: 50.74755, lon: 3.60209 });
    expect([plan.prefixFormat, plan.nameSuffix, plan.power, plan.advertLoc]).toEqual([
      "city",
      "Kluisberg",
      "🌞",
      "prefs",
    ]);
    expect(plan.settings.floodMaxUnscoped).toBe(12);
    expect(plan.settings.loopDetect).toBe("minimal");
    expect("txPower" in plan.settings).toBe(false);
  });

  it("resolves Brussel to the province, as the old dropdown did", () => {
    const plan = importBackup(backup("brussels"), PLACES);
    expect(plan.anchor).toEqual({ mode: "province", province_code: "be-bru", place: null });
    expect(plan.prefixFormat).toBe("province");
  });

  it("has no anchor and no regions without a location", () => {
    const plan = importBackup(backup("no-location"), PLACES);
    expect([plan.anchor, plan.location, plan.regions]).toEqual([null, null, null]);
  });

  it("rejects a v1 backup without fields", () => {
    expect(() => importBackup({ app: "bemesh-configurator", version: 1 }, PLACES)).toThrow(BackupError);
  });
});

describe("the 1 % duty cycle of older backups", () => {
  it("is read as 10 %, the lowest the firmware keeps after a restart", () => {
    expect(importBackup(v1("ronse-solar", { "setting-dutycycle": "1" }), PLACES).settings.dutycycle).toBe("10");
    const v2 = exportBackup(defaultPlan());
    v2.plan.settings.dutycycle = "1";
    expect(importBackup(JSON.parse(JSON.stringify(v2)), PLACES).settings.dutycycle).toBe("10");
  });
});

describe("v2 export and import", () => {
  it("round-trips a plan", () => {
    const start = importBackup(backup("neighbour-deny"), PLACES);
    const plan = {
      ...start,
      regions: setRowState(start.regions!, "be-wht", "deny"),
      settings: { ...start.settings, ownerInfo: "Line 1\nLine 2", txPower: 20 },
    };
    const exported = exportBackup(plan);
    expect(exported).toMatchObject({ app: "bemesh-configurator", version: 2 });
    const imported = importBackup(JSON.parse(JSON.stringify(exported)), PLACES);
    expect(imported).toEqual(plan);
  });

  it("round-trips free regions (code, parent, allow/deny)", () => {
    const start = importBackup(backup("neighbour-deny"), PLACES);
    let regions = addFreeRegion(setRowState(start.regions!, "be-wht", "allow"), "zone", "be-wht");
    regions = setRowState(addFreeRegion(regions, "sub", "zone"), "sub", "deny");
    const plan = { ...start, regions };
    const imported = importBackup(JSON.parse(JSON.stringify(exportBackup(plan))), PLACES);
    expect(imported).toEqual(plan);
    const free = imported.regions!.rows.filter((r) => r.group === "free");
    expect(free.map((r) => [r.code, r.parent, r.allow, r.deny])).toEqual([
      ["zone", "be-wht", true, false],
      ["sub", "zone", false, true],
    ]);
  });

  it("puts a free region whose parent is on neither at top level", () => {
    const start = importBackup(backup("neighbour-deny"), PLACES);
    const regions = addFreeRegion(setRowState(start.regions!, "be-wht", "allow"), "zone", "be-wht");
    const file = JSON.parse(JSON.stringify(exportBackup({ ...start, regions })));
    for (const r of file.plan.regions.rows) if (r.code === "be-wht") r.allow = false;
    const imported = importBackup(file, PLACES);
    expect(imported.regions!.rows.find((r) => r.code === "zone")!.parent).toBeNull();
  });

  it("leaves the access list out: it belongs to one repeater", () => {
    const plan = { ...defaultPlan(), acl: [{ key: "a1".repeat(32), role: 3 as const }] };
    const exported = exportBackup(plan);
    expect(exported.plan).not.toHaveProperty("acl");
    expect(plan.acl).toHaveLength(1);
    const file = JSON.parse(JSON.stringify({ ...exported, plan }));
    expect(importBackup(file, PLACES)).not.toHaveProperty("acl");
  });

  it("round-trips the default plan", () => {
    expect(importBackup(JSON.parse(JSON.stringify(exportBackup(defaultPlan()))), PLACES)).toEqual(defaultPlan());
  });
});

describe("rejected input", () => {
  const key = (json: unknown) => {
    try {
      importBackup(json, PLACES);
    } catch (e) {
      expect(e).toBeInstanceOf(BackupError);
      return (e as BackupError).key;
    }
    throw new Error("no error thrown");
  };

  it("throws BackupError on anything else", () => {
    expect(() => importBackup({ foo: 1 }, PLACES)).toThrow(BackupError);
    expect(key({ foo: 1 })).toBe("backup.error.unknown");
    expect(key(null)).toBe("backup.error.unknown");
    expect(key("text")).toBe("backup.error.unknown");
    expect(key({ app: "other", version: 2, plan: defaultPlan() })).toBe("backup.error.unknown");
    expect(key({ app: "bemesh-configurator", version: 3, plan: {} })).toBe("backup.error.newer");
    expect(key({ app: "bemesh-configurator", version: 2, plan: { radio: 1 } })).toBe("backup.error.invalid");
  });

  it("rejects a v2 plan with bad enums, coordinates or anchor", () => {
    const bad = (over: Record<string, unknown>) =>
      key({ app: "bemesh-configurator", version: 2, plan: { ...defaultPlan(), ...over } });
    expect(bad({ advertLoc: "always" })).toBe("backup.error.invalid");
    expect(bad({ prefixFormat: "street" })).toBe("backup.error.invalid");
    expect(bad({ power: "x" })).toBe("backup.error.invalid");
    expect(bad({ location: { lat: "50", lon: 3 } })).toBe("backup.error.invalid");
    expect(bad({ anchor: { mode: "city", province_code: "be-vov", place: null } })).toBe("backup.error.invalid");
    expect(bad({ anchor: { mode: "planet", province_code: null, place: null } })).toBe("backup.error.invalid");
  });

  it("rejects a v2 free region with a bad code or parent", () => {
    const freeRow = (code: unknown, parent: unknown) => ({
      code,
      label: String(code),
      labelKey: "region.kind.free",
      group: "free",
      allow: true,
      deny: false,
      parent,
    });
    const regions = (...rows: unknown[]) => ({ rows, untaggedFlood: true, homeOverride: null, defaultScope: null });
    const plan = (...rows: unknown[]) => ({
      app: "bemesh-configurator",
      version: 2,
      plan: { ...defaultPlan(), regions: regions(...rows) },
    });
    expect(key(plan(freeRow("A B", null)))).toBe("backup.error.invalid");
    expect(key(plan(freeRow("zone", 5)))).toBe("backup.error.invalid");
    expect(importBackup(plan(freeRow("zone", null)), PLACES).regions!.rows[0].code).toBe("zone");
    // The parent is a region code too.
    for (const parent of ["", "Be Wht", "be_wht", "*", "x".repeat(31)]) {
      expect(key(plan(freeRow("zone", parent)))).toBe("backup.error.invalid");
    }
    // A valid parent that no row sets to Allow or Deny puts the region at top level.
    expect(importBackup(plan(freeRow("zone", "be-wht")), PLACES).regions!.rows[0].parent).toBeNull();
    // A free code that another row already has.
    const structured = {
      code: "be-wht",
      label: "Henegouwen (be-wht)",
      labelKey: "region.kind.neighbourProvince",
      group: "neighbourProvince",
      allow: false,
      deny: false,
    };
    expect(key(plan(structured, freeRow("be-wht", null)))).toBe("backup.error.invalid");
    expect(key(plan(freeRow("zone", null), freeRow("zone", null)))).toBe("backup.error.invalid");
    expect(importBackup(plan(structured, freeRow("zone", "be-wht")), PLACES).regions!.rows).toHaveLength(2);
  });
});
