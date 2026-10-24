import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BackupError, exportBackup, importBackup } from "../src/core/backup";
import { buildScript, commandLines, scriptText, SETTINGS_ORDER } from "../src/core/cli";
import { defaultPlan, planErrors, type Plan } from "../src/core/plan";
import { anchorFromChoice, deviceRegionsFromRead, policyFor } from "../src/core/regions";
import { locationChoices, type Place } from "../src/core/search";
import { SETTINGS } from "../src/core/settings";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(process.cwd(), "data/be-locode.json"), "utf8"));
const PARITY = resolve(__dirname, "fixtures/parity");
const FIXTURES = [
  "ronse-solar",
  "brussels",
  "border-deny",
  "neighbour-deny",
  "no-location",
  "advanced-all",
  "admin-password",
];

const read = (name: string, ext: string) => readFileSync(resolve(PARITY, `${name}.${ext}`), "utf8");

/** What the old page sent: non-empty, non-comment, trimmed lines. */
const expectedLines = (script: string) =>
  script
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

describe("parity with the old page", () => {
  for (const name of FIXTURES) {
    it(`${name}: the imported v1 backup gives the old script`, () => {
      const plan = importBackup(JSON.parse(read(name, "backup.json")), PLACES);
      const lines = commandLines(buildScript(plan, PLACES, { includeDefaults: false }));
      expect(lines).toEqual(expectedLines(read(name, "script.txt")));
    });
  }
});

function ronsePlan(): Plan {
  const anchor = anchorFromChoice(locationChoices("Ronse", PLACES)[0]);
  return {
    ...defaultPlan(),
    anchor,
    location: { lat: 50.74755, lon: 3.60209 },
    nameSuffix: "Kluisberg",
    power: "🌞",
    regions: policyFor(anchor, PLACES),
  };
}

describe("buildScript", () => {
  it("groups name, settings, location and regions in the old order", () => {
    const groups = buildScript(ronsePlan(), PLACES, { includeDefaults: false });
    expect(groups.map((g) => g.titleKey)).toEqual(["name", "settings", "location", "regions"]);
    expect(groups[0].lines).toEqual(["set name BE-RON-Kluisberg🌞"]);
    expect(groups[2].lines).toEqual(["set lat 50.74755", "set lon 3.60209"]);
    expect(groups[3].lines.at(-1)).toBe("region save");
  });

  it("includes unchanged defaults when asked, in the old order", () => {
    const lines = commandLines(buildScript(ronsePlan(), PLACES, { includeDefaults: true }));
    expect(lines.slice(0, 18)).toEqual([
      "set name BE-RON-Kluisberg🌞",
      "set radio 869.618,62.5,8,8",
      "set repeat on",
      "set dutycycle 10",
      "set flood.advert.interval 47",
      "set advert.interval 0",
      "set flood.max.unscoped 12",
      "set flood.max.advert 8",
      "set flood.max 64",
      "set path.hash.mode 1",
      "set loop.detect minimal",
      "set txdelay 0.5",
      "set direct.txdelay 0.2",
      "set rxdelay 0",
      "set radio.rxgain on",
      "set int.thresh 0",
      "set agc.reset.interval 0",
      "set multi.acks 0",
    ]);
    expect(lines.slice(18, 21)).toEqual(["set lat 50.74755", "set lon 3.60209", "gps advert prefs"]);
  });

  it("omits the radio line for the firmware default radio unless defaults are included", () => {
    const plan = { ...ronsePlan(), radio: { freq: 869.618, sf: 8, bw: 62.5, cr: 5 } };
    expect(commandLines(buildScript(plan, PLACES, { includeDefaults: false }))).not.toContain(
      "set radio 869.618,62.5,8,5",
    );
    expect(commandLines(buildScript(plan, PLACES, { includeDefaults: true }))).toContain("set radio 869.618,62.5,8,5");
  });

  it("emits no name without a suffix, and none for a name that is too long", () => {
    const groups = (p: Plan) => buildScript(p, PLACES, { includeDefaults: false }).map((g) => g.titleKey);
    expect(groups({ ...ronsePlan(), nameSuffix: "  " })).not.toContain("name");
    // 7-byte prefix + 17 bytes = 24 > 23 when the advert carries the location.
    const long = { ...ronsePlan(), power: "" as const, nameSuffix: "ABCDEFGHIJKLMNOPQ" };
    expect(groups(long)).not.toContain("name");
    expect(groups({ ...long, advertLoc: "none" })).toContain("name");
  });

  it("sends owner info newlines as |, tx only when set, and gps advert none/share", () => {
    const plan: Plan = {
      ...ronsePlan(),
      advertLoc: "share",
      settings: { ...ronsePlan().settings, ownerInfo: "Ops\nteam", txPower: 14 },
    };
    const lines = commandLines(buildScript(plan, PLACES, { includeDefaults: false }));
    expect(lines).toContain("set owner.info Ops|team");
    expect(lines).toContain("set tx 14");
    expect(lines).toContain("gps advert share");
    expect(
      commandLines(buildScript(ronsePlan(), PLACES, { includeDefaults: false })).some((l) => l.startsWith("set tx")),
    ).toBe(false);
  });

  it("removes device regions that are no longer needed", () => {
    const device = deviceRegionsFromRead(["be", "be-vov", "bemak"], [], "be-vov", "be");
    const lines = commandLines(buildScript(ronsePlan(), PLACES, { includeDefaults: false, device }));
    expect(lines.filter((l) => l.startsWith("region remove"))).toEqual(["region remove bemak"]);
  });

  it("has no location or region lines without a location", () => {
    const plan = { ...defaultPlan(), nameSuffix: "Test" };
    expect(buildScript(plan, PLACES, { includeDefaults: false }).map((g) => g.titleKey)).toEqual(["name", "settings"]);
  });
});

describe("invalid values", () => {
  const bad: Plan = {
    ...ronsePlan(),
    location: { lat: 95, lon: 3.6 },
    settings: {
      ...ronsePlan().settings,
      floodAdvertHours: 500,
      txPower: "20.5",
      adminPassword: "sixteen-bytes-pw",
      ownerInfo: "x".repeat(120),
    },
  };
  const lines = commandLines(buildScript(bad, PLACES, { includeDefaults: true }));

  it("never reach the command lines", () => {
    expect(lines.some((l) => l.startsWith("set flood.advert.interval"))).toBe(false);
    expect(lines.some((l) => l.startsWith("set tx "))).toBe(false);
    expect(lines.some((l) => l.startsWith("password"))).toBe(false);
    expect(lines.some((l) => l.startsWith("set owner.info"))).toBe(false);
    expect(lines.some((l) => l.startsWith("set lat") || l.startsWith("set lon"))).toBe(false);
    expect(lines).toContain("set flood.max 64");
  });

  it("are listed by planErrors", () => {
    expect(planErrors(bad)).toEqual([
      { key: "adminPassword", errorKey: "tooLong" },
      { key: "floodAdvertHours", errorKey: "range" },
      { key: "txPower", errorKey: "number" },
      { key: "ownerInfo", errorKey: "ownerInfoTooLong" },
      { key: "location", errorKey: "coords" },
    ]);
    expect(planErrors(ronsePlan())).toEqual([]);
  });
});

describe("SETTINGS_ORDER", () => {
  it("is a permutation of the settings registry", () => {
    expect([...SETTINGS_ORDER].sort()).toEqual(SETTINGS.map((s) => s.key).sort());
  });
});

describe("scriptText", () => {
  it("puts a # header before each group and keeps the command lines", () => {
    const groups = buildScript(ronsePlan(), PLACES, { includeDefaults: false });
    const text = scriptText(groups);
    expect(text.startsWith("# Name\nset name BE-RON-Kluisberg🌞\n\n# Settings\n")).toBe(true);
    expect(expectedLines(text)).toEqual(commandLines(groups));
  });
});

describe("control characters (command injection)", () => {
  const SUFFIX = "x\rerase";
  const GUEST = "g\rset prv.key aa";
  const withSettings = (settings: Plan["settings"]): Plan => ({ ...ronsePlan(), settings: { ...ronsePlan().settings, ...settings } });
  const v1 = (fields: Record<string, string>) => {
    const b = JSON.parse(read("ronse-solar", "backup.json"));
    return { ...b, fields: { ...b.fields, ...fields } };
  };
  const invalid = (json: unknown) => {
    try {
      importBackup(json, PLACES);
    } catch (err) {
      return err instanceof BackupError && err.key === "backup.error.invalid";
    }
    return false;
  };

  it("a v2 or v1 backup carrying a CR in the name suffix or guest password is rejected", () => {
    const roundTrip = (plan: Plan) => JSON.parse(JSON.stringify(exportBackup(plan)));
    expect(invalid(roundTrip({ ...ronsePlan(), nameSuffix: SUFFIX }))).toBe(true);
    expect(invalid(roundTrip(withSettings({ guestPassword: GUEST })))).toBe(true);
    expect(invalid(v1({ "name-suffix": SUFFIX }))).toBe(true);
    expect(invalid(v1({ "setting-guest-password": GUEST }))).toBe(true);
  });

  it("rejects control characters in passwords, owner info, region codes and the anchor, but keeps owner info newlines", () => {
    const plan = ronsePlan();
    const json = () => JSON.parse(JSON.stringify(exportBackup(plan)));
    const tampered = (edit: (p: Record<string, any>) => void) => {
      const b = json();
      edit(b.plan);
      return b;
    };
    expect(invalid(tampered((p) => (p.settings.adminPassword = "a\rb")))).toBe(true);
    expect(invalid(tampered((p) => (p.settings.ownerInfo = "a\tb")))).toBe(true);
    expect(invalid(tampered((p) => (p.regions.rows[0].code = "be\rerase")))).toBe(true);
    expect(invalid(tampered((p) => (p.regions.homeOverride = "be\r")))).toBe(true);
    expect(invalid(tampered((p) => (p.anchor.place.city_code = "beron\rerase")))).toBe(true);
    expect(invalid(v1({ "setting-admin-password": "a\x00b" }))).toBe(true);
    expect(invalid(v1({ "policy-default-scope-select": "be\rerase" }))).toBe(true);
    expect(importBackup(tampered((p) => (p.settings.ownerInfo = "Line 1\nLine 2")), PLACES).settings.ownerInfo).toBe(
      "Line 1\nLine 2",
    );
    expect(importBackup(v1({ "setting-owner-info": "Line 1\nLine 2" }), PLACES).settings.ownerInfo).toBe("Line 1\nLine 2");
  });

  it("planErrors flags them and the script never sends them", () => {
    const named = { ...ronsePlan(), nameSuffix: SUFFIX };
    expect(planErrors(named)).toEqual([{ key: "name", errorKey: "nameControlChars" }]);
    const guest = withSettings({ guestPassword: GUEST });
    expect(planErrors(guest)).toEqual([{ key: "guestPassword", errorKey: "controlChars" }]);
    for (const plan of [named, guest]) {
      const lines = commandLines(buildScript(plan, PLACES, { includeDefaults: true }));
      expect(lines.some((l) => /[\x00-\x1f\x7f]/.test(l) || l.includes("erase") || l.includes("prv.key"))).toBe(false);
    }
    expect(planErrors(withSettings({ adminPassword: "a\rb" }))).toEqual([{ key: "adminPassword", errorKey: "controlChars" }]);
    expect(planErrors(withSettings({ ownerInfo: "a\tb" }))).toEqual([{ key: "ownerInfo", errorKey: "controlChars" }]);
    expect(planErrors(withSettings({ ownerInfo: "Line 1\nLine 2" }))).toEqual([]);
    const plan = ronsePlan();
    const rows = plan.regions!.rows.map((r, i) => (i === 0 ? { ...r, code: "be\rerase" } : r));
    expect(planErrors({ ...plan, regions: { ...plan.regions!, rows } })).toEqual([
      { key: "regions", errorKey: "regionControlChars" },
    ]);
  });

  it("limits the guest password to 15 UTF-8 bytes", () => {
    expect(planErrors(withSettings({ guestPassword: "é".repeat(8) }))).toEqual([
      { key: "guestPassword", errorKey: "guestPasswordTooLong" },
    ]);
    expect(planErrors(withSettings({ guestPassword: "é".repeat(7) + "a" }))).toEqual([]);
  });
});
