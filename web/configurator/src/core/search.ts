/** Location search ranking for be-locode rows. */

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
