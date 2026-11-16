// The map page's map on MapLibre GL JS (lib/maplibre-gl.mjs, BSD-3-Clause, licence next to it).
// The interface is described in ./index.js; the Leaflet map (./leaflet-engine.js) has the same one.
// Parts follow map.meshcore.io's MapLibre map (MIT, see src/coverage/LICENSE): the page's zoom on
// 256 px tiles, cluster zoom-in, panning the popup into view. The popup opens above its node and the
// map pans to make room for it, as Leaflet's does.
import { LngLatBounds, Map as MapLibreMap, Marker, Popup } from "../../lib/maplibre-gl.mjs";
import { BASE_MAPS, baseMapIds, rasterStyle, readBaseMap, storeBaseMap, styleFor } from "./basemaps.js";
import { circleRing, clusterMaxZoomFor, dashInLineWidths, fromMapZoom, toMapZoom } from "./geo.js";
import { CLUSTER_SIZE, drawClusterImage, drawNodeImage, nodeImageId, parseNodeImageId, readLook } from "./node-images.js";

const MIN_ZOOM = 2;
const MAX_ZOOM = 19;
const CLUSTER_RADIUS = 80; // markercluster's maxClusterRadius
const NODES = "bemesh-nodes";
const CLUSTERS = "bemesh-clusters";
const STYLE_TIMEOUT_MS = 8000;
// base map tiles that fail before any loads: the style's host is down, show OpenStreetMap instead
const TILE_FAILURES_BEFORE_FALLBACK = 6;
const LONG_PRESS_MS = 550;

/** MapLibre's stylesheet, before the page's own so they win ties (and the map doesn't warn). */
function loadCss() {
  const href = new URL("../../lib/css/maplibre-gl.css", import.meta.url).href;
  if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = link.onerror = () => resolve();
    const before = document.querySelector('link[href*="bemesh-tokens.css"]');
    if (before) before.before(link);
    else document.head.append(link);
  });
}

async function fetchStyle(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STYLE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const style = await res.json();
    if (!style || style.version !== 8 || !Array.isArray(style.layers)) throw new Error("not a map style");
    return style;
  } finally {
    clearTimeout(timer);
  }
}

const lngLat = ({ lat, lon }) => [lon, lat];
const spotOf = (ll) => ({ lat: ll.lat, lon: ll.lng });

export async function createMapLibreEngine(container, { center, zoom, t, attribution }) {
  await loadCss();
  const shadeApi = window.BEmeshMapShade;
  let baseId = readBaseMap(globalThis.localStorage, { vector: true });
  let dark = (shadeApi?.shade?.() ?? "light") === "dark";

  const map = new MapLibreMap({
    container,
    center: lngLat(center),
    zoom: toMapZoom(zoom),
    minZoom: toMapZoom(MIN_ZOOM),
    maxZoom: toMapZoom(MAX_ZOOM),
    // north up, like the Leaflet map
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    rollEnabled: false,
    attributionControl: { customAttribution: attribution },
    locale: {
      "Popup.Close": t("map.close"),
      "AttributionControl.ToggleAttribution": t("map.attributionToggle"),
    },
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();

  const listeners = new Map();
  const emit = (type, payload) => {
    for (const fn of listeners.get(type) ?? []) fn(payload);
  };

  // ------------------------------------------------------------------ overlays kept across styles
  // A base map change replaces the whole style: the page's own sources and layers are put back into
  // every new one (transformStyle), in this order: images, paths, node markers.
  const overlays = new Map(); // id -> { source, layers: [layer], kind: "image" | "path" }
  let overlaySeq = 0;
  let nodeData = { type: "FeatureCollection", features: [] };
  let clusterMaxZoom = clusterMaxZoomFor(11);
  let theme = readLook(container);
  let gen = 0;
  const genImages = new Set();
  const nodeIconExpr = () => ["concat", `g${gen}|`, ["get", "icon"]];
  const clusterIconExpr = () => ["concat", `g${gen}|c|`, ["to-string", ["get", "point_count"]]];

  function nodeSource() {
    return {
      type: "geojson",
      data: nodeData,
      cluster: clusterMaxZoom >= 0,
      clusterRadius: CLUSTER_RADIUS,
      clusterMaxZoom: Math.max(0, clusterMaxZoom),
    };
  }
  function nodeLayers() {
    return [
      {
        id: NODES,
        type: "symbol",
        source: NODES,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": nodeIconExpr(),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "symbol-sort-key": ["get", "z"],
        },
      },
      {
        id: CLUSTERS,
        type: "symbol",
        source: NODES,
        filter: ["has", "point_count"],
        layout: { "icon-image": clusterIconExpr(), "icon-allow-overlap": true, "icon-ignore-placement": true },
      },
    ];
  }
  const orderedOverlays = () => [...overlays.values()].sort((a, b) => (a.kind === b.kind ? a.seq - b.seq : a.kind === "image" ? -1 : 1));

  // (a canvas source holds an element, which a style document can't: those go in once it is loaded)
  function withOverlays(style) {
    const sources = { ...style.sources, [NODES]: nodeSource() };
    const layers = [...style.layers];
    for (const o of orderedOverlays()) {
      if (o.kind === "image") continue;
      sources[o.id] = o.source();
      layers.push(...o.layers());
    }
    layers.push(...nodeLayers());
    return { ...style, sources, layers };
  }
  function addImagesToStyle() {
    for (const o of orderedOverlays()) {
      if (o.kind !== "image" || map.getSource(o.id)) continue;
      map.addSource(o.id, o.source());
      for (const layer of o.layers()) map.addLayer(layer, beforeIdFor("image"));
    }
  }

  /** The id of the first layer above an overlay of this kind (images under paths under nodes). */
  function beforeIdFor(kind) {
    if (kind === "image") {
      const firstPath = orderedOverlays().find((o) => o.kind === "path");
      if (firstPath) return firstPath.layers()[0].id;
    }
    return NODES;
  }

  function addOverlay(kind, source, layers) {
    const id = `bemesh-o${++overlaySeq}`;
    const o = { id, seq: overlaySeq, kind, source, layers: () => layers(id) };
    overlays.set(id, o);
    if (map.getLayer(NODES)) {
      const before = beforeIdFor(kind);
      map.addSource(id, source());
      for (const layer of o.layers()) map.addLayer(layer, before);
    }
    return {
      remove() {
        if (!overlays.delete(id)) return;
        for (const layer of o.layers()) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        if (map.getSource(id)) map.removeSource(id);
      },
      _overlay: o,
    };
  }

  // Colours of paths from their CSS class (css/planning.css): a hidden SVG probe reads them.
  const svgNs = "http://www.w3.org/2000/svg";
  const probeSvg = document.createElementNS(svgNs, "svg");
  probeSvg.setAttribute("aria-hidden", "true");
  probeSvg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
  container.append(probeSvg);
  function pathColours(className) {
    const path = document.createElementNS(svgNs, "path");
    if (className) path.setAttribute("class", className);
    probeSvg.append(path);
    const cs = getComputedStyle(path);
    const out = {
      stroke: cs.stroke && cs.stroke !== "none" ? cs.stroke : "#3388ff",
      strokeOpacity: Number(cs.strokeOpacity) || 1,
      fill: cs.fill && cs.fill !== "none" ? cs.fill : "#3388ff",
    };
    path.remove();
    return out;
  }
  const styledPaths = new Set();
  function restylePaths() {
    for (const p of styledPaths) p.restyle();
  }

  // ------------------------------------------------------------------ the base map
  let baseRequest = 0;
  let baseTiles = { ok: false, failed: 0 };
  const notice = document.createElement("div");
  notice.className = "map-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  container.append(notice);
  function showFallbackNotice(on) {
    notice.hidden = !on;
    notice.textContent = on ? t("map.baseMapFallback") : "";
  }

  function applyStyle(style, fellBack) {
    baseTiles = { ok: false, failed: 0, fallback: fellBack };
    container.dataset.baseMap = fellBack ? "osm" : baseId;
    container.dataset.baseShade = dark ? "dark" : "light";
    map.setStyle(style, { diff: false, transformStyle: (_previous, next) => withOverlays(next) });
    showFallbackNotice(fellBack);
  }

  async function loadBase() {
    const request = ++baseRequest;
    let style = styleFor(baseId, { dark, t });
    let fellBack = false;
    if (typeof style === "string") {
      try {
        style = await fetchStyle(style);
      } catch (e) {
        console.warn(`Base map ${baseId} could not be loaded; showing OpenStreetMap`, e);
        style = rasterStyle("osm", { dark, t });
        fellBack = true;
      }
    }
    if (request !== baseRequest) return;
    applyStyle(style, fellBack);
  }

  map.on("data", (e) => {
    if (e.dataType === "source" && e.tile && e.sourceId && !e.sourceId.startsWith("bemesh-")) baseTiles.ok = true;
  });
  map.on("error", (e) => {
    const id = e.sourceId;
    if (!id || id.startsWith("bemesh-") || baseTiles.ok || baseTiles.fallback) return;
    if (++baseTiles.failed >= TILE_FAILURES_BEFORE_FALLBACK) {
      console.warn(`Base map ${baseId} tiles fail; showing OpenStreetMap`, e.error);
      applyStyle(rasterStyle("osm", { dark, t }), true);
    }
  });

  // ------------------------------------------------------------------ images (markers, clusters)
  map.setMissingStyleImageResolver(async (id) => {
    const m = /^g(\d+)\|(.*)$/.exec(id);
    if (!m || Number(m[1]) !== gen) return;
    const rest = m[2];
    const lookNow = theme;
    const data = rest.startsWith("c|")
      ? await drawClusterImage(Number(rest.slice(2)), lookNow)
      : await drawNodeImage(parseNodeImageId(rest), lookNow);
    if (Number(m[1]) !== gen || map.hasImage(id)) return;
    map.addImage(id, data, { pixelRatio: globalThis.devicePixelRatio || 1 });
    genImages.add(id);
  });

  /** The theme changed: read the look again and draw new images (old ones are dropped). */
  function relook() {
    theme = readLook(container);
    const old = [...genImages];
    genImages.clear();
    gen++;
    if (map.getLayer(NODES)) {
      map.setLayoutProperty(NODES, "icon-image", nodeIconExpr());
      map.setLayoutProperty(CLUSTERS, "icon-image", clusterIconExpr());
    }
    for (const id of old) if (map.hasImage(id)) map.removeImage(id);
    restylePaths();
  }

  // ------------------------------------------------------------------ nodes
  let shownNodes = [];
  let lookOf = () => ({ type: 1, status: "none", mark: "" });
  let nodeClick = () => {};

  function buildNodeData() {
    nodeData = {
      type: "FeatureCollection",
      features: shownNodes.map((node, i) => {
        const look = lookOf(node);
        const markZ = look.mark === "user-owned" ? 2 : look.mark === "claimed" ? 1 : 0;
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [Number(node.adv_lon), Number(node.adv_lat)] },
          // above: own nodes, then claimed ones; within each, the southern ones (as Leaflet stacks)
          properties: { i, icon: nodeImageId(look), z: markZ * 1000 + (90 - Number(node.adv_lat)) },
        };
      }),
    };
    map.getSource(NODES)?.setData(nodeData);
  }

  async function zoomIntoCluster(feature) {
    const source = map.getSource(NODES);
    const id = feature.properties.cluster_id;
    const [leaves, expansionZoom] = await Promise.all([source.getClusterLeaves(id, Infinity, 0), source.getClusterExpansionZoom(id)]);
    const bounds = new LngLatBounds();
    for (const leaf of leaves) bounds.extend(leaf.geometry.coordinates);
    const top = Math.max(0, overlayBottom() - container.getBoundingClientRect().top);
    const camera = map.cameraForBounds(bounds, { padding: { top: top + 30, bottom: 40, left: 40, right: 40 }, maxZoom: map.getMaxZoom() });
    if (!camera || camera.zoom < expansionZoom) map.easeTo({ center: feature.geometry.coordinates, zoom: expansionZoom });
    else map.easeTo({ center: camera.center, zoom: camera.zoom });
  }

  const hitLayers = () => (map.getLayer(NODES) ? [CLUSTERS, NODES] : []);
  map.on("click", (e) => {
    const layers = hitLayers();
    const feature = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : null;
    if (!feature) {
      closePopup();
      return;
    }
    if (feature.layer.id === CLUSTERS) zoomIntoCluster(feature).catch((err) => console.error(err));
    else {
      const node = shownNodes[feature.properties.i];
      if (node) nodeClick(node);
    }
  });
  const canvas = map.getCanvas();
  map.on("mousemove", (e) => {
    const layers = hitLayers();
    const feature = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : null;
    const node = feature?.layer.id === NODES ? shownNodes[feature.properties.i] : null;
    canvas.style.cursor = feature ? "pointer" : "";
    canvas.title = node?.adv_name ?? "";
  });

  // ------------------------------------------------------------------ popup
  let popup = null;
  let popupResize = null;
  let popupClose = null;

  /** The bottom of what floats over the top of the map: the top bar, the search box, the phone's totals. */
  function overlayBottom() {
    return Math.max(0, ...[".topbar", ".search-box", ".totals-chip"].map((sel) => document.querySelector(sel)?.getBoundingClientRect().bottom ?? 0));
  }
  function popupArea() {
    const box = container.getBoundingClientRect();
    return {
      top: Math.max(box.top, overlayBottom()) + 10,
      bottom: Math.min(box.bottom, innerHeight) - 24,
      left: box.left + 10,
      right: Math.min(box.right, innerWidth) - 10,
    };
  }
  function keepPopupInView() {
    if (!popup) return;
    const box = popup.getElement().getBoundingClientRect();
    const area = popupArea();
    let dx = 0;
    let dy = 0;
    if (box.right > area.right) dx = box.right - area.right;
    if (box.left - dx < area.left) dx = box.left - area.left;
    if (box.bottom > area.bottom) dy = box.bottom - area.bottom;
    if (box.top - dy < area.top) dy = box.top - area.top;
    if (dx || dy) map.panBy([dx, dy], { duration: 200 });
  }

  function closePopup() {
    const p = popup;
    if (!p) return;
    popup = null;
    popupResize?.disconnect();
    popupResize = null;
    p.remove();
    const done = popupClose;
    popupClose = null;
    done?.();
  }

  function openPopup(spot, { html, className = "", width, onContent, onClose } = {}) {
    closePopup();
    const p = new Popup({
      anchor: "bottom",
      offset: [0, -16],
      maxWidth: "none",
      className: `bemesh-popup ${className}`.trim(),
      closeOnClick: false,
      closeOnMove: false,
      focusAfterOpen: false,
    }).setLngLat(lngLat(spot));
    p.setHTML(html);
    const content = () => p.getElement()?.querySelector(".maplibregl-popup-content");
    popup = p;
    popupClose = onClose;
    p.on("close", () => {
      if (popup === p) {
        popup = null;
        popupResize?.disconnect();
        popupResize = null;
        const done = popupClose;
        popupClose = null;
        done?.();
      }
    });
    p.addTo(map);
    // border-box: the card itself keeps the given width inside its 1px border, as on Leaflet
    if (width) content().style.width = `${width + 2}px`;
    onContent?.(content());
    keepPopupInView();
    if ("ResizeObserver" in window) {
      let frame = 0;
      popupResize = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (popup === p) keepPopupInView();
        });
      });
      popupResize.observe(content());
    }
    return p;
  }

  function setPopupHtml(html) {
    if (!popup) return;
    const content = popup.getElement()?.querySelector(".maplibregl-popup-content");
    const width = content?.style.width;
    popup.setHTML(html);
    const next = popup.getElement()?.querySelector(".maplibregl-popup-content");
    if (width && next) next.style.width = width;
    return next;
  }

  // Escape closes the popup while the focus is on the map or nowhere in particular (as on Leaflet's map)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !popup || e.defaultPrevented || document.querySelector(".node-qr-enlarge-backdrop")) return;
    const focus = document.activeElement;
    if (focus && focus !== document.body && !container.contains(focus)) return;
    closePopup();
  });

  // ------------------------------------------------------------------ right click / long press
  function menuAt(point, clientX, clientY, touch, originalEvent) {
    const ll = map.unproject(point);
    emit("contextmenu", { lat: ll.lat, lon: ll.lng, clientX, clientY, touch, originalEvent });
  }
  let longPressAt = 0;
  map.on("contextmenu", (e) => {
    e.originalEvent?.preventDefault?.();
    if (Date.now() - longPressAt < 1000) return; // a long press already opened it
    const oe = e.originalEvent;
    const touch = oe?.pointerType === "touch" || Boolean(oe?.touches);
    menuAt(e.point, oe?.clientX ?? e.point.x, oe?.clientY ?? e.point.y, touch, oe);
  });
  // iOS gives no contextmenu on a long press: one finger, held still
  let press = null;
  const cancelPress = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  canvas.addEventListener("touchstart", (e) => {
    cancelPress();
    if (e.touches.length !== 1) return;
    const { clientX, clientY } = e.touches[0];
    press = {
      x: clientX,
      y: clientY,
      timer: setTimeout(() => {
        const rect = container.getBoundingClientRect();
        longPressAt = Date.now();
        press = null;
        menuAt([clientX - rect.left, clientY - rect.top], clientX, clientY, true, e);
      }, LONG_PRESS_MS),
    };
  }, { passive: true });
  canvas.addEventListener("touchmove", (e) => {
    if (press && Math.hypot(e.touches[0].clientX - press.x, e.touches[0].clientY - press.y) > 10) cancelPress();
  }, { passive: true });
  canvas.addEventListener("touchend", cancelPress, { passive: true });
  canvas.addEventListener("touchcancel", cancelPress, { passive: true });

  for (const [ours, theirs] of [["movestart", "movestart"], ["moveend", "moveend"], ["zoomend", "zoomend"], ["zoomstart", "zoomstart"]]) {
    map.on(theirs, () => emit(ours));
  }
  map.on("movestart", cancelPress);

  // ------------------------------------------------------------------ controls (bottom left)
  // top to bottom as on the Leaflet map: map shade, zoom, base map
  const controls = document.createElement("div");
  controls.className = "map-ctrls";
  const zoomBar = document.createElement("div");
  zoomBar.className = "map-ctrl map-ctrl--bar";
  const zoomButton = (text, label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", fn);
    zoomBar.append(b);
    return b;
  };
  const zoomIn = zoomButton("+", t("zoom.in"), () => map.zoomIn());
  const zoomOut = zoomButton("−", t("zoom.out"), () => map.zoomOut());
  const updateZoomButtons = () => {
    zoomIn.disabled = map.getZoom() >= map.getMaxZoom();
    zoomOut.disabled = map.getZoom() <= map.getMinZoom();
  };
  map.on("zoomend", updateZoomButtons);
  updateZoomButtons();

  // the base map choice: a button that opens a list of radio buttons
  const layers = document.createElement("div");
  layers.className = "map-ctrl map-basemap";
  const layersToggle = document.createElement("button");
  layersToggle.type = "button";
  layersToggle.className = "map-basemap__toggle";
  layersToggle.setAttribute("aria-label", t("map.baseMap"));
  layersToggle.setAttribute("aria-expanded", "false");
  layersToggle.title = t("map.baseMap");
  layersToggle.innerHTML = '<i class="bi bi-layers" aria-hidden="true"></i>';
  const list = document.createElement("fieldset");
  list.className = "map-basemap__list";
  list.hidden = true;
  const legend = document.createElement("legend");
  legend.textContent = t("map.baseMap");
  list.append(legend);
  for (const id of baseMapIds({ vector: true })) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "bemesh-base-map";
    input.value = id;
    input.checked = id === baseId;
    input.addEventListener("change", () => {
      baseId = id;
      storeBaseMap(globalThis.localStorage, id);
      loadBase();
    });
    const span = document.createElement("span");
    span.textContent = BASE_MAPS[id].label;
    label.append(input, span);
    list.append(label);
  }
  // opens on hover (with a mouse) and on a click or tap, as Leaflet's layers control
  let openedByHover = false;
  const setLayersOpen = (open) => {
    list.hidden = !open;
    layersToggle.setAttribute("aria-expanded", String(open));
    layers.classList.toggle("open", open);
    if (!open) openedByHover = false;
  };
  layersToggle.addEventListener("click", () => {
    if (list.hidden) setLayersOpen(true);
    else if (!openedByHover) setLayersOpen(false);
  });
  const hover = () => matchMedia("(hover: hover)").matches;
  layers.addEventListener("mouseenter", () => {
    if (!hover() || !list.hidden) return;
    openedByHover = true;
    setLayersOpen(true);
  });
  layers.addEventListener("mouseleave", () => hover() && openedByHover && setLayersOpen(false));
  document.addEventListener("pointerdown", (e) => {
    if (!list.hidden && !layers.contains(e.target)) setLayersOpen(false);
  }, true);
  layers.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !list.hidden) {
      setLayersOpen(false);
      layersToggle.focus();
    }
  });
  layers.append(layersToggle, list);

  const shadeBar = document.createElement("div");
  shadeBar.className = "map-ctrl map-ctrl--bar map-shade-control";
  controls.append(shadeBar, zoomBar, layers);
  container.append(controls);
  for (const ev of ["mousedown", "dblclick", "wheel", "touchstart", "contextmenu"]) {
    controls.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev !== "contextmenu" });
  }

  // the shade switch decides light or dark style; the first call (now) loads the base map
  let started = false;
  const shade = shadeApi?.watch?.(container, (now) => {
    dark = now === "dark";
    if (started) loadBase();
  });
  if (shade) shadeBar.append(shade.button);
  else shadeBar.remove();
  // the site theme also colours the markers and the planning lines
  let themeTimer = 0;
  const onTheme = () => {
    clearTimeout(themeTimer);
    themeTimer = setTimeout(relook, 0);
  };
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", onTheme);

  // every new style gets the nodes as they are now (they may have changed while it loaded)
  map.on("style.load", () => {
    map.getSource(NODES)?.setData(nodeData);
    addImagesToStyle();
  });
  // on a narrow map the credit line starts folded (its button opens it), not over the controls
  map.once("load", () => {
    const credit = container.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show");
    credit?.classList.remove("maplibregl-compact-show");
    credit?.removeAttribute("open");
  });

  started = true;
  // no WebGL after all throws from the constructor above; here, wait for the first style
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, STYLE_TIMEOUT_MS + 2000);
    const loaded = () => {
      if (!map.getLayer(NODES)) return;
      map.off("style.load", loaded);
      clearTimeout(timer);
      resolve();
    };
    map.on("style.load", loaded);
    map.once("webglcontextlost", () => reject(new Error("WebGL context lost")));
    loadBase();
  });

  // ------------------------------------------------------------------ the engine
  const engine = {
    kind: "maplibre",
    container,
    map,
    getCenter: () => spotOf(map.getCenter()),
    getZoom: () => fromMapZoom(map.getZoom()),
    getSize: () => ({ x: container.clientWidth, y: container.clientHeight }),
    setView(spot, z) {
      map.jumpTo({ center: lngLat(spot), zoom: toMapZoom(z) });
    },
    flyTo(spot, z) {
      return new Promise((resolve) => {
        map.once("moveend", () => resolve());
        map.flyTo({ center: lngLat(spot), zoom: toMapZoom(z), maxDuration: 1500, essential: false });
      });
    },
    fitBounds([[s, w], [n, e]], { top = 0, bottom = 0, left = 0, right = 0, maxZoom } = {}) {
      map.fitBounds([[w, s], [e, n]], {
        padding: { top, bottom, left, right },
        animate: false,
        ...(maxZoom ? { maxZoom: toMapZoom(maxZoom) } : {}),
      });
    },
    project(spot) {
      const p = map.project(lngLat(spot));
      return { x: p.x, y: p.y };
    },
    unproject({ x, y }) {
      return spotOf(map.unproject([x, y]));
    },
    resize() {
      map.resize();
    },
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    off(type, fn) {
      listeners.get(type)?.delete(fn);
    },

    setNodes(nodes, { clusterUntil = 11, look } = {}) {
      if (look) lookOf = look;
      shownNodes = nodes.filter((n) => Number.isFinite(Number(n.adv_lat)) && Number.isFinite(Number(n.adv_lon)));
      const nextMax = clusterMaxZoomFor(clusterUntil || 0);
      const source = map.getSource(NODES);
      if (nextMax !== clusterMaxZoom) {
        clusterMaxZoom = nextMax;
        // options left out are reset: pass them all
        source?.setClusterOptions({ cluster: clusterMaxZoom >= 0, clusterRadius: CLUSTER_RADIUS, clusterMaxZoom: Math.max(0, clusterMaxZoom) });
      }
      buildNodeData();
    },
    refreshNodes() {
      buildNodeData();
    },
    onNodeClick(fn) {
      nodeClick = fn;
    },

    openPopup,
    closePopup,
    setPopupHtml,
    popupElement: () => popup?.getElement()?.querySelector(".maplibregl-popup-content") ?? null,
    isPopupOpen: () => Boolean(popup),

    // The coverage image is a blob: URL. MapLibre would fetch it (connect-src has no blob:): it is
    // drawn on a canvas instead (img-src has blob:), shown through a canvas source.
    addImage(url, corners) {
      let handle = null;
      let removed = false;
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      img.decode().then(() => {
        if (removed) return;
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        handle = addOverlay(
          "image",
          () => ({ type: "canvas", canvas, coordinates: corners, animate: false }),
          (id) => [{ id, type: "raster", source: id, paint: { "raster-fade-duration": 0 } }],
        );
      }, (e) => console.warn("Coverage image could not be drawn", e));
      return {
        remove() {
          removed = true;
          handle?.remove();
        },
      };
    },
    addPath(spots, style = {}) {
      const data = { type: "Feature", geometry: { type: "LineString", coordinates: spots.map((s) => (Array.isArray(s) ? [s[1], s[0]] : lngLat(s))) }, properties: {} };
      return pathOverlay(data, style);
    },
    addCircle(spot, meters, style = {}) {
      const data = { type: "Feature", geometry: { type: "LineString", coordinates: circleRing(spot, meters) }, properties: {} };
      return pathOverlay(data, style);
    },
    addDot(spot, { radius = 6, weight = 3, className = "" } = {}) {
      let colours = pathColours(className);
      const paint = () => ({
        "circle-radius": radius,
        "circle-color": colours.fill,
        "circle-stroke-color": colours.stroke,
        "circle-stroke-width": weight,
        "circle-stroke-opacity": colours.strokeOpacity,
      });
      const handle = addOverlay(
        "path",
        () => ({ type: "geojson", data: { type: "Feature", geometry: { type: "Point", coordinates: lngLat(spot) }, properties: {} } }),
        (id) => [{ id, type: "circle", source: id, paint: paint() }],
      );
      return restylable(handle, () => {
        colours = pathColours(className);
        return paint();
      });
    },
    addMarker(spot, options) {
      return createMark(spot, options);
    },
  };

  function restylable(handle, paint) {
    const entry = {
      restyle() {
        const values = paint();
        for (const layer of handle._overlay.layers()) {
          if (!map.getLayer(layer.id)) continue;
          for (const [k, v] of Object.entries(values)) map.setPaintProperty(layer.id, k, v);
        }
      },
    };
    styledPaths.add(entry);
    const remove = handle.remove;
    handle.remove = () => {
      styledPaths.delete(entry);
      remove();
    };
    return handle;
  }

  function pathOverlay(data, { className = "", weight = 3, dashArray = null, lineCap = "round" } = {}) {
    let colours = pathColours(className);
    const dash = dashInLineWidths(dashArray, weight);
    const paint = () => ({
      "line-color": colours.stroke,
      "line-opacity": colours.strokeOpacity,
      "line-width": weight,
      ...(dash ? { "line-dasharray": dash } : {}),
    });
    const handle = addOverlay(
      "path",
      () => ({ type: "geojson", data }),
      (id) => [{ id, type: "line", source: id, layout: { "line-cap": lineCap === "round" ? "round" : "butt", "line-join": "round" }, paint: paint() }],
    );
    return restylable(handle, () => {
      colours = pathColours(className);
      const { "line-dasharray": _d, ...rest } = paint();
      return rest;
    });
  }

  /** An HTML mark over the map, as Leaflet's divIcon marker: size and anchor in px. */
  function createMark(spot, { html = "", className = "", size = [20, 20], anchor, draggable = false, title = "", interactive = true } = {}) {
    const el = document.createElement("div");
    el.className = "map-mark";
    const [w, h] = size;
    const [ax, ay] = anchor ?? [w / 2, h / 2];
    let own = [];
    // MapLibre keeps classes of its own on the element: only ours change
    const apply = (cls, inner) => {
      el.classList.remove(...own);
      own = String(cls || "").split(/\s+/).filter(Boolean);
      el.classList.add(...own);
      el.innerHTML = inner;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    };
    apply(className, html);
    if (title) {
      el.title = title;
      el.setAttribute("aria-label", title);
    }
    if (interactive) {
      el.tabIndex = 0;
      el.setAttribute("role", "button");
    } else {
      el.style.pointerEvents = "none";
    }
    const marker = new Marker({ element: el, anchor: "top-left", offset: [-ax, -ay], draggable }).setLngLat(lngLat(spot)).addTo(map);
    el.classList.toggle("map-mark--draggable", draggable);
    const handlers = new Map();
    for (const type of ["drag", "dragend", "dragstart"]) {
      marker.on(type, () => {
        el.classList.toggle("map-mark--dragging", type !== "dragend");
        for (const fn of handlers.get(type) ?? []) fn();
      });
    }
    return {
      element: el,
      getLatLng: () => spotOf(marker.getLngLat()),
      setLatLng(next) {
        marker.setLngLat(lngLat(next));
      },
      setIcon({ html: nextHtml, className: nextClass }) {
        apply(nextClass ?? className, nextHtml ?? html);
      },
      setDraggable(on) {
        marker.setDraggable(on);
        el.classList.toggle("map-mark--draggable", on);
      },
      isDragging: () => el.classList.contains("map-mark--dragging"),
      on(type, fn) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type).add(fn);
      },
      remove() {
        marker.remove();
      },
    };
  }

  return engine;
}
