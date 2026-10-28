/**
 * Region scope policy (which rows exist for a location, their Allow/Deny state, bulk actions)
 * and the `region …` CLI lines it produces. The policy is a plain RegionPolicy value;
 * the UI grid reads and writes it.
 */
import { GEWEST_NAMES, GEWEST_OF_PROVINCE, PROVINCE_ADJACENCY, PROVINCE_NAMES } from "./be-regions";
import { t } from "../i18n/t";
import { findGeographicNeighbors, neighborsInRadius } from "./geo";
import type { DeviceSnapshot } from "./plan";
import type { LocationChoice, Place } from "./search";

export type Anchor = { mode: "city" | "province" | "country"; province_code: string | null; place: Place | null };

/** The anchor for a picked location choice (old locationChoiceToAnchor). */
export function anchorFromChoice(choice: LocationChoice): Anchor {
  switch (choice.type) {
    case "city":
      return { mode: "city", province_code: choice.place.province_code, place: choice.place };
    case "province":
      return { mode: "province", province_code: choice.code, place: null };
    case "country":
      return { mode: "country", province_code: null, place: null };
  }
}

/**
 * One Allow/Deny row. Home rows (`home: true`) are grouped by level: `country` (be), `province`
 * (the optional gewest and the province) and `municipality`. Other groups: the neighbouring
 * municipalities, provinces, regions (gewesten) and countries, `country` (the wider `eu` row),
 * `device` (codes read from the repeater that no other row lists) and `free` (the user's own codes).
 */
export type RegionRow = {
  code: string;
  labelKey: string;
  label: string;
  group:
    | "country"
    | "province"
    | "municipality"
    | "neighbourMunicipality"
    | "neighbourProvince"
    | "neighbourRegion"
    | "neighbourCountry"
    | "device"
    | "free";
  allow: boolean;
  deny: boolean;
  home?: boolean;
  /**
   * Neighbour gating: a neighbour tier is locked (and kept clear) until its home row
   * (municipality, province or be) has Allow or Deny. Neighbouring regions open with the province.
   */
  disabled?: { allow?: boolean; deny?: boolean };
  /** Free rows only: the code this region is defined under; null = top level (under `*`). */
  parent?: string | null;
};

export type RegionPolicy = {
  rows: RegionRow[];
  untaggedFlood: boolean;
  /** null = automatic home; HOME_OVERRIDE_OMIT = no `region home` line; else that code. */
  homeOverride: string | null;
  /** null = automatic (prefer be); DEFAULT_SCOPE_NONE = `region default <null>`; else that code. */
  defaultScope: string | null;
};

/** Home override: omit `region home` from the script entirely. */
export const HOME_OVERRIDE_OMIT = "__nohome__";
/** Default scope: emit `region default <null>` to clear it. */
export const DEFAULT_SCOPE_NONE = "__none__";

const COUNTRY_NAMES: Record<string, string> = {
  nl: "region.name.nl",
  lu: "region.name.lu",
  fr: "region.name.fr",
  de: "region.name.de",
  gb: "region.name.gb",
  be: "region.name.be",
};
const NEIGHBOR_COUNTRY_CODES = ["nl", "lu", "fr", "de", "gb"];
const CLI_ORDER_FIRST = ["eu", "nl", "lu", "fr", "de", "gb", "be", "be-vlg", "be-wal"];
/** MAX_REGION_ENTRIES: the named regions the firmware holds (`*` not counted). */
export const MAX_REGIONS = 32;
/** A region code: the firmware's name field is 31 bytes. */
const FREE_CODE = /^[a-z0-9-]{1,30}$/;
/** RepeaterSerial.MAX_LINE_LEN: the longest line the serial layer sends. */
const MAX_LINE_LEN = 151;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isProvince = (code: string) => has(PROVINCE_NAMES, code);
const isGewest = (code: string) => has(GEWEST_NAMES, code);

function cityIndex(places: Place[]): Map<string, Place> {
  const m = new Map<string, Place>();
  for (const p of places) if (!m.has(p.city_code)) m.set(p.city_code, p);
  return m;
}

function expandedNameForRegionCode(code: string, cities: Map<string, Place>): string {
  if (code === "*") return t("region.name.wildcard");
  if (code === "eu") return t("region.name.eu");
  if (isProvince(code)) return PROVINCE_NAMES[code];
  if (isGewest(code)) return GEWEST_NAMES[code];
  if (has(COUNTRY_NAMES, code)) return t(COUNTRY_NAMES[code]);
  const row = cities.get(code);
  if (row && row.plaats) return row.plaats;
  return code;
}

// ---------------------------------------------------------------------------
// Rows

const row = (
  code: string,
  label: string,
  group: RegionRow["group"],
  labelKey: string,
  extra: Partial<RegionRow> = {},
): RegionRow => ({ code, labelKey, label, group, allow: false, deny: false, ...extra });

const named = (name: string, code: string) => `${name} (${code})`;

function provinceCentroid(pc: string, places: Place[]): { lat: number; lon: number } {
  let sumLat = 0;
  let sumLon = 0;
  let n = 0;
  for (const r of places) {
    if (r.province_code !== pc) continue;
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    sumLat += r.lat;
    sumLon += r.lon;
    n++;
  }
  if (!n) return { lat: 50.5, lon: 4.35 };
  return { lat: sumLat / n, lon: sumLon / n };
}

/** Where the pin goes for an anchor (old neighborSeedRow): the place, a province centroid, or mid-Belgium. */
export function anchorCenter(anchor: Anchor, places: Place[]): { lat: number; lon: number } {
  const { lat, lon } = neighborSeed(anchor, places);
  return { lat, lon };
}

/** Where neighbour distances are measured from: the place, a province centroid, or mid-Belgium. */
function neighborSeed(anchor: Anchor, places: Place[]): Place {
  if (anchor.mode === "city" && anchor.place) return anchor.place;
  const blank = { nis5: "", plaats: "", gemeente: "" };
  if (anchor.mode === "province" && anchor.province_code) {
    const c = provinceCentroid(anchor.province_code, places);
    return { ...blank, ...c, province_code: anchor.province_code, city_code: "__province_centroid__" };
  }
  return { ...blank, lat: 50.5, lon: 4.35, province_code: "be-vbr", city_code: "__be_centroid__" };
}

/**
 * Land-border provinces of the home province that have a mapped place within the radius;
 * all land-border provinces when no place nearby lies in another province.
 */
function neighborProvinces(neighbors: { place: Place }[], homeProvinceCode: string | null): string[] {
  const pc = homeProvinceCode ? homeProvinceCode.trim() : homeProvinceCode;
  if (!pc || !has(PROVINCE_ADJACENCY, pc)) return [];
  const adjacent = PROVINCE_ADJACENCY[pc];
  const nearbyProv = new Set<string>();
  for (const n of neighbors) {
    const ocp = n.place.province_code;
    if (ocp && ocp !== pc) nearbyProv.add(ocp);
  }
  if (nearbyProv.size > 0) return adjacent.filter((p) => nearbyProv.has(p)).sort();
  return adjacent.slice().sort();
}

/** The gewesten across the home province's land borders, other than the home province's own. */
function neighborGewesten(homeProvinceCode: string | null): string[] {
  if (!homeProvinceCode || !has(PROVINCE_ADJACENCY, homeProvinceCode)) return [];
  const own = GEWEST_OF_PROVINCE[homeProvinceCode];
  const out = new Set<string>();
  for (const p of PROVINCE_ADJACENCY[homeProvinceCode]) {
    const g = GEWEST_OF_PROVINCE[p];
    if (g && g !== own) out.add(g);
  }
  return sortCodesForCli(out);
}

function homeProvinceOf(anchor: Anchor): string | null {
  if (anchor.mode === "province") return anchor.province_code;
  return anchor.place ? anchor.place.province_code : null;
}

function homeRows(anchor: Anchor): RegionRow[] {
  const rows = [row("be", named(t("region.name.be"), "be"), "country", "region.kind.country", { home: true, allow: true })];
  const pc =
    anchor.mode === "province" && anchor.province_code
      ? anchor.province_code
      : anchor.mode === "city" && anchor.place
        ? anchor.place.province_code
        : null;
  if (!pc) return rows;
  const g = GEWEST_OF_PROVINCE[pc];
  if (g) rows.push(row(g, named(GEWEST_NAMES[g] || g, g), "province", "region.kind.gewest", { home: true }));
  rows.push(
    row(pc, named(PROVINCE_NAMES[pc] || pc, pc), "province", "region.kind.province", { home: true, allow: true }),
  );
  if (anchor.mode === "city" && anchor.place) {
    const city = anchor.place;
    rows.push(
      row(city.city_code, named(city.plaats, city.city_code), "municipality", "region.kind.municipality", {
        home: true,
      }),
    );
  }
  return rows;
}

function deviceRows(codes: string[], existing: RegionRow[], places: Place[]): RegionRow[] {
  const seen = new Set(existing.map((r) => r.code));
  const cities = cityIndex(places);
  const out: RegionRow[] = [];
  for (const raw of codes) {
    const c = String(raw || "").trim();
    if (!c || c === "*" || seen.has(c)) continue;
    seen.add(c);
    const name = expandedNameForRegionCode(c, cities);
    out.push(row(c, name !== c ? named(name, c) : c, "device", "region.kind.device"));
  }
  return out;
}

/** The rows and default checks for a location (old renderPolicyGrids + applyPolicyDefaults). */
export function policyFor(anchor: Anchor, places: Place[], deviceCodes: string[] = []): RegionPolicy {
  const seed = neighborSeed(anchor, places);
  const neighborsRadius = neighborsInRadius(seed, places);
  const neighborsScope = findGeographicNeighbors(seed, places);

  const rows: RegionRow[] = [
    ...homeRows(anchor),
    ...neighborsScope.map(({ place, km }) =>
      row(
        place.city_code,
        t("region.label.neighbourKm", { name: place.plaats, km: Math.round(km), code: place.city_code }),
        "neighbourMunicipality",
        "region.kind.neighbourMunicipality",
      ),
    ),
    ...neighborProvinces(neighborsRadius, homeProvinceOf(anchor)).map((pc) =>
      row(pc, named(PROVINCE_NAMES[pc] || pc, pc), "neighbourProvince", "region.kind.neighbourProvince"),
    ),
    ...neighborGewesten(homeProvinceOf(anchor)).map((g) =>
      row(g, named(GEWEST_NAMES[g] || g, g), "neighbourRegion", "region.kind.neighbourRegion"),
    ),
    ...NEIGHBOR_COUNTRY_CODES.map((c) =>
      row(c, named(t(COUNTRY_NAMES[c]), c), "neighbourCountry", "region.kind.neighbourCountry"),
    ),
    row("eu", named(t("region.name.eu"), "eu"), "country", "region.kind.wider"),
  ];
  rows.push(...deviceRows(deviceCodes, rows, places));
  return finalize({ rows, untaggedFlood: true, homeOverride: null, defaultScope: null });
}

// ---------------------------------------------------------------------------
// Gating and edits

type Tier = "municipality" | "province" | "country";

/** Which home row opens a neighbour group; null for the rows that are not neighbours. */
const NEIGHBOUR_TIER: Partial<Record<RegionRow["group"], Tier>> = {
  neighbourMunicipality: "municipality",
  neighbourProvince: "province",
  neighbourRegion: "province",
  neighbourCountry: "country",
};

const isSet = (r: RegionRow) => r.allow || r.deny;

/** Old applyNeighborPolicyGating: each neighbour tier opens only when its home row is set. */
function gate(rows: RegionRow[]): RegionRow[] {
  const home = rows.filter((r) => r.home);
  const open: Record<Tier, boolean> = {
    country: home.some((r) => r.code === "be" && isSet(r)),
    province: home.some((r) => isProvince(r.code) && isSet(r)),
    municipality: home.some((r) => r.group === "municipality" && isSet(r)),
  };
  return rows.map((r) => {
    const tier = NEIGHBOUR_TIER[r.group];
    if (!tier) return r;
    const rest = { ...r };
    delete rest.disabled;
    return open[tier]
      ? rest
      : { ...rest, allow: false, deny: false, disabled: { allow: true, deny: true } };
  });
}

const locked = (r: RegionRow) => !!(r.disabled?.allow || r.disabled?.deny);

/** Home override select: a code that is no longer Allow-checked falls back to automatic. */
function effectiveHomeOverride(p: RegionPolicy): string | null {
  const v = p.homeOverride;
  if (!v || v === HOME_OVERRIDE_OMIT || v === "*") return v;
  return p.rows.some((r) => r.allow && r.code === v) ? v : null;
}

/** A free region whose parent is not set to Allow or Deny (or is itself) moves to top level. */
function settleFreeParents(rows: RegionRow[]): RegionRow[] {
  const set = new Set(rows.filter(isSet).map((r) => r.code));
  return rows.map((r) =>
    r.group === "free" && r.parent && (r.parent === r.code || !set.has(r.parent)) ? { ...r, parent: null } : r,
  );
}

/** Old finalizePolicyUiChange: re-gate, settle the free parents, then refresh the home override. */
function finalize(p: RegionPolicy): RegionPolicy {
  const gated = { ...p, rows: settleFreeParents(gate(p.rows)) };
  return { ...gated, homeOverride: effectiveHomeOverride(gated) };
}

/** A policy as the steps keep it, for one that comes from elsewhere (a backup file). */
export const settlePolicy = finalize;

/**
 * Set one row to Allow, Deny or neither (they exclude each other). Locked or unknown rows are
 * ignored, and so is neither on a row a free region sits under.
 */
export function setRowState(policy: RegionPolicy, code: string, state: "allow" | "deny" | "none"): RegionPolicy {
  const target = policy.rows.find((r) => r.code === code);
  if (!target || locked(target)) return policy;
  if (state === "none" && isFreeParent(policy, code)) return policy;
  return finalize({
    ...policy,
    rows: policy.rows.map((r) => (r === target ? { ...r, allow: state === "allow", deny: state === "deny" } : r)),
  });
}

export function bulk(policy: RegionPolicy, action: "recommended" | "allowAll" | "denyAll" | "clear"): RegionPolicy {
  const map = (rows: RegionRow[], f: (r: RegionRow) => Partial<RegionRow>) => rows.map((r) => ({ ...r, ...f(r) }));
  switch (action) {
    case "recommended":
      return finalize({
        rows: map(policy.rows, (r) => ({ allow: !!r.home && (r.code === "be" || isProvince(r.code)), deny: false })),
        untaggedFlood: true,
        homeOverride: null,
        defaultScope: null,
      });
    case "allowAll": {
      // Home and wider rows first, so the gates open before the rest is set.
      const rows = gate(map(policy.rows, (r) => (r.home || r.code === "eu" ? { allow: true, deny: false } : {})));
      return finalize({ ...policy, rows: map(rows, (r) => (locked(r) ? {} : { allow: true, deny: false })) });
    }
    case "denyAll": {
      const rows = gate(map(policy.rows, (r) => (r.home ? { allow: false, deny: true } : {})));
      return finalize({ ...policy, rows: map(rows, (r) => (locked(r) ? {} : { allow: false, deny: true })) });
    }
    case "clear":
      return finalize({
        ...policy,
        rows: map(policy.rows, () => ({ allow: false, deny: false })),
        homeOverride: null,
        defaultScope: null,
      });
  }
}

export function regionsByState(policy: RegionPolicy): { allowed: string[]; denied: string[] } {
  return {
    allowed: policy.rows.filter((r) => r.allow).map((r) => r.code),
    denied: policy.rows.filter((r) => r.deny).map((r) => r.code),
  };
}

// ---------------------------------------------------------------------------
// Home and default scope

/** Smallest Allow-checked home row: municipality, then province, then be; else `*`. */
function deepestAllowedHomeRegionCode(p: RegionPolicy): string {
  const home = p.rows.filter((r) => r.home);
  const chain = [
    home.find((r) => r.group === "municipality"),
    home.find((r) => isProvince(r.code)),
    home.find((r) => r.code === "be"),
  ];
  for (const r of chain) if (r && r.allow) return r.code;
  return "*";
}

/** The code `region home` sets, or null when the line is omitted. */
function homeLineCode(p: RegionPolicy): string | null {
  const v = effectiveHomeOverride(p);
  if (v === HOME_OVERRIDE_OMIT) return null;
  return v || deepestAllowedHomeRegionCode(p);
}

/** The region `region home` will set (for the map), or null for none / the wildcard. */
export function homeRegionCode(policy: RegionPolicy): string | null {
  const c = homeLineCode(policy);
  return c && c !== "*" ? c : null;
}

/** The region `region default` will set, or null for `<null>`. */
export function defaultRegionCode(policy: RegionPolicy): string | null {
  const c = defaultLineCode(policy);
  return c.toLowerCase() === "<null>" ? null : c;
}

/** #BEmesh automatic default scope: be when allowed, else the deepest home Allow; null when none. */
export function recommendedDefaultScopeCode(p: RegionPolicy): string | null {
  if (p.rows.some((r) => r.code === "be" && r.allow && !locked(r))) return "be";
  const deepest = deepestAllowedHomeRegionCode(p);
  return deepest !== "*" ? deepest : null;
}

/** The code `region default` sets, or `<null>`. */
function defaultLineCode(p: RegionPolicy): string {
  const v = p.defaultScope;
  if (v === DEFAULT_SCOPE_NONE) return "<null>";
  if (v) return v;
  return recommendedDefaultScopeCode(p) || "<null>";
}

export type ScopeOption = { code: string; label: string; notAllowed?: boolean };

function optionLabel(policy: RegionPolicy, code: string): string {
  if (code === "*") return `* (${t("region.name.wildcard")})`;
  return policy.rows.find((r) => r.code === code)?.label ?? code;
}

/** Choices for the home override (old refreshHomeOverrideSelect): every Allow row plus `*`, in CLI order. */
export function homeOverrideOptions(policy: RegionPolicy): ScopeOption[] {
  const codes = starFirst(sortCodesForCli(new Set([...policy.rows.filter((r) => r.allow).map((r) => r.code), "*"])));
  return codes.map((code) => ({ code, label: optionLabel(policy, code) }));
}

/**
 * Choices for the default flood scope (old refreshDefaultScopeSelect): every named Allow row in CLI
 * order; an explicit override that is no longer Allow stays listed, marked `notAllowed`.
 */
export function defaultScopeOptions(policy: RegionPolicy): ScopeOption[] {
  const codes = sortCodesForCli(policy.rows.filter((r) => r.allow && r.code !== "*").map((r) => r.code));
  const keep = policy.defaultScope;
  const stale = keep && keep !== DEFAULT_SCOPE_NONE && !codes.includes(keep) ? keep : null;
  return [
    ...codes.map((code) => ({ code, label: optionLabel(policy, code) })),
    ...(stale ? [{ code: stale, label: optionLabel(policy, stale), notAllowed: true }] : []),
  ];
}

/** Turn the untagged-flood (`*`) option on or off. */
export function setUntaggedFlood(policy: RegionPolicy, on: boolean): RegionPolicy {
  return { ...policy, untaggedFlood: on };
}

/** Pick the home override (null = automatic, HOME_OVERRIDE_OMIT = no line, else a code). */
export function setHomeOverride(policy: RegionPolicy, value: string | null): RegionPolicy {
  return finalize({ ...policy, homeOverride: value || null });
}

/** Pick the default flood scope (null = automatic, DEFAULT_SCOPE_NONE = `<null>`, else a code). */
export function setDefaultScope(policy: RegionPolicy, value: string | null): RegionPolicy {
  return { ...policy, defaultScope: value || null };
}

// ---------------------------------------------------------------------------
// Free regions

const isFreeRow = (r: RegionRow) => r.group === "free";

/**
 * Whether `code` can be added as a free region: 1–30 of a–z, 0–9 and -, and not `*` or a listed
 * row. A code read from the device (a device row) can be added: the free row takes its place.
 */
export function checkFreeCode(policy: RegionPolicy, code: string): "ok" | "empty" | "tooLong" | "chars" | "taken" {
  if (!code) return "empty";
  if (code === "*" || policy.rows.some((r) => r.code === code && r.group !== "device")) return "taken";
  if (code.length > 30) return "tooLong";
  return FREE_CODE.test(code) ? "ok" : "chars";
}

/** Parents a free region can sit under: top level (code ""), then every row set to Allow or Deny, in table order. */
export function freeParentOptions(policy: RegionPolicy): ScopeOption[] {
  return [
    { code: "", label: t("regions.free.top") },
    ...policy.rows.filter(isSet).map((r) => ({ code: r.code, label: optionLabel(policy, r.code) })),
  ];
}

/**
 * Add a free region under `parent` (null or "" = top level; a parent freeParentOptions does not
 * offer is top level too). It starts on Allow; one that replaces a device row keeps that row's
 * Allow or Deny. Invalid codes are ignored.
 */
export function addFreeRegion(policy: RegionPolicy, code: string, parent: string | null): RegionPolicy {
  if (checkFreeCode(policy, code) !== "ok") return policy;
  const offered = !!parent && freeParentOptions(policy).some((o) => o.code === parent);
  const device = policy.rows.find((r) => r.code === code);
  const state = device && isSet(device) ? { allow: device.allow, deny: device.deny } : { allow: true };
  const added = row(code, code, "free", "region.kind.free", { ...state, parent: offered ? parent : null });
  return finalize({ ...policy, rows: [...policy.rows.filter((r) => r !== device), added] });
}

/** Whether another free region sits under `code`. */
export function isFreeParent(policy: RegionPolicy, code: string): boolean {
  return policy.rows.some((r) => isFreeRow(r) && r.parent === code);
}

/** Remove a free region (and the default scope when it is that region); a no-op while another free region sits under it. */
export function removeFreeRegion(policy: RegionPolicy, code: string): RegionPolicy {
  if (isFreeParent(policy, code)) return policy;
  return finalize({
    ...policy,
    rows: policy.rows.filter((r) => !(isFreeRow(r) && r.code === code)),
    defaultScope: policy.defaultScope === code ? null : policy.defaultScope,
  });
}

/**
 * The free rows of `prev` (with their states) appended to a rebuilt policy. A free row whose code
 * is now a structured row is dropped; one that matches a device row replaces it. A parent that
 * is not set to Allow or Deny there falls back to top level.
 */
export function carryFreeRows(next: RegionPolicy, prev: RegionPolicy | null): RegionPolicy {
  const structured = new Set(next.rows.filter((r) => r.group !== "device").map((r) => r.code));
  const free = (prev?.rows ?? []).filter((r) => isFreeRow(r) && !structured.has(r.code));
  if (!free.length) return next;
  const codes = new Set(free.map((r) => r.code));
  return finalize({ ...next, rows: [...next.rows.filter((r) => !codes.has(r.code)), ...free] });
}

/**
 * The rows of `prev` with these codes kept on top of `next`: a row `next` has takes its
 * Allow/Deny, any other row is added (free rows via carryFreeRows). Re-gated, so a neighbour
 * whose home row is not set is cleared.
 */
export function keepRows(next: RegionPolicy, prev: RegionPolicy, codes: string[]): RegionPolicy {
  const kept = prev.rows.filter((r) => codes.includes(r.code));
  const free = kept.filter(isFreeRow);
  const states = new Map(kept.filter((r) => !isFreeRow(r)).map((r) => [r.code, r]));
  const known = new Set(next.rows.map((r) => r.code));
  const merged = finalize({
    ...next,
    rows: [
      ...next.rows.map((r) => {
        const k = states.get(r.code);
        return k ? { ...r, allow: k.allow, deny: k.deny } : r;
      }),
      ...[...states.values()].filter((r) => !known.has(r.code)),
    ],
  });
  return carryFreeRows(merged, { ...prev, rows: free });
}

// ---------------------------------------------------------------------------
// Policies from an old backup or a device read

/** Old page checkbox id for a row: `pc_<code, non-alphanumerics as _>`, then `_a` (Allow) or `_d` (Deny). */
const legacyRowId = (code: string) => `pc_${code.replace(/[^a-zA-Z0-9]/g, "_")}`;

/**
 * An old (v1) backup's policy fields applied onto the rows policyFor built: the pc_* checkboxes,
 * policy-untagged-flood, the home override and the default scope. Absent fields keep the row's state.
 */
export function applyLegacyPolicyFields(policy: RegionPolicy, fields: Record<string, unknown>): RegionPolicy {
  const flag = (id: string, fallback: boolean) => (has(fields, id) ? fields[id] === true : fallback);
  const text = (id: string) => String(fields[id] || "") || null;
  return finalize({
    rows: policy.rows.map((r) => {
      const id = legacyRowId(r.code);
      return { ...r, allow: flag(`${id}_a`, r.allow), deny: flag(`${id}_d`, r.deny) };
    }),
    untaggedFlood: flag("policy-untagged-flood", policy.untaggedFlood),
    homeOverride: fields["policy-home-override"] === true ? text("policy-home-override-select") : null,
    defaultScope: text("policy-default-scope-select"),
  });
}

/** Region state read from a repeater: list allowed / denied, and the home and default names when read. */
export type DeviceRegionRead = { allowed: string[]; denied: string[]; home?: string; default?: string };

/**
 * The policy for a location from a device read (old applyReadRegionsToPolicy): rows for unknown
 * device codes, Allow/Deny from the lists, untagged flood from `*`, and a home or default scope that
 * differs from the automatic one kept as an override (home `*` = no home line, default `<null>` = none).
 * Unlike the old page, Allow/Deny is set on every row before re-gating, so a neighbour row the device
 * holds is kept when its home row is set too.
 */
export function policyFromDevice(anchor: Anchor, places: Place[], read: DeviceRegionRead): RegionPolicy {
  const allowed = new Set(read.allowed);
  const denied = new Set(read.denied);
  const home = read.home || "";
  // Trimmed; "" and "<null>" both mean no default scope.
  const def = read.default === undefined ? undefined : read.default.trim();
  const noDefault = !def || def.toLowerCase() === "<null>";
  const codes = [...allowed, ...denied];
  if (home) codes.push(home);
  if (def && !noDefault) codes.push(def);

  const base = policyFor(anchor, places, codes);
  const p = finalize({
    ...base,
    rows: base.rows.map((r) => ({ ...r, allow: allowed.has(r.code), deny: !allowed.has(r.code) && denied.has(r.code) })),
    untaggedFlood: allowed.has("*"),
  });

  let homeOverride: string | null = null;
  if (home && home !== deepestAllowedHomeRegionCode(p)) homeOverride = home === "*" ? HOME_OVERRIDE_OMIT : home;

  let defaultScope: string | null = null;
  if (def !== undefined) {
    const auto = recommendedDefaultScopeCode(p);
    if (noDefault) defaultScope = auto ? DEFAULT_SCOPE_NONE : null;
    else if (def !== auto) defaultScope = def;
  }
  return finalize({ ...p, homeOverride, defaultScope });
}

// ---------------------------------------------------------------------------
// region def

function sortCodesForCli(codes: Iterable<string>): string[] {
  const rest = new Set(codes);
  const out: string[] = [];
  for (const c of CLI_ORDER_FIRST) {
    if (rest.has(c)) {
      out.push(c);
      rest.delete(c);
    }
  }
  return out.concat(Array.from(rest).sort());
}

function starFirst(sorted: string[]): string[] {
  const idx = sorted.indexOf("*");
  if (idx <= 0) return sorted;
  return ["*", ...sorted.filter((c) => c !== "*")];
}

const withoutStar = (codes: string[]) => codes.filter((c) => c !== "*");

/** Free row code → its parent (null = top level). */
type FreeParents = Map<string, string | null>;

function freeParentsOf(policy: RegionPolicy): FreeParents {
  const m: FreeParents = new Map();
  for (const r of policy.rows) if (isFreeRow(r)) m.set(r.code, r.parent && r.parent !== "*" ? r.parent : null);
  return m;
}

/**
 * Add province/be ancestors for cities and be for provinces and gewesten. The home city and
 * home province get no automatic ancestors, so their def follows the home Allow rows only.
 * A free region adds its parent, which then gets its own ancestors by the same rules; a home
 * city or province reached that way does get its ancestors, so the free region is always defined.
 */
function expandRegionNeeded(
  needed: Set<string>,
  anchor: Anchor,
  cities: Map<string, Place>,
  freeParents: FreeParents,
): void {
  const add = (c: string) => {
    if (!c || needed.has(c)) return false;
    needed.add(c);
    return true;
  };
  // Codes a free region's parent chain passes through.
  const viaFree = new Set<string>();
  const mark = (c: string) => {
    if (!c || viaFree.has(c)) return false;
    viaFree.add(c);
    return true;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of Array.from(needed)) {
      if (freeParents.has(c)) {
        const parent = freeParents.get(c) || "";
        if (mark(parent)) changed = true;
        if (add(parent)) changed = true;
        continue;
      }
      const isHomeCity = !!(anchor.mode === "city" && anchor.place && c === anchor.place.city_code);
      const row = cities.get(c) ?? (isHomeCity ? anchor.place : undefined);
      if (row) {
        if (!isHomeCity || viaFree.has(c)) {
          if (isHomeCity && mark(row.province_code)) changed = true;
          if (add(row.province_code)) changed = true;
          if (add("be")) changed = true;
        }
      }
      if (isProvince(c)) {
        const isHomeProv =
          (anchor.mode === "city" && anchor.place && c === anchor.place.province_code) ||
          (anchor.mode === "province" && c === anchor.province_code);
        if ((!isHomeProv || viaFree.has(c)) && add("be")) changed = true;
      }
      if (isGewest(c) && add("be")) changed = true;
    }
  }
}

type Entry = { code: string; parent: string | null };

/**
 * Ordered { code, parent } entries (parent null = under *): the structured codes, then the free
 * regions (parents before children, otherwise alphabetical), then the rest under *.
 */
function buildOrderedRegionEntries(
  needed: Set<string>,
  homeCity: Place | null,
  cities: Map<string, Place>,
  freeParents: FreeParents,
): Entry[] {
  const entries: Entry[] = [];
  const structured = new Set<string>();
  const addEntry = (code: string, parent: string | null) => {
    if (!code || structured.has(code)) return;
    entries.push({ code, parent: parent || null });
    structured.add(code);
  };
  // A free region nests under its own parent, even when its code is a known place or province.
  const inTree = (c: string) => needed.has(c) && !freeParents.has(c);

  if (inTree("eu")) addEntry("eu", null);
  // Without eu the countries sit under *; with eu every country nests under it.
  for (const co of sortCodesForCli(["nl", "lu", "fr", "de", "gb", "be"].filter(inTree))) {
    addEntry(co, inTree("eu") ? "eu" : null);
  }
  for (const g of sortCodesForCli(Object.keys(GEWEST_NAMES).filter(inTree))) addEntry(g, "be");
  for (const p of sortCodesForCli(Object.keys(PROVINCE_NAMES).filter(inTree))) {
    const gewest = GEWEST_OF_PROVINCE[p];
    addEntry(p, gewest && inTree(gewest) ? gewest : "be");
  }

  const cityRows: { code: string; prov: string }[] = [];
  needed.forEach((c) => {
    if (structured.has(c) || freeParents.has(c)) return;
    let row = cities.get(c);
    if (!row && homeCity && c === homeCity.city_code) row = homeCity;
    if (row) cityRows.push({ code: c, prov: row.province_code });
  });
  cityRows.sort((a, b) => a.code.localeCompare(b.code));
  for (const pair of cityRows) addEntry(pair.code, pair.prov);

  // Parent first; a parent loop (only from an edited backup) is cut at top level.
  const visiting = new Set<string>();
  const addFree = (c: string) => {
    if (structured.has(c) || visiting.has(c)) return;
    visiting.add(c);
    let parent = freeParents.get(c) || null;
    if (parent && freeParents.has(parent) && needed.has(parent)) {
      if (visiting.has(parent) && !structured.has(parent)) parent = null;
      else addFree(parent);
    }
    addEntry(c, parent);
  };
  for (const c of Array.from(needed).filter((c) => freeParents.has(c)).sort()) addFree(c);

  const misc: string[] = [];
  needed.forEach((c) => {
    if (!structured.has(c)) misc.push(c);
  });
  misc.sort();
  for (const c of misc) addEntry(c, null);
  return entries;
}

/** MeshCore `region def` tokens for the tree; `name|jump` pops back to start another branch. */
function buildRegionDefTokens(entries: Entry[]): string[] {
  const childrenOf: Record<string, string[]> = Object.create(null);
  childrenOf["*"] = [];
  for (const e of entries) {
    const parent = e.parent || "*";
    if (!childrenOf[parent]) childrenOf[parent] = [];
    childrenOf[parent].push(e.code);
    if (!childrenOf[e.code]) childrenOf[e.code] = [];
  }

  const tokens: string[] = [];
  const emitUnder = (parentKey: string) => {
    const kids = childrenOf[parentKey] || [];
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      const moreSiblings = i < kids.length - 1;
      const grandkids = childrenOf[child] || [];
      if (grandkids.length > 0) {
        tokens.push(child);
        emitUnder(child);
        if (moreSiblings && tokens.length) tokens[tokens.length - 1] = `${tokens[tokens.length - 1]}|${parentKey}`;
      } else if (moreSiblings) {
        tokens.push(`${child}|${parentKey}`);
      } else {
        tokens.push(child);
      }
    }
  };
  emitUnder("*");
  return tokens;
}

/**
 * Pack tokens into `region def` lines of at most MAX_LINE_LEN. One line per root child of *
 * when possible; inside a long subtree, cut only after a `name|jump` token, drop that jump and
 * start the next line with the path reposition `a|a b|b …` (the cursor resets to * per command).
 */
function packRegionDefLines(tokens: string[], entries: Entry[]): string[] {
  const PREFIX = "region def ";
  if (!tokens.length) return [];
  const lineFor = (toks: string[]) => PREFIX + toks.join(" ");
  const tokenJump = (tok: string) => {
    const i = tok.indexOf("|");
    return i < 0 ? null : tok.slice(i + 1);
  };
  const lastJumpIndex = (arr: string[]) => {
    for (let j = arr.length - 1; j >= 0; j--) if (tokenJump(arr[j])) return j;
    return -1;
  };
  const isRootToken = (tok: string, root: string) => tok === root || tok.indexOf(`${root}|`) === 0;

  const parentOf: Record<string, string> = Object.create(null);
  for (const e of entries) parentOf[e.code] = e.parent || "*";

  /** Walk * → code via name|name so the def keeps existing parents. */
  const repositionTokens = (code: string) => {
    const chain: string[] = [];
    let cur: string | null = code;
    let guard = 0;
    while (cur && cur !== "*") {
      chain.unshift(cur);
      cur = parentOf[cur] || null;
      if (++guard > 32) break;
    }
    return chain.map((c) => `${c}|${c}`);
  };

  if (lineFor(tokens).length <= MAX_LINE_LEN) return [lineFor(tokens)];

  const rootChildren = entries.filter((e) => !e.parent).map((e) => e.code);

  const packChunk = (chunk: string[]): string[] => {
    if (!chunk.length) return [];
    if (lineFor(chunk).length <= MAX_LINE_LEN) return [lineFor(chunk)];
    const out: string[] = [];
    let buf: string[] = [];
    let resumeAt: string | null = null;
    const withResume = (toks: string[]) => (resumeAt ? repositionTokens(resumeAt).concat(toks) : toks);
    const flushAt = (splitIdx: number) => {
      const keep = buf.slice(0, splitIdx + 1);
      const rest = buf.slice(splitIdx + 1);
      const last = keep[keep.length - 1];
      const jump = tokenJump(last);
      if (jump) keep[keep.length - 1] = last.slice(0, last.indexOf("|"));
      out.push(lineFor(withResume(keep)));
      resumeAt = jump;
      buf = rest;
    };
    const flushWhileTooLong = () => {
      while (buf.length > 1 && lineFor(withResume(buf)).length > MAX_LINE_LEN) {
        const idx = lastJumpIndex(buf);
        if (idx < 0 || idx === buf.length - 1) break;
        flushAt(idx);
      }
    };
    for (const tok of chunk) {
      const trial = buf.concat([tok]);
      if (buf.length && lineFor(withResume(trial)).length > MAX_LINE_LEN) {
        const splitIdx = lastJumpIndex(buf);
        if (splitIdx >= 0) {
          flushAt(splitIdx);
          buf = buf.concat([tok]);
          flushWhileTooLong();
        } else {
          // Linear prefix with no jump yet: cannot cut mid-block.
          buf = trial;
        }
      } else {
        buf = trial;
      }
    }
    if (buf.length) out.push(lineFor(withResume(buf)));
    return out;
  };

  const lines: string[] = [];
  for (const root of rootChildren) {
    const start = tokens.findIndex((t) => isRootToken(t, root));
    if (start < 0) continue;
    let end = tokens.length;
    for (const other of rootChildren) {
      if (other === root) continue;
      const idx = tokens.findIndex((t) => isRootToken(t, other));
      if (idx > start && idx < end) end = idx;
    }
    let chunk = tokens.slice(start, end);
    // A trailing |* only linked sibling roots on one line: drop it per chunk.
    const last = chunk[chunk.length - 1];
    if (last && last.slice(-2) === "|*") chunk = chunk.slice(0, -1).concat([last.slice(0, -2)]);
    lines.push(...packChunk(chunk));
  }
  return lines.length ? lines : [lineFor(tokens)];
}

// ---------------------------------------------------------------------------
// Script lines

/**
 * Named regions on the device at the last read (or after the last Apply), with its home and default
 * scope, and each region's parent (null = under *) where the tree was read.
 */
export type DeviceRegions = {
  named: string[];
  home: string | null;
  default: string | null;
  parents?: Record<string, string | null>;
};

/** One line of the bare `region` tree: the region, its parent (null = under *) and whether it may flood. */
export type RegionTreeEntry = { name: string; parent: string | null; flood: boolean };

/**
 * The bare `region` reply: one line per region, indented one space per level under `*` (itself
 * `*^` when it is the home), the name then `^` for home and ` F` when flood is allowed. The firmware
 * cuts the reply at 159 bytes (see regionTreeCut), so a last line without its LF is dropped;
 * parents come before children, so every whole line is right. `wildcardFlood` is null when the
 * reply is not a tree.
 */
export function parseRegionTreeEntries(reply: string): { wildcardFlood: boolean | null; entries: RegionTreeEntry[] } {
  const entries: RegionTreeEntry[] = [];
  const lines = String(reply || "").split("\n");
  lines.pop(); // the text after the last LF: empty, or a line the cap cut off
  const root = /^\*\^?( F)?$/.exec(lines[0] ?? "");
  if (!root) return { wildcardFlood: null, entries };
  const path: string[] = [];
  for (const line of lines.slice(1)) {
    const depth = line.length - line.trimStart().length;
    const trimmed = line.trim();
    const flood = / F$/.test(trimmed);
    const name = trimmed.replace(/ F$/, "").replace(/\^$/, "");
    if (depth < 1 || depth > path.length + 1 || !name || /\s/.test(name)) break;
    path.length = depth - 1;
    entries.push({ name, parent: depth === 1 ? null : path[depth - 2], flood });
    path.push(name);
  }
  return { wildcardFlood: !!root[1], entries };
}

/** Each region's parent from the bare `region` reply (null = top level); see parseRegionTreeEntries. */
export function parseRegionTree(reply: string): Record<string, string | null> {
  return Object.fromEntries(parseRegionTreeEntries(reply).entries.map((e) => [e.name, e.parent]));
}

/** The firmware writes every CLI reply into a 160-byte buffer: at most 159 bytes come out. */
export const REPLY_MAX_BYTES = 159;
/** The longest region name the firmware keeps (RegionEntry name[31]). */
export const REGION_NAME_MAX = 30;

const replyBytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * The `region` tree was cut: it filled the buffer, or its last line has no LF. The firmware gives
 * no sign of it (RegionMap::exportTo through a BufStream that stops at 159 bytes).
 */
export function regionTreeCut(reply: string): boolean {
  return replyBytes(reply) >= REPLY_MAX_BYTES || !reply.endsWith("\n");
}

/**
 * `region list allowed|denied` may have left a name out: the firmware skips each name that no
 * longer fits its buffer and goes on with the next (RegionMap::exportNamesTo), without a sign. A
 * name of L bytes is skipped once the list holds 158 - L bytes, so a list shorter than
 * 157 - REGION_NAME_MAX bytes is whole.
 */
export function regionListMayBeCut(reply: string): boolean {
  return reply.trim() !== "-none-" && replyBytes(reply.trim()) >= 157 - REGION_NAME_MAX;
}

/** A `region get <name>` reply (" name (parent) F"; no parent at the top level, F when it may flood), or null for an error. */
export function parseRegionGet(reply: string): RegionTreeEntry | null {
  const m = /^\s*#?(\S+)(?:\s+\(#?(\S+)\))?\s*(F)?\s*$/.exec(String(reply || ""));
  if (!m || /^err/i.test(m[1]) || /^unknown/i.test(m[1])) return null;
  return { name: m[1], parent: m[2] ?? null, flood: m[3] === "F" };
}

/** Device region state from the read replies (old rememberDeviceRegionsFromRead). */
export function deviceRegionsFromRead(
  allowed: string[],
  denied: string[],
  home: string | null,
  defaultScope: string | null,
): DeviceRegions {
  const named = new Set<string>();
  for (const c of [...(allowed || []), ...(denied || [])]) {
    const code = String(c || "").trim();
    if (code && code !== "*") named.add(code);
  }
  const h = String(home || "").trim();
  if (h && h !== "*") named.add(h);
  const d = String(defaultScope || "").trim();
  if (d && d !== "*" && d.toLowerCase() !== "<null>") named.add(d);
  return { named: Array.from(named), home: h || null, default: !d || d.toLowerCase() === "<null>" ? null : d };
}

/** MeshCore removes children before parents: city → province → gewest → country → eu, then longer names. */
function regionHierarchyDepth(code: string, cities: Map<string, Place>): number {
  if (cities.has(code)) return 40;
  if (isProvince(code)) return 30;
  if (isGewest(code)) return 25;
  if (code === "be" || code === "nl" || code === "lu" || code === "fr" || code === "de" || code === "gb") return 20;
  if (code === "eu") return 5;
  return 22 + Math.min(String(code).length, 20);
}

/**
 * Removal order: by regionHierarchyDepth, except that a child goes before the parent it sits under
 * when both are removed. The parent comes from the tree read from the device, else from the plan's
 * free row; for a code neither knows, the depth heuristic stands.
 */
function orderRegionRemovesDeepestFirst(
  codes: string[],
  cities: Map<string, Place>,
  freeParents: FreeParents,
  deviceParents: Record<string, string | null> = {},
): string[] {
  const sorted = codes.slice().sort((a, b) => {
    const d = regionHierarchyDepth(b, cities) - regionHierarchyDepth(a, cities);
    if (d !== 0) return d;
    if (b.length !== a.length) return b.length - a.length;
    return a.localeCompare(b);
  });
  const removing = new Set(codes);
  const children = new Map<string, string[]>();
  for (const c of sorted) {
    const parent = Object.prototype.hasOwnProperty.call(deviceParents, c) ? deviceParents[c] : freeParents.get(c);
    if (parent && parent !== c && removing.has(parent)) children.set(parent, [...(children.get(parent) ?? []), c]);
  }
  const out: string[] = [];
  const done = new Set<string>();
  const emit = (c: string) => {
    if (done.has(c)) return;
    done.add(c);
    for (const child of children.get(c) ?? []) emit(child);
    out.push(c);
  };
  for (const c of sorted) emit(c);
  return out;
}

/** The removed codes that, in the device tree, have a kept code somewhere below them. */
function keptAncestors(parents: Record<string, string | null>, kept: Set<string>, removing: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const code of Object.keys(parents)) {
    if (!kept.has(code)) continue;
    const seen = new Set([code]);
    for (let p = parents[code]; p && !seen.has(p); p = parents[p] ?? null) {
      seen.add(p);
      if (removing.has(p)) out.add(p);
    }
  }
  return out;
}

/** Allow/Deny codes plus the ancestors they need (no default scope). */
function policyNeeded(anchor: Anchor, policy: RegionPolicy, cities: Map<string, Place>): Set<string> {
  const { allowed, denied } = regionsByState(policy);
  const needed = new Set([...withoutStar(allowed), ...withoutStar(denied)]);
  expandRegionNeeded(needed, anchor, cities, freeParentsOf(policy));
  return needed;
}

/** The codes the script defines: policyNeeded plus the default scope and its ancestors. */
function scriptNeeded(anchor: Anchor, policy: RegionPolicy, cities: Map<string, Place>): Set<string> {
  const needed = policyNeeded(anchor, policy, cities);
  const defCode = defaultLineCode(policy);
  if (defCode.toLowerCase() !== "<null>") {
    needed.add(defCode);
    expandRegionNeeded(needed, anchor, cities, freeParentsOf(policy));
  }
  return needed;
}

/**
 * The named regions the device holds after Apply: the script removes every other one, so this is
 * the defined tree (`*` not counted). Compare with MAX_REGIONS.
 */
export function regionCountAfterApply(anchor: Anchor, policy: RegionPolicy, places: Place[]): number {
  return withoutStar(Array.from(scriptNeeded(anchor, policy, cityIndex(places)))).length;
}

/** What the device holds after this policy was applied (old syncDeviceRegionSnapshotFromForm). */
export function regionsAfterApply(anchor: Anchor, policy: RegionPolicy, places: Place[]): DeviceRegions {
  const named = Array.from(policyNeeded(anchor, policy, cityIndex(places)));
  const home = homeLineCode(policy);
  const def = defaultLineCode(policy);
  return { named, home: home || "*", default: def.toLowerCase() === "<null>" ? null : def };
}

/**
 * The regions the region script leaves on a repeater: the defined codes (`*` not counted), which
 * of them plus `*` allow or deny flood, home (null: the script leaves it alone; `*` = none), default
 * scope (null = none), each code's parent (null = under *) and the own (free) regions among them.
 */
export type ExpectedRegions = {
  named: string[];
  allowed: string[];
  denied: string[];
  home: string | null;
  default: string | null;
  parents: Record<string, string | null>;
  free: string[];
};

/** What the region script for this policy leaves on the repeater; `region def` allows flood on each named region. */
export function expectedRegions(anchor: Anchor, policy: RegionPolicy, places: Place[]): ExpectedRegions {
  const cities = cityIndex(places);
  const needed = scriptNeeded(anchor, policy, cities);
  const named = withoutStar(Array.from(needed));
  const denied = withoutStar(regionsByState(policy).denied);
  if (!policy.untaggedFlood) denied.push("*");
  const allowed = named.filter((c) => !denied.includes(c));
  if (policy.untaggedFlood) allowed.push("*");
  const homeCity = anchor.mode === "city" && anchor.place ? anchor.place : null;
  const freeParents = freeParentsOf(policy);
  const parents: Record<string, string | null> = {};
  for (const e of buildOrderedRegionEntries(needed, homeCity, cities, freeParents)) parents[e.code] = e.parent;
  const def = defaultLineCode(policy);
  const defaultScope = def.toLowerCase() === "<null>" ? null : def;
  const free = [...freeParents.keys()].filter((c) => named.includes(c));
  return { named, allowed, denied, home: homeLineCode(policy), default: defaultScope, parents, free };
}

/**
 * Whether a repeater's regions (its read and the device state from it) already equal what the
 * script leaves. Codes compare as sets; home only when the script sets it; parents for the codes
 * in the tree read from the device, and an own region must be in that tree (its parent is the user's).
 */
export function regionsMatch(
  expected: ExpectedRegions,
  read: NonNullable<DeviceSnapshot["regions"]>,
  device: DeviceRegions,
): boolean {
  const sameSet = (a: string[], b: string[]) => {
    const sa = new Set(a.map((c) => c.trim()).filter(Boolean));
    const sb = new Set(b.map((c) => c.trim()).filter(Boolean));
    return sa.size === sb.size && [...sa].every((c) => sb.has(c));
  };
  if (!sameSet(expected.named, device.named)) return false;
  if (!sameSet(expected.allowed, read.allowed) || !sameSet(expected.denied, read.denied)) return false;
  if (expected.home !== null && (device.home || "*") !== expected.home) return false;
  if (device.default !== expected.default) return false;
  if (expected.free.some((c) => !has(device.parents ?? {}, c))) return false;
  for (const [code, parent] of Object.entries(device.parents ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(expected.parents, code) || expected.parents[code] !== parent) return false;
  }
  return true;
}

/**
 * The region part of the script (firmware 1.16+): removals of device regions no longer
 * selected, region def lines, allowf/denyf, home, default and save. Empty without an anchor.
 */
export function regionCommandLines(
  anchor: Anchor | null,
  policy: RegionPolicy,
  places: Place[],
  device?: DeviceRegions,
): string[] {
  if (!anchor) return [];
  const cities = cityIndex(places);
  const { denied } = regionsByState(policy);

  const denyForCli = withoutStar(denied);
  if (!policy.untaggedFlood) denyForCli.push("*");
  const denySorted = starFirst(sortCodesForCli(denyForCli));

  const needed = scriptNeeded(anchor, policy, cities);
  const defCode = defaultLineCode(policy);

  const lines: string[] = [];
  // Drop named regions that were on the device but are no longer selected nor needed as ancestors.
  // Clear default and home first when they point at a removed region; children go before parents.
  // A region a kept one still sits under on the device goes after the def lines, which move it away.
  const removeAfterDef: string[] = [];
  if (device) {
    const toRemove = device.named.filter((c) => c && c !== "*" && c.toLowerCase() !== "<null>" && !needed.has(c));
    const holdsKept = keptAncestors(device.parents ?? {}, needed, new Set(toRemove));
    if (device.default && toRemove.includes(device.default)) lines.push("region default <null>");
    if (device.home && device.home !== "*" && toRemove.includes(device.home)) lines.push("region home *");
    for (const c of orderRegionRemovesDeepestFirst(toRemove, cities, freeParentsOf(policy), device.parents)) {
      (holdsKept.has(c) ? removeAfterDef : lines).push(`region remove ${c}`);
    }
  }

  const homeCity = anchor.mode === "city" && anchor.place ? anchor.place : null;
  const entries = buildOrderedRegionEntries(needed, homeCity, cities, freeParentsOf(policy));
  lines.push(...packRegionDefLines(buildRegionDefTokens(entries), entries));
  lines.push(...removeAfterDef);

  // region def leaves named regions flood-allowed; * still needs allowf, and deny rows need denyf.
  if (policy.untaggedFlood) lines.push("region allowf *");
  for (const r of denySorted) lines.push(`region denyf ${r}`);
  const home = homeLineCode(policy);
  if (home) lines.push(`region home ${home}`);
  lines.push(`region default ${defCode}`);
  lines.push("region save");
  return lines;
}
