// The map page's map engine: MapLibre GL JS where the browser has WebGL 2, else the Leaflet map,
// loaded only for those browsers (and when MapLibre fails to start), so nobody gets a blank map.
// Both implement the same small interface, so src/map.js and the coverage tools have one code path.
//
// The interface (zoom counts as the page and its URL do, on 256 px tiles; spots are {lat, lon}):
//   kind                                   "maplibre" | "leaflet"
//   container                              the map's element
//   getCenter() getZoom() getSize()        the view ({lat, lon}, zoom, {x, y} in px)
//   setView(spot, zoom) flyTo(spot, zoom)  move (flyTo resolves when it has arrived)
//   fitBounds([[s, w], [n, e]], { top, bottom, left, right, maxZoom })
//   project(spot) unproject({x, y})        container pixels
//   resize()                               after the container changed size
//   on(type, fn) off(type, fn)             "movestart" "moveend" "zoomend" and "contextmenu"
//                                          ({lat, lon, clientX, clientY, touch, originalEvent}:
//                                          right click, or a long press on a touch screen)
//   setNodes(nodes, { clusterUntil })      the node markers, clustered below that zoom (0: never)
//   refreshNodes()                         redraw them (claimed / own nodes changed)
//   onNodeClick(fn)                        fn(node)
//   openPopup(spot, { html, className, onContent(root), onClose() }), closePopup(), setPopupHtml(html),
//   popupElement(), isPopupOpen()          one popup at a time; it stays clear of the search box
//   addImage(url, corners)                 an image over the map ([[lon, lat] x4], NW NE SE SW)
//   addPath(spots, style)                  a line; style as Leaflet's path options (className, weight,
//   addCircle(spot, meters, style)         dashArray, lineCap): the colour comes from the CSS class
//   addDot(spot, style)                    a small circle of `radius` px
//   addMarker(spot, { html, className, size, anchor, draggable, title, interactive })
//                                          an HTML mark over the nodes: { element, getLatLng(),
//                                          setLatLng(spot), setIcon({ html, className }),
//                                          setDraggable(on), on("drag" | "dragend", fn), remove() }
//   Each add* returns a handle with remove(); paths sit under the node markers, marks above them.

/** True when the browser can make a WebGL 2 context (MapLibre needs one). */
export function webglAvailable(doc = globalThis.document) {
  try {
    const canvas = doc.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return false;
    gl.getExtension?.("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** The answer for this page, asked once (each try makes a context). */
let webglOnce = null;
const webglForPage = () => (webglOnce ??= webglAvailable());

const loaders = {
  maplibre: () => import("./maplibre-engine.js").then((m) => m.createMapLibreEngine),
  leaflet: () => import("./leaflet-engine.js").then((m) => m.createLeafletEngine),
};

let maplibreModule = null;
/**
 * Starts fetching MapLibre where the browser can make a WebGL 2 context (checked first, once per
 * page): fetched and compiled, not run yet; the engine starts once the page has painted.
 */
export function preloadEngine(doc = globalThis.document, { webgl = webglForPage } = {}) {
  if (!doc?.head || !webgl()) return;
  // (joined, not literals: a bundler would copy the files as assets; the pages that preload serve them)
  const at = (path) => new URL("./" + path, import.meta.url).href;
  // A built page (web/site) names its own files: there the engine is a chunk with another name.
  const built = doc.head.querySelector('meta[name="bemesh-engine-files"]');
  let files = [
    ["modulepreload", at("../../lib/maplibre-gl.mjs")],
    ["modulepreload", at("maplibre-engine.js")],
    ["preload", at("../../lib/css/maplibre-gl.css"), "style"],
  ];
  if (built) {
    try {
      files = JSON.parse(built.content);
    } catch {
      files = []; // nothing to hint: the engine loads when the map starts
    }
  }
  for (const [rel, href, as] of files) {
    if (doc.head.querySelector(`link[href="${href}"]`)) continue;
    const link = doc.createElement("link");
    link.rel = rel;
    link.href = href;
    if (as) link.as = as;
    doc.head.append(link);
  }
}

/**
 * The map in `container`: MapLibre, or Leaflet without WebGL or when MapLibre can't start.
 * `options`: { center: {lat, lon}, zoom, t, i18n, attribution } (zoom as the page counts it).
 */
export async function createMapEngine(container, options, { webgl = webglForPage, load = loaders } = {}) {
  if (webgl()) {
    try {
      const create = await (load === loaders ? (maplibreModule ??= load.maplibre()) : load.maplibre());
      return await create(container, options);
    } catch (e) {
      console.warn("MapLibre could not start; the map uses Leaflet", e);
      container.replaceChildren();
      container.className = container.className.split(/\s+/).filter((c) => c && !c.startsWith("maplibregl")).join(" ");
    }
  }
  const create = await load.leaflet();
  return create(container, options);
}
