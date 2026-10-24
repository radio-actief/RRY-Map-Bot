import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bulk,
  DEFAULT_SCOPE_NONE,
  HOME_OVERRIDE_OMIT,
  homeRegionCode,
  policyFor,
  regionCommandLines,
  regionsByState,
  setRowState,
  type Anchor,
  type RegionPolicy,
} from "../src/core/regions";
import { PROVINCE_NAMES } from "../src/core/be-regions";
import { normalize, rankPlaces, type Place } from "../src/core/search";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(process.cwd(), "data/be-locode.json"), "utf8"));
const PARITY = resolve(__dirname, "fixtures/parity");

type Fields = Record<string, string | boolean>;

function fixture(name: string): { fields: Fields; regionLines: string[] } {
  const backup = JSON.parse(readFileSync(resolve(PARITY, `${name}.backup.json`), "utf8"));
  const script = readFileSync(resolve(PARITY, `${name}.script.txt`), "utf8");
  const regionLines = script
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("region"));
  return { fields: backup.fields, regionLines };
}

function cityAnchor(query: string): Anchor {
  const place = rankPlaces(PLACES, query)[0];
  return { mode: "city", province_code: place.province_code, place };
}

/**
 * The old page's first dropdown item for a city-search text: provinces whose name or code
 * contains the query come before places (so "Brussel" picked the province be-bru).
 */
function searchAnchor(query: string): Anchor {
  const q = normalize(query);
  const pc = Object.keys(PROVINCE_NAMES).find(
    (c) => normalize(c).includes(q) || normalize(PROVINCE_NAMES[c]).includes(q),
  );
  if (pc) return { mode: "province", province_code: pc, place: null };
  return cityAnchor(query);
}

/** Old page checkbox id for a policy row. */
const rowId = (code: string) => `pc_${code.replace(/[^a-zA-Z0-9]/g, "_")}`;

/** pc_* ids the old page rendered, in DOM order (each row has _a then _d). */
const fixtureRowIds = (fields: Fields) =>
  Object.keys(fields)
    .filter((k) => k.startsWith("pc_") && k.endsWith("_a"))
    .map((k) => k.slice(0, -2));

/** The old page's policy state, applied onto the rows policyFor builds. */
function policyFromFields(anchor: Anchor, fields: Fields): RegionPolicy {
  const base = policyFor(anchor, PLACES);
  const homeOverrideOn = fields["policy-home-override"] === true;
  return {
    rows: base.rows.map((r) => ({
      ...r,
      allow: fields[`${rowId(r.code)}_a`] === true,
      deny: fields[`${rowId(r.code)}_d`] === true,
    })),
    untaggedFlood: fields["policy-untagged-flood"] === true,
    homeOverride: homeOverrideOn ? String(fields["policy-home-override-select"] || "") || null : null,
    defaultScope: String(fields["policy-default-scope-select"] || "") || null,
  };
}

const PARITY_FIXTURES = ["ronse-solar", "brussels", "border-deny", "neighbour-deny", "advanced-all", "admin-password"];

describe("parity with the old page", () => {
  it("resolves each fixture's city-search label to the old page's choice", () => {
    for (const name of PARITY_FIXTURES.filter((n) => n !== "brussels")) {
      expect(searchAnchor(fixture(name).fields["city-search"] as string).place?.city_code).toBe("beron");
    }
    const brussels = fixture("brussels").fields;
    expect(brussels["name-location-mode"]).toBe("province");
    expect(searchAnchor(brussels["city-search"] as string)).toEqual({
      mode: "province",
      province_code: "be-bru",
      place: null,
    });
  });

  for (const name of PARITY_FIXTURES) {
    describe(name, () => {
      const { fields, regionLines } = fixture(name);
      const anchor = searchAnchor(fields["city-search"] as string);

      it("renders the same rows in the same order", () => {
        expect(policyFor(anchor, PLACES).rows.map((r) => rowId(r.code))).toEqual(fixtureRowIds(fields));
      });

      it("emits the same region lines", () => {
        expect(regionCommandLines(anchor, policyFromFields(anchor, fields), PLACES)).toEqual(regionLines);
      });
    });
  }

  it("defaults match the untouched old page (ronse-solar, brussels)", () => {
    for (const name of ["ronse-solar", "brussels"]) {
      const { fields } = fixture(name);
      const anchor = searchAnchor(fields["city-search"] as string);
      const fromPage = policyFromFields(anchor, fields);
      const p = policyFor(anchor, PLACES);
      expect(p.rows.map((r) => [r.code, r.allow, r.deny])).toEqual(fromPage.rows.map((r) => [r.code, r.allow, r.deny]));
      expect([p.untaggedFlood, p.homeOverride, p.defaultScope]).toEqual([true, null, null]);
    }
  });

  it("has no region lines without a location", () => {
    expect(fixture("no-location").regionLines).toEqual([]);
    expect(regionCommandLines(null, policyFor(cityAnchor("Ronse"), PLACES), PLACES)).toEqual([]);
  });
});

describe("policyFor", () => {
  const ronse = cityAnchor("Ronse");

  it("builds home rows country → gewest → province → municipality for a city", () => {
    const home = policyFor(ronse, PLACES).rows.filter((r) => r.home);
    expect(home.map((r) => [r.code, r.group, r.label, r.allow])).toEqual([
      ["be", "country", "Belgium (be)", true],
      ["be-vlg", "province", "Vlaams Gewest (be-vlg)", false],
      ["be-vov", "province", "Oost-Vlaanderen (be-vov)", true],
      ["beron", "municipality", "Ronse (beron)", false],
    ]);
  });

  it("gates neighbour municipalities on the home municipality row", () => {
    const rows = policyFor(ronse, PLACES).rows;
    const mak = rows.find((r) => r.code === "bemak")!;
    expect(mak.group).toBe("neighbour");
    expect(mak.label).toMatch(/^Maarkedal \(~\d+ km\) \(bemak\)$/);
    expect(mak.disabled).toEqual({ allow: true, deny: true });
    // Province and country neighbours are open because be and be-vov are allowed.
    expect(rows.find((r) => r.code === "be-wht")!.disabled).toBeUndefined();
    expect(rows.find((r) => r.code === "nl")!.disabled).toBeUndefined();
    expect(rows.find((r) => r.code === "eu")!.group).toBe("country");
  });

  it("builds a province anchor from the province centroid", () => {
    const anchor: Anchor = { mode: "province", province_code: "be-vov", place: null };
    const p = policyFor(anchor, PLACES);
    expect(p.rows.filter((r) => r.home).map((r) => r.code)).toEqual(["be", "be-vlg", "be-vov"]);
    // Municipality neighbours exist but can never be set without a home municipality.
    const muni = p.rows.filter((r) => r.group === "neighbour" && /^be[a-z]{3}$/.test(r.code));
    expect(muni.length).toBe(10);
    expect(muni.every((r) => r.disabled?.allow && r.disabled?.deny)).toBe(true);
    expect(regionCommandLines(anchor, p, PLACES)).toEqual([
      "region def be be-vov",
      "region allowf *",
      "region home be-vov",
      "region default be",
      "region save",
    ]);
  });

  it("builds a country anchor with only be at home", () => {
    const anchor: Anchor = { mode: "country", province_code: null, place: null };
    const p = policyFor(anchor, PLACES);
    expect(p.rows.filter((r) => r.home).map((r) => r.code)).toEqual(["be"]);
    expect(p.rows.some((r) => r.code.startsWith("be-"))).toBe(false);
    expect(regionCommandLines(anchor, p, PLACES)).toEqual([
      "region def be",
      "region allowf *",
      "region home be",
      "region default be",
      "region save",
    ]);
  });

  it("adds rows for device codes not already listed", () => {
    const p = policyFor(ronse, PLACES, ["be-wlg", "beron", "*", " be-wlg ", "xx-custom"]);
    const device = p.rows.filter((r) => r.group === "device");
    expect(device.map((r) => [r.code, r.label, r.allow, r.deny])).toEqual([
      ["be-wlg", "Luik (be-wlg)", false, false],
      ["xx-custom", "xx-custom", false, false],
    ]);
  });
});

describe("setRowState and gating", () => {
  const ronse = cityAnchor("Ronse");

  it("reproduces the neighbour-deny scenario and its lines", () => {
    let p = policyFor(ronse, PLACES);
    expect(setRowState(p, "bemak", "deny")).toBe(p); // locked until the home municipality is set
    p = setRowState(p, "beron", "allow");
    p = setRowState(p, "bemak", "deny");
    expect(regionsByState(p)).toEqual({ allowed: ["be", "be-vov", "beron"], denied: ["bemak"] });
    expect(regionCommandLines(ronse, p, PLACES)).toEqual(fixture("neighbour-deny").regionLines);
    expect(homeRegionCode(p)).toBe("beron");
  });

  it("clears and locks neighbours again when their home row is cleared", () => {
    let p = setRowState(policyFor(ronse, PLACES), "beron", "allow");
    p = setRowState(p, "bemak", "allow");
    p = setRowState(p, "beron", "none");
    const mak = p.rows.find((r) => r.code === "bemak")!;
    expect([mak.allow, mak.deny, mak.disabled]).toEqual([false, false, { allow: true, deny: true }]);
  });

  it("keeps Allow and Deny exclusive", () => {
    let p = setRowState(policyFor(ronse, PLACES), "be-wht", "allow");
    p = setRowState(p, "be-wht", "deny");
    expect(regionsByState(p).allowed).not.toContain("be-wht");
    expect(regionsByState(p).denied).toEqual(["be-wht"]);
  });

  it("a home Deny also opens the neighbour tier", () => {
    const p = setRowState(policyFor(ronse, PLACES), "beron", "deny");
    expect(p.rows.find((r) => r.code === "bemak")!.disabled).toBeUndefined();
  });
});

describe("bulk", () => {
  const ronse = cityAnchor("Ronse");

  it("clear leaves no allow and no deny, and resets the overrides", () => {
    const start = { ...policyFor(ronse, PLACES), homeOverride: "be", defaultScope: DEFAULT_SCOPE_NONE };
    const p = bulk(start, "clear");
    expect(regionsByState(p)).toEqual({ allowed: [], denied: [] });
    expect([p.homeOverride, p.defaultScope, p.untaggedFlood]).toEqual([null, null, true]);
    expect(regionCommandLines(ronse, p, PLACES)).toEqual([
      "region allowf *",
      "region home *",
      "region default <null>",
      "region save",
    ]);
    expect(homeRegionCode(p)).toBeNull();
  });

  it("allowAll allows every row and packs long region def lines", () => {
    const p = bulk(policyFor(ronse, PLACES), "allowAll");
    expect(regionsByState(p).denied).toEqual([]);
    expect(regionsByState(p).allowed).toEqual(p.rows.map((r) => r.code));
    const lines = regionCommandLines(ronse, p, PLACES);
    expect(lines).toEqual(ALLOW_ALL_RONSE);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(151);
  });

  it("denyAll denies every row", () => {
    const p = bulk(policyFor(ronse, PLACES), "denyAll");
    expect(regionsByState(p).allowed).toEqual([]);
    expect(regionsByState(p).denied).toEqual(p.rows.map((r) => r.code));
    expect(regionCommandLines(ronse, p, PLACES)).toEqual(DENY_ALL_RONSE);
  });

  it("recommended restores the policyFor defaults", () => {
    const start = policyFor(ronse, PLACES, ["be-wlg"]);
    let p = bulk(start, "allowAll");
    p = { ...p, untaggedFlood: false, homeOverride: HOME_OVERRIDE_OMIT, defaultScope: "nl" };
    expect(bulk(p, "recommended")).toEqual(start);
  });
});

describe("home and default lines", () => {
  const ronse = cityAnchor("Ronse");
  const base = policyFor(ronse, PLACES);

  it("untagged flood off denies * first instead of allowing it", () => {
    let p = setRowState({ ...base, untaggedFlood: false }, "be-wht", "deny");
    const lines = regionCommandLines(ronse, p, PLACES);
    expect(lines).not.toContain("region allowf *");
    expect(lines.filter((l) => l.startsWith("region denyf"))).toEqual(["region denyf *", "region denyf be-wht"]);
    p = { ...p, untaggedFlood: true };
    expect(regionCommandLines(ronse, p, PLACES)).toContain("region allowf *");
  });

  it("home override: omit, an allowed code, and a code that is not allowed", () => {
    const lines = (p: RegionPolicy) => regionCommandLines(ronse, p, PLACES).filter((l) => l.startsWith("region home"));
    expect(lines({ ...base, homeOverride: HOME_OVERRIDE_OMIT })).toEqual([]);
    expect(homeRegionCode({ ...base, homeOverride: HOME_OVERRIDE_OMIT })).toBeNull();
    expect(lines({ ...base, homeOverride: "be" })).toEqual(["region home be"]);
    expect(lines({ ...base, homeOverride: "*" })).toEqual(["region home *"]);
    expect(lines({ ...base, homeOverride: "nl" })).toEqual(["region home be-vov"]);
    expect(homeRegionCode(base)).toBe("be-vov");
  });

  it("an override that stops being allowed falls back to automatic", () => {
    const p = setRowState({ ...base, homeOverride: "be" }, "be", "none");
    expect(p.homeOverride).toBeNull();
  });

  it("default scope: none, and an explicit code that pulls in its def", () => {
    expect(regionCommandLines(ronse, { ...base, defaultScope: DEFAULT_SCOPE_NONE }, PLACES)).toContain(
      "region default <null>",
    );
    const lines = regionCommandLines(ronse, { ...base, defaultScope: "be-wht" }, PLACES);
    expect(lines[0]).toBe("region def be be-vov|be be-wht");
    expect(lines).toContain("region default be-wht");
  });
});

// Computed with the old page's region def/deny functions (src/configurator.js) for the same policy.
const ALLOW_ALL_RONSE = [
  "region def eu nl|eu lu|eu fr|eu de|eu be be-vlg be-vbr|be-vlg be-vov behor|be-vov beksr|be-vov bemak|be-vov beoud|be-vov beron|be-vlg be-vwv beavl",
  "region def eu|eu be|be be-wht becle|be-wht beezs|be-wht befbq|be-wht befrs|be-wht bemdl",
  "region allowf *",
  "region home beron",
  "region default be",
  "region save",
];

const DENY_ALL_RONSE = [
  "region def eu nl|eu lu|eu fr|eu de|eu be be-vlg be-vbr|be-vlg be-vov behor|be-vov beksr|be-vov bemak|be-vov beoud|be-vov beron|be-vlg be-vwv beavl",
  "region def eu|eu be|be be-wht becle|be-wht beezs|be-wht befbq|be-wht befrs|be-wht bemdl",
  "region allowf *",
  "region denyf eu",
  "region denyf nl",
  "region denyf lu",
  "region denyf fr",
  "region denyf de",
  "region denyf be",
  "region denyf be-vlg",
  "region denyf be-vbr",
  "region denyf be-vov",
  "region denyf be-vwv",
  "region denyf be-wht",
  "region denyf beavl",
  "region denyf becle",
  "region denyf beezs",
  "region denyf befbq",
  "region denyf befrs",
  "region denyf behor",
  "region denyf beksr",
  "region denyf bemak",
  "region denyf bemdl",
  "region denyf beoud",
  "region denyf beron",
  "region home *",
  "region default <null>",
  "region save",
];
