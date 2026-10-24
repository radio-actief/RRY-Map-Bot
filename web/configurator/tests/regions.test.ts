import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addFreeRegion,
  carryFreeRows,
  checkFreeCode,
  freeParentOptions,
  isFreeParent,
  MAX_REGIONS,
  regionCountAfterApply,
  removeFreeRegion,
  defaultScopeOptions,
  homeOverrideOptions,
  setDefaultScope,
  setHomeOverride,
  setUntaggedFlood,
  anchorFromChoice,
  applyLegacyPolicyFields,
  bulk,
  DEFAULT_SCOPE_NONE,
  deviceRegionsFromRead,
  HOME_OVERRIDE_OMIT,
  homeRegionCode,
  policyFor,
  policyFromDevice,
  regionCommandLines,
  regionsAfterApply,
  regionsByState,
  setRowState,
  type Anchor,
  type RegionPolicy,
} from "../src/core/regions";
import { locationChoices, rankPlaces, type Place } from "../src/core/search";

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

/** The old page's first dropdown item for a city-search text (provinces come before places). */
function searchAnchor(query: string): Anchor {
  return anchorFromChoice(locationChoices(query, PLACES)[0]);
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
  return applyLegacyPolicyFields(policyFor(anchor, PLACES), fields);
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
        // The neighbouring regions (gewesten), gb and free rows are new: the old page had no such rows.
        const rows = policyFor(anchor, PLACES).rows.filter(
          (r) => r.group !== "neighbourRegion" && r.group !== "free" && r.code !== "gb",
        );
        expect(rows.map((r) => rowId(r.code))).toEqual(fixtureRowIds(fields));
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
    expect(mak.group).toBe("neighbourMunicipality");
    expect(rows.find((r) => r.code === "be-wht")!.group).toBe("neighbourProvince");
    expect(rows.find((r) => r.code === "nl")!.group).toBe("neighbourCountry");
    expect(mak.label).toMatch(/^Maarkedal \(~\d+ km\) \(bemak\)$/);
    expect(mak.disabled).toEqual({ allow: true, deny: true });
    // Province and country neighbours are open because be and be-vov are allowed.
    expect(rows.find((r) => r.code === "be-wht")!.disabled).toBeUndefined();
    expect(rows.find((r) => r.code === "nl")!.disabled).toBeUndefined();
    expect(rows.find((r) => r.code === "eu")!.group).toBe("country");
  });

  it("lists the neighbouring regions (gewesten) across the home province's land borders", () => {
    const rows = policyFor(ronse, PLACES).rows;
    const regions = rows.filter((r) => r.group === "neighbourRegion");
    // Oost-Vlaanderen borders Henegouwen, so the Walloon Region; never the home region itself.
    expect(regions.map((r) => [r.code, r.label, r.labelKey])).toEqual([
      ["be-wal", "Waals Gewest (be-wal)", "region.kind.neighbourRegion"],
    ]);
    // Opened by the home province, like the neighbouring provinces.
    expect(regions[0].disabled).toBeUndefined();
    const closed = setRowState(policyFor(ronse, PLACES), "be-vov", "none").rows.find((r) => r.code === "be-wal")!;
    expect(closed.disabled).toEqual({ allow: true, deny: true });
    // Antwerp borders Flemish provinces only.
    const antwerp = policyFor({ mode: "province", province_code: "be-van", place: null }, PLACES).rows;
    expect(antwerp.filter((r) => r.group === "neighbourRegion")).toEqual([]);
    // Brussels has no home region row: both regions around it are neighbours.
    const brussels = policyFor({ mode: "province", province_code: "be-bru", place: null }, PLACES).rows;
    expect(brussels.filter((r) => r.group === "neighbourRegion").map((r) => r.code)).toEqual(["be-vlg", "be-wal"]);
  });

  it("nests an allowed neighbouring region's provinces under it in region def", () => {
    let p = policyFor(ronse, PLACES);
    p = setRowState(setRowState(p, "be-wal", "allow"), "be-wht", "allow");
    const def = regionCommandLines(ronse, p, PLACES).filter((l) => l.startsWith("region def "));
    expect(def.join("|")).toMatch(/\bbe be-wal be-wht\b/);
  });

  it("builds a province anchor from the province centroid", () => {
    const anchor: Anchor = { mode: "province", province_code: "be-vov", place: null };
    const p = policyFor(anchor, PLACES);
    expect(p.rows.filter((r) => r.home).map((r) => r.code)).toEqual(["be", "be-vlg", "be-vov"]);
    // Municipality neighbours exist but can never be set without a home municipality.
    const muni = p.rows.filter((r) => r.group === "neighbourMunicipality");
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

describe("device regions", () => {
  const ronse = cityAnchor("Ronse");
  const base = policyFor(ronse, PLACES);

  it("reads the device state like the old page", () => {
    expect(deviceRegionsFromRead(["be", "*", " be-vov "], ["bemak"], "beron", "<null>")).toEqual({
      named: ["be", "be-vov", "bemak", "beron"],
      home: "beron",
      default: null,
    });
    expect(deviceRegionsFromRead([], [], "*", "be")).toEqual({ named: ["be"], home: "*", default: "be" });
  });

  it("removes regions no longer needed, deepest first, before the def lines", () => {
    const device = deviceRegionsFromRead(["be", "be-vov", "beron", "bemak"], [], "be-vov", "be");
    expect(regionCommandLines(ronse, base, PLACES, device)).toEqual([
      "region remove bemak",
      "region remove beron",
      "region def be be-vov",
      "region allowf *",
      "region home be-vov",
      "region default be",
      "region save",
    ]);
  });

  it("clears a removed default first and a removed home next (old page output)", () => {
    const device = deviceRegionsFromRead(
      ["be", "be-vov", "beron", "bemak", "be-wht", "nl", "beavl"],
      ["befrs"],
      "beron",
      "beron",
    );
    // Output of the old buildRegionCommandLines for this read and policy.
    expect(regionCommandLines(ronse, base, PLACES, device)).toEqual([
      "region default <null>",
      "region home *",
      "region remove beavl",
      "region remove befrs",
      "region remove bemak",
      "region remove beron",
      "region remove be-wht",
      "region remove nl",
      "region def be be-vov",
      "region allowf *",
      "region home be-vov",
      "region default be",
      "region save",
    ]);
  });

  it("keeps device codes that are still needed, as selections or ancestors", () => {
    let p = setRowState(base, "beron", "allow");
    p = setRowState(p, "bemak", "deny");
    const device = deviceRegionsFromRead(["be", "be-vov", "beron"], ["bemak"], "beron", "be");
    expect(
      regionCommandLines(ronse, p, PLACES, device).filter((l) => /^region (remove|home \*|default <null>)/.test(l)),
    ).toEqual([]);
  });

  it("after Apply the device holds the policy (no default added to the named set)", () => {
    expect(regionsAfterApply(ronse, base, PLACES)).toEqual({ named: ["be", "be-vov"], home: "be-vov", default: "be" });
    const cleared = bulk(base, "clear");
    expect(regionsAfterApply(ronse, cleared, PLACES)).toEqual({ named: [], home: "*", default: null });
    const p = { ...base, homeOverride: HOME_OVERRIDE_OMIT, defaultScope: "be-wht" };
    expect(regionsAfterApply(ronse, p, PLACES)).toEqual({ named: ["be", "be-vov"], home: "*", default: "be-wht" });
    // Applying again from that state removes nothing.
    const after = regionsAfterApply(ronse, base, PLACES);
    expect(regionCommandLines(ronse, base, PLACES, after)).toEqual(regionCommandLines(ronse, base, PLACES));
  });
});

describe("applyLegacyPolicyFields", () => {
  const ronse = cityAnchor("Ronse");
  const base = policyFor(ronse, PLACES);

  it("keeps the row state for fields the backup lacks", () => {
    const p = applyLegacyPolicyFields(base, { pc_be_wht_d: true });
    expect(regionsByState(p)).toEqual({ allowed: ["be", "be-vov"], denied: ["be-wht"] });
    expect(p.untaggedFlood).toBe(true);
  });

  it("reads the home override only when its checkbox was on", () => {
    const fields = { "policy-home-override-select": "be", "policy-default-scope-select": "__none__" };
    expect(applyLegacyPolicyFields(base, fields)).toMatchObject({ homeOverride: null, defaultScope: DEFAULT_SCOPE_NONE });
    expect(applyLegacyPolicyFields(base, { ...fields, "policy-home-override": true }).homeOverride).toBe("be");
  });

  it("clears a neighbour whose home row is not set", () => {
    const p = applyLegacyPolicyFields(base, { pc_bemak_d: true });
    expect(regionsByState(p).denied).toEqual([]);
  });
});

describe("policyFromDevice", () => {
  const ronse = cityAnchor("Ronse");

  it("adds rows for device codes and sets untagged flood from *", () => {
    const p = policyFromDevice(ronse, PLACES, { allowed: ["be", "be-wlg"], denied: [], home: "be", default: "be" });
    expect(regionsByState(p)).toEqual({ allowed: ["be", "be-wlg"], denied: [] });
    expect(p.rows.find((r) => r.code === "be-wlg")!.group).toBe("device");
    expect([p.untaggedFlood, p.homeOverride, p.defaultScope]).toEqual([false, null, null]);
  });

  it("drops a neighbour deny when the device has no home municipality", () => {
    const p = policyFromDevice(ronse, PLACES, { allowed: ["*", "be", "be-vov"], denied: ["bemak"] });
    expect(regionsByState(p).denied).toEqual([]);
  });

  it("leaves the default scope automatic when it was not read", () => {
    const p = policyFromDevice(ronse, PLACES, { allowed: ["*", "be", "be-vov"], denied: [], home: "be-vov" });
    expect([p.homeOverride, p.defaultScope]).toEqual([null, null]);
    const q = policyFromDevice(ronse, PLACES, { allowed: ["*", "be", "be-vov"], denied: [], default: "<null>" });
    expect(q.defaultScope).toBe(DEFAULT_SCOPE_NONE);
  });
});

// Computed with the previous configurator page's region def/deny functions for the same policy,
// plus the gb row (under eu, after de) that the old page did not have.
const ALLOW_ALL_RONSE = [
  "region def eu nl|eu lu|eu fr|eu de|eu gb|eu be be-vlg be-vbr|be-vlg be-vov behor|be-vov beksr|be-vov bemak|be-vov beoud|be-vov beron",
  "region def eu|eu be|be be-vlg|be-vlg be-vwv beavl|be be-wal be-wht becle|be-wht beezs|be-wht befbq|be-wht befrs|be-wht bemdl",
  "region allowf *",
  "region home beron",
  "region default be",
  "region save",
];

const DENY_ALL_RONSE = [
  "region def eu nl|eu lu|eu fr|eu de|eu gb|eu be be-vlg be-vbr|be-vlg be-vov behor|be-vov beksr|be-vov bemak|be-vov beoud|be-vov beron",
  "region def eu|eu be|be be-vlg|be-vlg be-vwv beavl|be be-wal be-wht becle|be-wht beezs|be-wht befbq|be-wht befrs|be-wht bemdl",
  "region allowf *",
  "region denyf eu",
  "region denyf nl",
  "region denyf lu",
  "region denyf fr",
  "region denyf de",
  "region denyf gb",
  "region denyf be",
  "region denyf be-vlg",
  "region denyf be-wal",
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

describe("scope options", () => {
  const ronse = cityAnchor("Ronse");

  it("lists Allow rows plus * for the home override, in CLI order", () => {
    const p = policyFor(ronse, PLACES);
    expect(homeOverrideOptions(p).map((o) => o.code)).toEqual(["*", "be", "be-vov"]);
    expect(homeOverrideOptions(p).find((o) => o.code === "be")!.label).toBe("Belgium (be)");
  });

  it("lists named Allow rows for the default scope and keeps a stale override", () => {
    let p = policyFor(ronse, PLACES);
    expect(defaultScopeOptions(p).map((o) => o.code)).toEqual(["be", "be-vov"]);
    p = setDefaultScope(p, "be-vov");
    p = setRowState(p, "be-vov", "none");
    expect(defaultScopeOptions(p)).toEqual([
      { code: "be", label: "Belgium (be)" },
      { code: "be-vov", label: "Oost-Vlaanderen (be-vov)", notAllowed: true },
    ]);
  });

  it("falls back to automatic home when the chosen code loses Allow", () => {
    let p = setHomeOverride(policyFor(ronse, PLACES), "be-vov");
    expect(p.homeOverride).toBe("be-vov");
    p = setRowState(p, "be-vov", "deny");
    expect(p.homeOverride).toBeNull();
  });

  it("toggles untagged flood", () => {
    expect(setUntaggedFlood(policyFor(ronse, PLACES), false).untaggedFlood).toBe(false);
  });
});

describe("United Kingdom", () => {
  const ronse = cityAnchor("Ronse");

  it("lists gb after de among the neighbouring countries, locked until be is set", () => {
    const p = policyFor(ronse, PLACES);
    const countries = p.rows.filter((r) => r.group === "neighbourCountry");
    expect(countries.map((r) => r.code)).toEqual(["nl", "lu", "fr", "de", "gb"]);
    expect(countries[4].label).toBe("United Kingdom (gb)");
    expect(countries[4].disabled).toBeUndefined();
    const closed = setRowState(p, "be", "none");
    expect(closed.rows.find((r) => r.code === "gb")!.disabled).toEqual({ allow: true, deny: true });
    expect(setRowState(closed, "gb", "allow")).toBe(closed);
  });

  it("defines gb under eu, after de", () => {
    let p = policyFor(ronse, PLACES);
    for (const c of ["eu", "de", "gb"]) p = setRowState(p, c, "allow");
    const def = regionCommandLines(ronse, p, PLACES).filter((l) => l.startsWith("region def "));
    expect(def.join(" ")).toMatch(/\beu\b.*\bde\|eu gb\|eu\b/);
    expect(def).toEqual(["region def eu de|eu gb|eu be be-vov"]);
  });
});

describe("free regions", () => {
  const ronse = cityAnchor("Ronse");
  const base = policyFor(ronse, PLACES);
  const defLines = (p: RegionPolicy) => regionCommandLines(ronse, p, PLACES).filter((l) => l.startsWith("region def "));
  const distinctDefCodes = (p: RegionPolicy) =>
    new Set(
      defLines(p)
        .flatMap((l) => l.slice("region def ".length).split(" "))
        .flatMap((tok) => tok.split("|"))
        .filter((c) => c !== "*"),
    ).size;

  it("checks a free code", () => {
    expect(checkFreeCode(base, "")).toBe("empty");
    expect(checkFreeCode(base, "a".repeat(31))).toBe("tooLong");
    expect(checkFreeCode(base, "a".repeat(30))).toBe("ok");
    expect(checkFreeCode(base, "Ab")).toBe("chars");
    expect(checkFreeCode(base, "a_b")).toBe("chars");
    expect(checkFreeCode(base, "*")).toBe("taken");
    expect(checkFreeCode(base, "beron")).toBe("taken");
    expect(checkFreeCode(base, "my-zone1")).toBe("ok");
    expect(checkFreeCode(addFreeRegion(base, "my-zone1", null, ronse), "my-zone1")).toBe("taken");
  });

  it("adds an allowed, never locked row and defines it with its parent chain", () => {
    // Cleared first: be is not set, so the neighbour tiers (be-wht among them) are locked.
    const p = addFreeRegion(bulk(base, "clear"), "zone", "be-wht", ronse);
    const zone = p.rows.find((r) => r.code === "zone")!;
    expect(zone).toMatchObject({
      code: "zone",
      label: "zone",
      labelKey: "region.kind.free",
      group: "free",
      parent: "be-wht",
      allow: true,
      deny: false,
    });
    expect(zone.disabled).toBeUndefined();
    expect(regionsByState(p)).toEqual({ allowed: ["zone"], denied: [] });
    expect(defLines(p)).toEqual(["region def be be-wht zone"]);
    // Offered as home region and default scope once allowed.
    expect(homeOverrideOptions(p).map((o) => o.code)).toContain("zone");
    expect(defaultScopeOptions(p).map((o) => o.code)).toEqual(["zone"]);
  });

  it("nests a free region under another; a top-level one sits under *", () => {
    let p = addFreeRegion(base, "zone", null, ronse);
    p = addFreeRegion(p, "sub", "zone", ronse);
    expect(p.rows.find((r) => r.code === "sub")!.parent).toBe("zone");
    expect(defLines(p)).toEqual(["region def be be-vov|* zone sub"]);
    // The child alone still pulls in its parent.
    expect(defLines(setRowState(p, "zone", "none"))).toEqual(["region def be be-vov|* zone sub"]);
  });

  it("defines the home province and municipality ancestors when a free region sits under them", () => {
    const cleared = bulk(base, "clear");
    const underProvince = addFreeRegion(cleared, "zone", "be-vov", ronse);
    expect(defLines(underProvince)).toEqual(["region def be be-vov zone"]);
    const underCity = addFreeRegion(cleared, "zone", "beron", ronse);
    expect(defLines(underCity)).toEqual(["region def be be-vov beron zone"]);
    for (const p of [underProvince, underCity]) {
      expect(regionCountAfterApply(ronse, p, PLACES)).toBe(distinctDefCodes(p));
    }
    // Without a free region under them, the home rows still get no automatic ancestors.
    expect(defLines(setRowState(cleared, "be-vov", "allow"))).toEqual([]);
  });

  it("removes a free region only once no other free region sits under it", () => {
    let p = addFreeRegion(addFreeRegion(base, "zone", null, ronse), "sub", "zone", ronse);
    expect(isFreeParent(p, "zone")).toBe(true);
    expect(isFreeParent(p, "sub")).toBe(false);
    expect(removeFreeRegion(p, "zone")).toBe(p);
    p = removeFreeRegion(p, "sub");
    expect(p.rows.some((r) => r.code === "sub")).toBe(false);
    expect(isFreeParent(p, "zone")).toBe(false);
    p = removeFreeRegion(p, "zone");
    expect(p.rows.some((r) => r.group === "free")).toBe(false);
    expect(removeFreeRegion(p, "be")).toEqual(p);
  });

  it("offers top level, eu, be, gewesten, provinces, the home municipality and free rows as parents", () => {
    const p = addFreeRegion(base, "zone", null, ronse);
    const options = freeParentOptions(p, ronse);
    expect(options[0]).toEqual({ code: "", label: "Top level" });
    expect(options.map((o) => o.code)).toEqual([
      "",
      "eu",
      "be",
      "be-vlg",
      "be-wal",
      "be-vbr",
      "be-vov",
      "be-vwv",
      "be-wht",
      "beron",
      "zone",
    ]);
    expect(options.find((o) => o.code === "be-wht")!.label).toBe("Henegouwen (be-wht)");
    expect(options.find((o) => o.code === "beron")!.label).toBe("Ronse (beron)");
  });

  it("carries free rows into a rebuilt policy", () => {
    const kortrijk = cityAnchor("Kortrijk");
    let p = setRowState(addFreeRegion(base, "zone", "beron", ronse), "zone", "deny");
    p = addFreeRegion(addFreeRegion(p, "sub", "zone", ronse), "wide", "eu", ronse);
    const next = carryFreeRows(policyFor(kortrijk, PLACES), p, kortrijk);
    const free = next.rows.filter((r) => r.group === "free");
    expect(free.map((r) => [r.code, r.parent, r.allow, r.deny])).toEqual([
      ["zone", null, false, true],
      ["sub", "zone", true, false],
      ["wide", "eu", true, false],
    ]);
    // A free code that is a structured row in the new policy (Kortrijk is bekjk) is dropped.
    const bekjk = carryFreeRows(policyFor(kortrijk, PLACES), addFreeRegion(base, "bekjk", null, ronse), kortrijk);
    expect(bekjk.rows.filter((r) => r.code === "bekjk").map((r) => r.group)).toEqual(["municipality"]);
    const fresh = policyFor(kortrijk, PLACES);
    expect(carryFreeRows(fresh, null, kortrijk)).toBe(fresh);
  });

  it("a carried free row replaces a device row with the same code", () => {
    const p = addFreeRegion(base, "zone", null, ronse);
    const next = carryFreeRows(policyFor(ronse, PLACES, ["zone"]), p, ronse);
    expect(next.rows.filter((r) => r.code === "zone").map((r) => r.group)).toEqual(["free"]);
  });

  it("counts the regions the device holds after Apply", () => {
    expect(regionCountAfterApply(ronse, base, PLACES)).toBe(2);
    // The default scope and its ancestors count too.
    expect(regionCountAfterApply(ronse, { ...base, defaultScope: "be-wht" }, PLACES)).toBe(3);
    let p = addFreeRegion(addFreeRegion(bulk(base, "allowAll"), "zone", "be-wht", ronse), "sub", "zone", ronse);
    expect(regionCountAfterApply(ronse, p, PLACES)).toBe(distinctDefCodes(p));
    expect(regionCountAfterApply(ronse, p, PLACES)).toBeLessThanOrEqual(MAX_REGIONS);
    p = base;
    for (let i = 0; i < 31; i++) p = addFreeRegion(p, `zone${i}`, null, ronse);
    expect(regionCountAfterApply(ronse, p, PLACES)).toBe(33);
    expect(regionCountAfterApply(ronse, p, PLACES)).toBe(distinctDefCodes(p));
    expect(MAX_REGIONS).toBe(32);
  });

  it("puts a free region at top level when its parent is not offered", () => {
    // xx was a parent option, then removed: zz must not land under it.
    const gone = removeFreeRegion(addFreeRegion(base, "xx", null, ronse), "xx");
    const zz = addFreeRegion(gone, "zz", "xx", ronse);
    expect(zz.rows.find((r) => r.code === "zz")!.parent).toBeNull();
    expect(defLines(zz).join(" ")).not.toMatch(/\bxx\b/);
    // beron is offered for Ronse, not once the anchor is Kortrijk.
    const kortrijk = cityAnchor("Kortrijk");
    const other = addFreeRegion(policyFor(kortrijk, PLACES), "zz", "beron", kortrijk);
    expect(other.rows.find((r) => r.code === "zz")!.parent).toBeNull();
    expect(addFreeRegion(base, "zz", "beron", ronse).rows.find((r) => r.code === "zz")!.parent).toBe("beron");
  });

  it("removing the free region that is the default scope clears the default scope", () => {
    const p = setDefaultScope(addFreeRegion(base, "zone", null, ronse), "zone");
    expect(regionCommandLines(ronse, p, PLACES)).toContain("region default zone");
    const removed = removeFreeRegion(p, "zone");
    expect(removed.defaultScope).toBeNull();
    const lines = regionCommandLines(ronse, removed, PLACES);
    expect(lines).not.toContain("region default zone");
    expect(lines.join("\n")).not.toMatch(/\bzone\b/);
    // Another default scope is left alone.
    const other = setDefaultScope(addFreeRegion(base, "zone", null, ronse), "be-vov");
    expect(removeFreeRegion(other, "zone").defaultScope).toBe("be-vov");
  });

  it("re-adds a code read from the device as your own region, in place of the device row", () => {
    const read = policyFor(ronse, PLACES, ["zone"]);
    expect(checkFreeCode(read, "zone")).toBe("ok");
    const p = addFreeRegion(read, "zone", "be-wht", ronse);
    const zone = p.rows.filter((r) => r.code === "zone");
    expect(zone.map((r) => [r.group, r.parent, r.allow, r.deny])).toEqual([["free", "be-wht", true, false]]);
    expect(defLines(p)).toEqual(["region def be be-vov|be be-wht zone"]);
    // The device row's Deny is kept.
    const denied = addFreeRegion(setRowState(read, "zone", "deny"), "zone", null, ronse);
    expect(denied.rows.filter((r) => r.code === "zone").map((r) => [r.group, r.allow, r.deny])).toEqual([
      ["free", false, true],
    ]);
  });
});

describe("removing free regions from the device", () => {
  const ronse = cityAnchor("Ronse");
  const base = policyFor(ronse, PLACES);
  const removes = (p: RegionPolicy, named: string[]) =>
    regionCommandLines(ronse, p, PLACES, { named: ["be", "be-vov", ...named], home: "be-vov", default: "be" }).filter(
      (l) => l.startsWith("region remove "),
    );

  it("removes a child before its parent, whatever the code lengths", () => {
    // Both still listed, neither Allow nor Deny: the script removes them from the device.
    let p = addFreeRegion(addFreeRegion(base, "longparent", null, ronse), "a", "longparent", ronse);
    p = setRowState(setRowState(p, "a", "none"), "longparent", "none");
    expect(removes(p, ["longparent", "a"])).toEqual(["region remove a", "region remove longparent"]);
  });

  it("removes a free child before the structured parent it sits under", () => {
    let p = setRowState(addFreeRegion(base, "a", "be-wht", ronse), "a", "none");
    expect(removes(p, ["be-wht", "a", "bemak"])).toEqual([
      "region remove bemak",
      "region remove a",
      "region remove be-wht",
    ]);
  });

  it("never removes a free region that is kept or carried to a new parent", () => {
    let p = addFreeRegion(addFreeRegion(base, "zone", "beron", ronse), "sub", "zone", ronse);
    p = setRowState(p, "sub", "none");
    expect(removes(p, ["beron", "zone", "sub"])).toEqual(["region remove sub"]);
    // The pin moves to Kortrijk: zone falls back to top level and stays; beron goes.
    const kortrijk = cityAnchor("Kortrijk");
    const moved = carryFreeRows(policyFor(kortrijk, PLACES), p, kortrijk);
    expect(moved.rows.find((r) => r.code === "zone")!.parent).toBeNull();
    const device = { named: ["be", "be-vov", "beron", "zone", "sub"], home: "be-vov", default: "be" };
    const lines = regionCommandLines(kortrijk, moved, PLACES, device);
    expect(lines.filter((l) => l.startsWith("region remove "))).toEqual([
      "region remove beron",
      "region remove be-vov",
      "region remove sub",
    ]);
  });
});
