// The map page's base maps: which there are, what each needs, and the visitor's choice (localStorage
// "baseMapSelected", the key the Leaflet map used: its names still read).
//
// Terms, as each service states them:
// - OpenFreeMap (default: Positron, grey; dark: its dark style tuned to the site's ink; Streets:
//   Liberty): free, no key, no limits; attribution required (the style carries it).
// - VersaTiles (tiles.versatiles.org): free and open to everyone, without guarantees, rate-limited per
//   address; attribution required (the style carries it).
// - OpenStreetMap's own tiles: the tile usage policy allows light use with attribution, not heavy
//   use: an option, never the default.
// - Esri World Imagery: already used by the Leaflet map; Esri's attribution as before.
// Vector styles need WebGL: the Leaflet map (no WebGL) offers the two raster maps.

export const BASE_MAP_KEY = "baseMapSelected";
export const DEFAULT_BASE_MAP = "openfreemap";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ESRI_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/** id -> { label | labelKey, vector?: (dark) => style URL, raster?: { tiles, maxzoom } } */
export const BASE_MAPS = {
  openfreemap: {
    label: "OpenFreeMap",
    vector: (dark) => `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`,
  },
  // OpenFreeMap's colourful street map, in either shade
  streets: {
    labelKey: "map.base.streets",
    vector: () => "https://tiles.openfreemap.org/styles/liberty",
  },
  versatiles: {
    label: "VersaTiles",
    vector: (dark) => `https://tiles.versatiles.org/assets/styles/${dark ? "colorful-dark" : "colorful"}/style.json`,
  },
  osm: { label: "OpenStreetMap", raster: { tiles: OSM_TILES, maxzoom: 19 } },
  satellite: { label: "Esri Satellite", raster: { tiles: ESRI_TILES, maxzoom: 18 } },
};

// names the Leaflet map stored
const LEGACY = { OpenStreetMap: "openfreemap", "Esri Satellite": "satellite" };

/** The name of a base map in the page language. */
export function baseMapLabel(id, t) {
  const map = BASE_MAPS[id];
  return map.labelKey ? t(map.labelKey) : map.label;
}

/** The base maps an engine can show: all of them with WebGL, the raster ones without. */
export function baseMapIds({ vector }) {
  return Object.keys(BASE_MAPS).filter((id) => vector || BASE_MAPS[id].raster);
}

/** The stored choice for an engine; a vector map on the Leaflet map is OpenStreetMap's raster map. */
export function readBaseMap(storage, { vector }) {
  let stored = null;
  try {
    stored = storage?.getItem(BASE_MAP_KEY) ?? null;
  } catch {
    stored = null;
  }
  let id = Object.prototype.hasOwnProperty.call(BASE_MAPS, stored) ? stored : LEGACY[stored] ?? DEFAULT_BASE_MAP;
  if (!vector && !BASE_MAPS[id].raster) id = "osm";
  return id;
}

export function storeBaseMap(storage, id) {
  try {
    storage?.setItem(BASE_MAP_KEY, id);
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
}

/** The credit line of a raster map, as the Leaflet map wrote it. */
export function rasterAttribution(id, t) {
  if (id === "satellite") {
    return `${t("map.tiles")}: &copy; Esri | ${t("map.sources")}: Esri, DigitalGlobe, GeoEye, i-cubed, USDA FSA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, GIS Users`;
  }
  return `${t("map.tiles")}: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>`;
}

// OpenStreetMap's raster tiles in the dark shade: the Leaflet map's CSS filter (invert, hue-rotate,
// brightness 0.95, contrast 0.9, saturate 0.7) as MapLibre raster paint
const DARK_RASTER_PAINT = {
  "raster-brightness-min": 0.95,
  "raster-brightness-max": 0,
  "raster-hue-rotate": 180,
  "raster-contrast": -0.1,
  "raster-saturation": -0.3,
};

/** A MapLibre style for a raster map; OpenStreetMap's tiles follow the shade, the satellite never. */
export function rasterStyle(id, { dark, t }) {
  const { tiles, maxzoom } = BASE_MAPS[id].raster;
  return {
    version: 8,
    sources: {
      base: { type: "raster", tiles: [tiles], tileSize: 256, maxzoom, attribution: rasterAttribution(id, t) },
    },
    layers: [
      { id: "base-background", type: "background", paint: { "background-color": dark && id === "osm" ? "#1d1d1f" : "#e8e4dc" } },
      { id: "base", type: "raster", source: "base", paint: dark && id === "osm" ? { ...DARK_RASTER_PAINT } : {} },
    ],
  };
}

/** The style of a base map for MapLibre: a URL of a vector style, or a raster style. */
export function styleFor(id, { dark, t }) {
  const map = BASE_MAPS[id] ?? BASE_MAPS[DEFAULT_BASE_MAP];
  return map.vector ? map.vector(dark) : rasterStyle(id, { dark, t });
}

// ------------------------------------------------------------------ vector styles, made ours
// One label family: Noto Sans Regular for places and roads, Noto Sans Italic for water (each host
// names its glyphs its own way).
const FONTS = {
  "tiles.openfreemap.org": { regular: ["Noto Sans Regular"], italic: ["Noto Sans Italic"] },
  "tiles.versatiles.org": { regular: ["noto_sans_regular"], italic: ["noto_sans_regular_italic"] },
};

const isWaterLabel = (layer) => /water/.test(layer["source-layer"] || "") || /water/.test(layer.id);

/** Every label of a style in one family (regular, italic for water), from the style's glyph host. */
export function normalizeFonts(style) {
  let host = "";
  try {
    host = new URL(String(style.glyphs).replace(/[{}]/g, "")).host;
  } catch {
    return style;
  }
  const fonts = FONTS[host];
  if (!fonts) return style;
  for (const layer of style.layers) {
    if (layer.type !== "symbol" || !layer.layout?.["text-font"]) continue;
    layer.layout["text-font"] = isWaterLabel(layer) ? fonts.italic : fonts.regular;
  }
  return style;
}

/** OpenFreeMap's dark style in the site's ink (src/shared/bemesh-tokens.css: --code-bg, --panel …). */
export const DARK_INK = {
  land: "#12161F",
  water: "#1A202C",
  road: "#2D3748",
  motorway: "#4A5568",
  border: "#4A5568",
  label: "#A0AEC0",
  minorLabel: "#718096",
  halo: "#12161F",
};

// place labels a phone must read: bigger than the style's 10 px
const PLACE_SIZES = {
  place_city_large: ["interpolate", ["linear"], ["zoom"], 4, 13, 10, 18],
  place_city: ["interpolate", ["linear"], ["zoom"], 5, 12, 10, 16],
  place_town: ["interpolate", ["linear"], ["zoom"], 7, 12, 12, 15],
  place_village: ["interpolate", ["linear"], ["zoom"], 9, 11, 14, 13],
};
const MAJOR_PLACES = /^place_(city|city_large|town|state|country)/;

/** OpenFreeMap's dark style, recoloured in place to the site's ink (other styles are left alone). */
export function tuneDark(style, ink = DARK_INK) {
  for (const layer of style.layers) {
    const id = layer.id;
    const paint = (layer.paint ??= {});
    if (layer.type === "background") paint["background-color"] = ink.land;
    else if (layer.type === "fill") {
      paint["fill-color"] = id === "water" ? ink.water : ink.land;
      delete paint["fill-pattern"]; // (a pattern would hide the colour)
      if ("fill-outline-color" in paint) paint["fill-outline-color"] = ink.water;
      if (/^aeroway/.test(id)) paint["fill-color"] = ink.road;
    } else if (layer.type === "line") {
      if (/dashline|pier/.test(id)) paint["line-color"] = ink.land;
      else if (/^waterway/.test(id)) paint["line-color"] = ink.water;
      else if (/^boundary/.test(id)) paint["line-color"] = ink.border;
      else if (/motorway/.test(id)) paint["line-color"] = ink.motorway;
      else paint["line-color"] = ink.road;
    } else if (layer.type === "symbol" && layer.layout?.["text-field"] !== undefined) {
      const major = MAJOR_PLACES.test(id);
      paint["text-color"] = major ? ink.label : ink.minorLabel;
      paint["text-halo-color"] = ink.halo;
      paint["text-halo-width"] = major ? 1.5 : 1;
      paint["text-halo-blur"] = 0;
      if (PLACE_SIZES[id]) layer.layout["text-size"] = PLACE_SIZES[id];
    }
  }
  return style;
}

/** A fetched vector style, made ours: one label family, and the dark OpenFreeMap in our ink. */
export function prepareStyle(id, style, { dark }) {
  normalizeFonts(style);
  if (id === "openfreemap" && dark) tuneDark(style);
  return style;
}
