/**
 * Region scope policy (which rows exist for a location, their Allow/Deny state, bulk actions)
 * and the `region …` CLI lines it produces. Port of the old page's policy grid and
 * buildRegionCommandLines (src/configurator.js), with the checkbox DOM replaced by RegionPolicy.
 */
import { GEWEST_NAMES, GEWEST_OF_PROVINCE, PROVINCE_ADJACENCY, PROVINCE_NAMES } from "./be-regions";
import { findGeographicNeighbors, neighborsInRadius } from "./geo";
import type { Place } from "./search";

export type Anchor = { mode: "city" | "province" | "country"; province_code: string | null; place: Place | null };

/**
 * One Allow/Deny row. Home rows (`home: true`) are grouped by level: `country` (be), `province`
 * (the optional gewest and the province) and `municipality`. Other groups: `neighbour`
 * (neighbouring municipalities, provinces and countries), `country` (the wider `eu` row) and
 * `device` (codes read from the repeater that no other row lists).
 */
export type RegionRow = {
  code: string;
  labelKey: string;
  label: string;
  group: "country" | "province" | "municipality" | "neighbour" | "device";
  allow: boolean;
  deny: boolean;
  home?: boolean;
  /**
   * Neighbour gating: a neighbour tier is locked (and kept clear) until its home row
   * (municipality, province or be) has Allow or Deny.
   */
  disabled?: { allow?: boolean; deny?: boolean };
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
  nl: "Netherlands",
  lu: "Luxembourg",
  fr: "France",
  de: "Germany",
  be: "Belgium",
};
const NEIGHBOR_COUNTRY_CODES = ["nl", "lu", "fr", "de"];
const CLI_ORDER_FIRST = ["eu", "nl", "lu", "fr", "de", "be", "be-vlg", "be-wal"];
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
  if (code === "*") return "wildcard root";
  if (code === "eu") return "European Union";
  if (isProvince(code)) return PROVINCE_NAMES[code];
  if (isGewest(code)) return GEWEST_NAMES[code];
  if (has(COUNTRY_NAMES, code)) return COUNTRY_NAMES[code];
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

function homeProvinceOf(anchor: Anchor): string | null {
  if (anchor.mode === "province") return anchor.province_code;
  return anchor.place ? anchor.place.province_code : null;
}

function homeRows(anchor: Anchor): RegionRow[] {
  const rows = [row("be", named("Belgium", "be"), "country", "region.kind.country", { home: true, allow: true })];
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
        `${place.plaats} (~${Math.round(km)} km) (${place.city_code})`,
        "neighbour",
        "region.kind.neighbourMunicipality",
      ),
    ),
    ...neighborProvinces(neighborsRadius, homeProvinceOf(anchor)).map((pc) =>
      row(pc, named(PROVINCE_NAMES[pc] || pc, pc), "neighbour", "region.kind.neighbourProvince"),
    ),
    ...NEIGHBOR_COUNTRY_CODES.map((c) =>
      row(c, named(COUNTRY_NAMES[c], c), "neighbour", "region.kind.neighbourCountry"),
    ),
    row("eu", named("European Union", "eu"), "country", "region.kind.wider"),
  ];
  rows.push(...deviceRows(deviceCodes, rows, places));
  return finalize({ rows, untaggedFlood: true, homeOverride: null, defaultScope: null });
}

// ---------------------------------------------------------------------------
// Gating and edits

type Tier = "municipality" | "province" | "country";

function neighbourTier(code: string): Tier {
  if (isProvince(code)) return "province";
  if (NEIGHBOR_COUNTRY_CODES.includes(code)) return "country";
  return "municipality";
}

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
    if (r.group !== "neighbour") return r;
    const rest = { ...r };
    delete rest.disabled;
    return open[neighbourTier(r.code)]
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

/** Old finalizePolicyUiChange: re-gate, then refresh the home override. */
function finalize(p: RegionPolicy): RegionPolicy {
  const gated = { ...p, rows: gate(p.rows) };
  return { ...gated, homeOverride: effectiveHomeOverride(gated) };
}

/** Set one row to Allow, Deny or neither (they exclude each other). Locked or unknown rows are ignored. */
export function setRowState(policy: RegionPolicy, code: string, state: "allow" | "deny" | "none"): RegionPolicy {
  const target = policy.rows.find((r) => r.code === code);
  if (!target || locked(target)) return policy;
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

/** #BEmesh automatic default scope: be when allowed, else the deepest home Allow; null when none. */
function recommendedDefaultScopeCode(p: RegionPolicy): string | null {
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

/**
 * Add province/be ancestors for cities and be for provinces and gewesten. The home city and
 * home province get no automatic ancestors, so their def follows the home Allow rows only.
 */
function expandRegionNeeded(needed: Set<string>, anchor: Anchor, cities: Map<string, Place>): void {
  const add = (c: string) => {
    if (!c || needed.has(c)) return false;
    needed.add(c);
    return true;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of Array.from(needed)) {
      const row = cities.get(c);
      if (row) {
        const isHomeCity = anchor.mode === "city" && anchor.place && c === anchor.place.city_code;
        if (!isHomeCity) {
          if (add(row.province_code)) changed = true;
          if (add("be")) changed = true;
        }
      }
      if (isProvince(c)) {
        const isHomeProv =
          (anchor.mode === "city" && anchor.place && c === anchor.place.province_code) ||
          (anchor.mode === "province" && c === anchor.province_code);
        if (!isHomeProv && add("be")) changed = true;
      }
      if (isGewest(c) && add("be")) changed = true;
    }
  }
}

type Entry = { code: string; parent: string | null };

/** Ordered { code, parent } entries (parent null = under *). */
function buildOrderedRegionEntries(needed: Set<string>, homeCity: Place | null, cities: Map<string, Place>): Entry[] {
  const entries: Entry[] = [];
  const structured = new Set<string>();
  const addEntry = (code: string, parent: string | null) => {
    if (!code || structured.has(code)) return;
    entries.push({ code, parent: parent || null });
    structured.add(code);
  };

  if (needed.has("eu")) addEntry("eu", null);
  // Without eu the countries sit under *; with eu every country nests under it.
  for (const co of sortCodesForCli(["nl", "lu", "fr", "de", "be"].filter((c) => needed.has(c)))) {
    addEntry(co, needed.has("eu") ? "eu" : null);
  }
  for (const g of sortCodesForCli(Object.keys(GEWEST_NAMES).filter((c) => needed.has(c)))) addEntry(g, "be");
  for (const p of sortCodesForCli(Object.keys(PROVINCE_NAMES).filter((c) => needed.has(c)))) {
    const gewest = GEWEST_OF_PROVINCE[p];
    addEntry(p, gewest && needed.has(gewest) ? gewest : "be");
  }

  const cityRows: { code: string; prov: string }[] = [];
  needed.forEach((c) => {
    if (structured.has(c)) return;
    let row = cities.get(c);
    if (!row && homeCity && c === homeCity.city_code) row = homeCity;
    if (row) cityRows.push({ code: c, prov: row.province_code });
  });
  cityRows.sort((a, b) => a.code.localeCompare(b.code));
  for (const pair of cityRows) addEntry(pair.code, pair.prov);

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

/** Named regions on the device at the last read (or after the last Apply), with its home and default scope. */
export type DeviceRegions = { named: string[]; home: string | null; default: string | null };

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
  if (code === "be" || code === "nl" || code === "lu" || code === "fr" || code === "de") return 20;
  if (code === "eu") return 5;
  return 22 + Math.min(String(code).length, 20);
}

function orderRegionRemovesDeepestFirst(codes: string[], cities: Map<string, Place>): string[] {
  return codes.slice().sort((a, b) => {
    const d = regionHierarchyDepth(b, cities) - regionHierarchyDepth(a, cities);
    if (d !== 0) return d;
    if (b.length !== a.length) return b.length - a.length;
    return a.localeCompare(b);
  });
}

/** Allow/Deny codes plus the ancestors they need (no default scope). */
function policyNeeded(anchor: Anchor, policy: RegionPolicy, cities: Map<string, Place>): Set<string> {
  const { allowed, denied } = regionsByState(policy);
  const needed = new Set([...withoutStar(allowed), ...withoutStar(denied)]);
  expandRegionNeeded(needed, anchor, cities);
  return needed;
}

/** What the device holds after this policy was applied (old syncDeviceRegionSnapshotFromForm). */
export function regionsAfterApply(anchor: Anchor, policy: RegionPolicy, places: Place[]): DeviceRegions {
  const named = Array.from(policyNeeded(anchor, policy, cityIndex(places)));
  const home = homeLineCode(policy);
  const def = defaultLineCode(policy);
  return { named, home: home || "*", default: def.toLowerCase() === "<null>" ? null : def };
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

  const needed = policyNeeded(anchor, policy, cities);
  const defCode = defaultLineCode(policy);
  if (defCode.toLowerCase() !== "<null>") {
    needed.add(defCode);
    expandRegionNeeded(needed, anchor, cities);
  }

  const lines: string[] = [];
  // Drop named regions that were on the device but are no longer selected nor needed as ancestors.
  // Clear default and home first when they point at a removed region; children go before parents.
  if (device) {
    const toRemove = device.named.filter((c) => c && c !== "*" && c.toLowerCase() !== "<null>" && !needed.has(c));
    if (device.default && toRemove.includes(device.default)) lines.push("region default <null>");
    if (device.home && device.home !== "*" && toRemove.includes(device.home)) lines.push("region home *");
    for (const c of orderRegionRemovesDeepestFirst(toRemove, cities)) lines.push(`region remove ${c}`);
  }

  const homeCity = anchor.mode === "city" && anchor.place ? anchor.place : null;
  const entries = buildOrderedRegionEntries(needed, homeCity, cities);
  lines.push(...packRegionDefLines(buildRegionDefTokens(entries), entries));

  // region def leaves named regions flood-allowed; * still needs allowf, and deny rows need denyf.
  if (policy.untaggedFlood) lines.push("region allowf *");
  for (const r of denySorted) lines.push(`region denyf ${r}`);
  const home = homeLineCode(policy);
  if (home) lines.push(`region home ${home}`);
  lines.push(`region default ${defCode}`);
  lines.push("region save");
  return lines;
}
