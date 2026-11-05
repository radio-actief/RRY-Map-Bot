/** Location search ranking for be-locode rows, and the location choices offered for a query. */
import { PROVINCE_NAMES } from "./be-regions";
import { I18N, municipalityName, regionName, t } from "../i18n/t";

export type Place = {
  nis5: string;
  plaats: string;
  gemeente: string;
  province_code: string;
  city_code: string;
  search_aliases?: string[];
  lat: number;
  lon: number;
};

export function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Rank of a row for a normalized query, or -1 when it does not match.
 * 0 exact name/code · 1 name starts with · 2 name/code contains · 3 old name (alias)
 */
function placeRank(c: Place, q: string): number {
  const fields = [normalize(c.plaats), normalize(c.gemeente), normalize(c.city_code)];
  if (fields.includes(q)) return 0;
  if (fields[0].startsWith(q) || fields[1].startsWith(q)) return 1;
  if (fields.some((f) => f.includes(q))) return 2;
  const aliases = Array.isArray(c.search_aliases) ? c.search_aliases : [];
  if (aliases.some((a) => normalize(a).includes(q))) return 3;
  return -1;
}

/** Matching rows, best match first; data order is kept within a rank. */
export function rankPlaces(places: Place[], query: string): Place[] {
  const q = normalize(query);
  if (!q) return [];
  const ranked: { rank: number; row: Place }[] = [];
  for (const row of places) {
    const rank = placeRank(row, q);
    if (rank !== -1) ranked.push({ rank, row });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((r) => r.row);
}

/** A location the search offers: Belgium, a province or a place. The label is name + code. */
export type LocationChoice = (
  | { type: "country" }
  | { type: "province"; code: string }
  | { type: "city"; place: Place }
) & { label: string };

const COUNTRY_WORDS = ["belgium", "belgie", "belgië", "belgique"];

/** A province's names in every language whose messages are loaded, so a search in any of them finds it. */
function otherNames(code: string): string[] {
  return I18N.LANGS.map((l) => I18N.textIn(l, `province.${code}`)).filter((n): n is string => !!n);
}

const MAX_CHOICES = 16;

/**
 * Choices for a search text in the old dropdown order (filterLocationChoices): the country
 * first, then provinces whose code or name contains the query, then ranked places.
 */
export function locationChoices(query: string, places: Place[]): LocationChoice[] {
  if (!query || query.length < 2) return [];
  const q = normalize(query);
  const out: LocationChoice[] = [];
  if (q === "be" || COUNTRY_WORDS.some((w) => normalize(w).includes(q))) {
    out.push({ type: "country", label: `${t("region.name.be")} (be)` });
  }
  for (const [code, defaultName] of Object.entries(PROVINCE_NAMES)) {
    if (out.length >= MAX_CHOICES) break;
    const name = regionName(code);
    if (normalize(code).includes(q) || [name, defaultName, ...otherNames(code)].some((n) => normalize(n).includes(q))) {
      out.push({ type: "province", code, label: `${name} (${code})` });
    }
  }
  const seen = new Set<string>();
  for (const place of rankPlaces(places, query)) {
    if (out.length >= MAX_CHOICES) break;
    if (seen.has(place.city_code)) continue;
    seen.add(place.city_code);
    out.push({ type: "city", place, label: `${municipalityName(place.plaats)} (${place.city_code})` });
  }
  return out;
}
