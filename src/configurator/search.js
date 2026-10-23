/**
 * Location search ranking for be-locode rows.
 */
(function (App) {
  "use strict";

  function normalize(s) {
    return (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  }

  /**
   * Rank of a row for a normalized query, or -1 when it does not match.
   * 0 exact name/code · 1 name starts with · 2 name/code contains · 3 old name (alias)
   */
  function placeRank(c, q) {
    const fields = [normalize(c.plaats), normalize(c.gemeente), normalize(c.city_code)];
    if (fields.indexOf(q) !== -1) return 0;
    if (fields[0].startsWith(q) || fields[1].startsWith(q)) return 1;
    if (fields.some(function (f) { return f.includes(q); })) return 2;
    const aliases = Array.isArray(c.search_aliases) ? c.search_aliases : [];
    for (let i = 0; i < aliases.length; i++) {
      if (normalize(aliases[i]).includes(q)) return 3;
    }
    return -1;
  }

  /** Matching rows, best match first; data order is kept within a rank. */
  function rankPlaces(cities, query) {
    const q = normalize(query);
    if (!q) return [];
    const ranked = [];
    for (let i = 0; i < cities.length; i++) {
      const rank = placeRank(cities[i], q);
      if (rank !== -1) ranked.push({ rank: rank, row: cities[i] });
    }
    ranked.sort(function (a, b) { return a.rank - b.rank; });
    return ranked.map(function (r) { return r.row; });
  }

  App.search = { normalize: normalize, rankPlaces: rankPlaces };
})(window.ConfiguratorApp);
