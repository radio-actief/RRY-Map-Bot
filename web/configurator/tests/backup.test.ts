import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BackupError, exportBackup, importBackup } from "../src/core/backup";
import { defaultPlan } from "../src/core/plan";
import { presetForRadio } from "../src/core/presets";
import { setRowState } from "../src/core/regions";
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
  it("takes the radio from the fields and ignores the old preset index (Review focus 1)", () => {
    const plan = importBackup(
      v1("ronse-solar", {
        "setting-radio-preset": "2",
        "setting-radio-freq": "869.618",
        "setting-radio-sf": "8",
        "setting-radio-bw": "62.5",
        "setting-radio-cr": "8",
      }),
      PLACES,
    );
    expect(plan.radio).toEqual({ freq: 869.618, sf: 8, bw: 62.5, cr: 8 });
    expect(presetForRadio(plan.radio)?.title).toBe("EU/UK (Narrow)");
  });

  it("keeps custom radio values even when the preset index points elsewhere", () => {
    const plan = importBackup(
      v1("ronse-solar", {
        "setting-radio-preset": "2",
        "setting-radio-freq": "869.525",
        "setting-radio-sf": "11",
        "setting-radio-bw": "250",
        "setting-radio-cr": "5",
      }),
      PLACES,
    );
    expect(plan.radio).toEqual({ freq: 869.525, sf: 11, bw: 250, cr: 5 });
  });

  it("falls back to the #BEmesh radio when the radio fields are empty or invalid", () => {
    expect(importBackup(backup("ronse-solar"), PLACES).radio).toEqual(defaultPlan().radio);
    expect(importBackup(v1("ronse-solar", { "setting-radio-sf": "x" }), PLACES).radio).toEqual(defaultPlan().radio);
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
});
