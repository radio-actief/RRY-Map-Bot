// The map page's base maps: which there are, what each needs, and the visitor's choice (localStorage
// "baseMapSelected", the key the Leaflet map used: its names still read).
//
// Terms, as each service states them:
// - OpenFreeMap (default): free, no key, no limits; attribution required (the style carries it).
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

/** id -> { label, vector?: (dark) => style URL, raster?: { tiles, maxzoom } } */
export const BASE_MAPS = {
  openfreemap: {
    label: "OpenFreeMap",
    vector: (dark) => `https://tiles.openfreemap.org/styles/${dark ? "dark" : "liberty"}`,
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

/** The base maps an engine can show: all four with WebGL, the raster ones without. */
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
