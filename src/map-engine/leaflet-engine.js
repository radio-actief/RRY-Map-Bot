// The map page's map on Leaflet, for browsers without WebGL (and when MapLibre can't start): the
// map as it was before MapLibre, with the same interface as ./maplibre-engine.js (see ./index.js).
// Leaflet and markercluster (lib/) load only here, so WebGL browsers never fetch them.
import { BASE_MAPS, baseMapIds, rasterAttribution, readBaseMap, storeBaseMap } from "./basemaps.js";
import { boundsOfGeoJSON, wrapLon } from "./geo.js";
import { prefersReducedMotion } from "./motion.js";

// (joined, not one literal: a bundler, as the configurator's Vite build, then leaves the site's own
// files where they are instead of copying every file it could match)
const base = (path) => new URL("../../" + path, import.meta.url).href;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`${src} did not load`));
    document.head.append(s);
  });
}

/** Leaflet's stylesheets go before the page's own, so those win ties (as when they were in <head>). */
function loadCss(href) {
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

let loading = null;
function loadLeaflet() {
  loading ??= Promise.all([
    loadCss(base("lib/css/leaflet.css")),
    loadCss(base("lib/css/MarkerCluster.css")),
    loadCss(base("lib/css/MarkerCluster.Default.css")),
    window.L?.markerClusterGroup ? null : loadScript(base("lib/leaflet.js")).then(() => loadScript(base("lib/leaflet.markercluster.js"))),
  ]);
  return loading;
}

const ICON_OPTIONS = { iconSize: [32, 32], iconAnchor: [17, 17], popupAnchor: [0, -16] };

/**
 * options as the MapLibre engine's, and `leaflet`: a Leaflet module to use (the configurator bundles
 * its own) instead of loading lib/leaflet.js.
 */
export async function createLeafletEngine(container, { center, zoom, t, attribution, controls: controlsAt = "bottom-left", interactive = true, leaflet = null }) {
  if (!leaflet) await loadLeaflet();
  const L = leaflet ?? window.L;
  container.classList.add("bemesh-map");

  const tiles = {
    osm: L.tileLayer(BASE_MAPS.osm.raster.tiles, {
      maxZoom: 19,
      className: "osm-tiles",
      attribution: [rasterAttribution("osm", t), attribution].filter(Boolean).join(" | "),
    }),
    satellite: L.tileLayer(BASE_MAPS.satellite.raster.tiles, {
      maxZoom: 18,
      attribution: [rasterAttribution("satellite", t), attribution].filter(Boolean).join(" | "),
    }),
  };
  const baseId = readBaseMap(globalThis.localStorage, { vector: false });
  const map = L.map(container, {
    minZoom: 2,
    maxBounds: [
      [-90, -180],
      [90, 200],
    ],
    layers: tiles[baseId],
    zoomControl: false,
    ...(interactive ? {} : { dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false }),
    // reduced motion: no zoom, fade or marker animation
    ...(prefersReducedMotion() ? { zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false } : {}),
  }).setView([center.lat, center.lon], zoom);
  // a popup's auto-pan pans with animation: not with reduced motion
  const panBy = map.panBy;
  map.panBy = (offset, options) => panBy.call(map, offset, prefersReducedMotion() ? { ...options, animate: false } : options);

  const layerNames = Object.fromEntries(baseMapIds({ vector: false }).map((id) => [BASE_MAPS[id].label, tiles[id]]));
  map.on("baselayerchange", (ev) => {
    const id = baseMapIds({ vector: false }).find((k) => BASE_MAPS[k].label === ev.name);
    if (id) storeBaseMap(globalThis.localStorage, id);
  });
  // map type (layers) above zoom in/out, bottom left
  // the same icons as the MapLibre map's controls (src/shared/map-engine.css gives them its glass
  // look), top to bottom: map shade, zoom, base map; bottom corners stack upwards, top ones down
  const corner = controlsAt === "top-right" ? "topright" : "bottomleft";
  const addLayers = () => {
    const layersControl = L.control.layers(layerNames, null, { position: corner }).addTo(map);
    const toggle = layersControl.getContainer?.()?.querySelector(".leaflet-control-layers-toggle");
    if (toggle) {
      toggle.innerHTML = '<i class="bi bi-layers" aria-hidden="true"></i>';
      toggle.setAttribute("aria-label", t("map.baseMap"));
      toggle.title = t("map.baseMap");
    }
  };
  const addZoom = () =>
    L.control
      .zoom({
        position: corner,
        zoomInText: '<i class="bi bi-plus-lg" aria-hidden="true"></i>',
        zoomOutText: '<i class="bi bi-dash-lg" aria-hidden="true"></i>',
        zoomInTitle: t("zoom.in"),
        zoomOutTitle: t("zoom.out"),
      })
      .addTo(map);
  let detachShade = null;
  const addShade = () => {
    detachShade = window.BEmeshMapShade?.attach(L, map, tiles.osm, { position: corner, icons: true }) ?? null;
  };
  if (interactive && controlsAt) {
    if (corner === "topright") [addShade, addZoom, addLayers].forEach((f) => f());
    else [addLayers, addZoom, addShade].forEach((f) => f());
  }

  // the coverage image under the node markers, the planning marks over them
  map.createPane("planCoverage").style.zIndex = 350;
  map.createPane("planLines").style.zIndex = 450;
  map.createPane("planMarks").style.zIndex = 650;
  for (const pane of ["planCoverage", "planLines"]) map.getPane(pane).style.pointerEvents = "none";

  const listeners = new Map();
  const emit = (type, payload) => {
    for (const fn of listeners.get(type) ?? []) fn(payload);
  };
  for (const type of ["movestart", "moveend", "zoomstart", "zoomend"]) map.on(type, () => emit(type));
  map.on("click", (ev) => emit("click", { lat: ev.latlng.lat, lon: wrapLon(ev.latlng.lng) }));
  // a long press on a touch screen is a contextmenu too (Leaflet makes one on iOS)
  map.on("contextmenu", (ev) => {
    const oe = ev.originalEvent;
    oe?.preventDefault?.();
    const touch = oe?.pointerType === "touch" || oe?.type?.startsWith?.("touch") || Boolean(oe?.touches);
    emit("contextmenu", {
      lat: ev.latlng.lat,
      lon: wrapLon(ev.latlng.lng),
      clientX: oe?.clientX ?? oe?.touches?.[0]?.clientX ?? ev.containerPoint.x,
      clientY: oe?.clientY ?? oe?.touches?.[0]?.clientY ?? ev.containerPoint.y,
      touch,
      originalEvent: oe,
    });
  });

  // ------------------------------------------------------------------ nodes
  const icons = new Map();
  function iconFor(look) {
    const marks = look.mark ? ` ${look.mark}` : "";
    const key = look.label != null ? `l|${look.color}|${look.label}|${look.status}|${look.mark}` : `t|${look.type}|${look.status}|${look.mark}`;
    let icon = icons.get(key);
    if (!icon) {
      if (look.label != null) {
        const text = String(look.label).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
        const html = `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><ellipse cx="256" cy="256" rx="256" ry="256" fill="${look.color}"/><text x="256" y="256" dominant-baseline="central" text-anchor="middle" fill="#fff" font-size="150" font-weight="bold" font-family="sans-serif">${text}</text></svg>`;
        icon = L.divIcon({ html, className: `node-marker node-icon svg-node-icon update-${look.status}${marks}`, ...ICON_OPTIONS });
      } else {
        icon = L.icon({ iconUrl: base(`img/node_types/${look.type}.svg`), className: `node-marker node-icon update-${look.status}${marks}`, ...ICON_OPTIONS });
      }
      icons.set(key, icon);
    }
    return icon;
  }

  const markers = new WeakMap();
  const markerNode = new WeakMap();
  let lookOf = () => ({ type: 1, status: "none", mark: "" });
  let nodeClick = () => {};
  let group = null;
  let shown = [];

  function markerFor(node) {
    const icon = iconFor(lookOf(node));
    let m = markers.get(node);
    if (!m) {
      m = L.marker([Number(node.adv_lat), Number(node.adv_lon)], { icon, title: node.adv_name });
      markers.set(node, m);
      markerNode.set(m, node);
    } else if (m.options.icon !== icon) {
      m.setIcon(icon);
    }
    return m;
  }

  function setNodes(nodes, { clusterUntil = 11, look } = {}) {
    if (look) lookOf = look;
    shown = nodes.filter((n) => Number.isFinite(Number(n.adv_lat)) && Number.isFinite(Number(n.adv_lon)));
    if (group) map.removeLayer(group);
    group = L.markerClusterGroup({ disableClusteringAtZoom: clusterUntil || 1, chunkedLoading: true, animate: !prefersReducedMotion() });
    group.on("click", (e) => {
      const node = markerNode.get(e.layer);
      if (node) nodeClick(node);
    });
    group.addLayers(shown.map(markerFor));
    map.addLayer(group);
  }

  // ------------------------------------------------------------------ popup
  let popup = null;
  let popupResize = null;
  let popupClose = null;
  map.on("popupclose", (ev) => {
    if (ev.popup !== popup) return;
    popup = null;
    popupResize?.disconnect();
    popupResize = null;
    const done = popupClose;
    popupClose = null;
    done?.();
  });

  function openPopup(spot, { html, className = "", width, minWidth, maxWidth, offset = 16, onContent, onClose } = {}) {
    if (popup) map.closePopup(popup);
    const size = width ? { minWidth: Math.min(300, width), maxWidth: width } : { ...(minWidth ? { minWidth } : {}), ...(maxWidth ? { maxWidth } : {}) };
    const p = L.popup({
      ...size,
      className,
      autoPanPaddingTopLeft: [10, 100],
      autoPanPaddingBottomRight: [10, 10],
      // a marker's popup: popupAnchor [0, -16] and the popup's own offset [0, 7]
      offset: [0, 7 - offset],
    })
      .setLatLng([spot.lat, spot.lon])
      .setContent(html);
    popup = p;
    popupClose = onClose;
    p.openOn(map);
    const content = p.getElement()?.querySelector(".leaflet-popup-content");
    onContent?.(content);
    // the card grows once its QR code is drawn: pan again so it stays clear of the search box
    if ("ResizeObserver" in window && p.getElement()) {
      popupResize = new ResizeObserver(() => {
        if (popup === p && p.isOpen()) p._adjustPan();
      });
      popupResize.observe(p.getElement());
    }
    return p;
  }

  // ------------------------------------------------------------------ GeoJSON areas, points, tooltips
  /** Text as a text node: names come from the data, never as HTML. */
  const asText = (text) => {
    const el = document.createElement("span");
    el.textContent = text;
    return el;
  };
  let tip = null;
  function showTooltip(spot, text, { offset = 10 } = {}) {
    hideTooltip();
    tip = L.tooltip({ direction: "top", offset: L.point(0, -offset), className: "region-map-tooltip bemesh-leaflet-tooltip" })
      .setContent(asText(text))
      .setLatLng([spot.lat, spot.lon])
      .addTo(map);
  }
  function hideTooltip() {
    tip?.remove();
    tip = null;
  }

  function addGeoJSON(data, { style = () => ({}), label, labelAt, onClick, interactive = Boolean(onClick || label) } = {}) {
    const selected = new Set();
    const base = new Map();
    const layer = L.geoJSON(data, {
      interactive,
      style: (f) => {
        const st = style(f);
        base.set(f, st);
        return st;
      },
      onEachFeature: (f, l) => {
        if (label) {
          l.on("mouseover", (e) => showTooltip(labelAt?.(f) ?? { lat: e.latlng.lat, lon: e.latlng.lng }, label(f)));
          l.on("mouseout", hideTooltip);
          l.on("remove", hideTooltip);
        }
        if (onClick) l.on("click", (e) => onClick(f, { lat: e.latlng.lat, lon: wrapLon(e.latlng.lng) }));
      },
    }).addTo(map);
    return {
      remove: () => layer.remove(),
      select(test) {
        selected.clear();
        layer.eachLayer((l) => {
          const st = base.get(l.feature) ?? {};
          const on = Boolean(test?.(l.feature));
          if (on) selected.add(l.feature);
          l.setStyle({ weight: (st.weight ?? 3) + (on ? 1.5 : 0) });
        });
      },
      bounds: () => boundsOfGeoJSON(data),
    };
  }

  function addPoints(points, { style = {}, cluster = null, label, onClick } = {}) {
    const group = cluster && L.markerClusterGroup
      ? L.markerClusterGroup({ maxClusterRadius: cluster.radius ?? 80, chunkedLoading: points.length > 400, animate: !prefersReducedMotion() })
      : L.featureGroup();
    for (const p of points) {
      const m = L.circleMarker([Number(p.lat), Number(p.lon)], style);
      if (label) m.bindTooltip(asText(label(p)), { className: "region-map-tooltip", direction: "auto" });
      if (onClick) m.on("click", () => onClick(p, { lat: Number(p.lat), lon: Number(p.lon) }));
      group.addLayer(m);
    }
    group.addTo(map);
    return { remove: () => group.remove() };
  }

  const engine = {
    kind: "leaflet",
    container,
    map,
    getCenter() {
      const c = map.getCenter();
      return { lat: c.lat, lon: c.lng };
    },
    getZoom: () => map.getZoom(),
    getSize() {
      const s = map.getSize();
      return { x: s.x, y: s.y };
    },
    getBounds() {
      const b = map.getBounds();
      return [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
    },
    setView(spot, z) {
      map.setView([spot.lat, spot.lon], z, { animate: false });
    },
    /** Flies there; with reduced motion it jumps (and is there at once). */
    flyTo(spot, z) {
      if (prefersReducedMotion()) {
        map.setView([spot.lat, spot.lon], z, { animate: false });
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        map.once("moveend", () => resolve());
        map.flyTo([spot.lat, spot.lon], z);
      });
    },
    fitBounds(bounds, { top = 0, bottom = 0, left = 0, right = 0, maxZoom } = {}) {
      map.fitBounds(bounds, { paddingTopLeft: [left, top], paddingBottomRight: [right, bottom], animate: false, ...(maxZoom ? { maxZoom } : {}) });
    },
    project(spot) {
      const p = map.latLngToContainerPoint([spot.lat, spot.lon]);
      return { x: p.x, y: p.y };
    },
    unproject({ x, y }) {
      const ll = map.containerPointToLatLng([x, y]);
      return { lat: ll.lat, lon: ll.lng };
    },
    resize() {
      map.invalidateSize({ animate: false, pan: false });
    },
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    off(type, fn) {
      listeners.get(type)?.delete(fn);
    },

    setNodes,
    refreshNodes() {
      for (const node of shown) markerFor(node);
    },
    onNodeClick(fn) {
      nodeClick = fn;
    },

    openPopup,
    closePopup() {
      if (popup) map.closePopup(popup);
    },
    setPopupHtml(html) {
      if (!popup) return null;
      popup.setContent(html);
      popup.update();
      return popup.getElement()?.querySelector(".leaflet-popup-content") ?? null;
    },
    popupElement: () => popup?.getElement()?.querySelector(".leaflet-popup-content") ?? null,
    isPopupOpen: () => Boolean(popup?.isOpen()),

    addImage(url, corners) {
      const [topLeft, , bottomRight] = corners;
      const layer = L.imageOverlay(url, [[bottomRight[1], topLeft[0]], [topLeft[1], bottomRight[0]]], {
        pane: "planCoverage",
        interactive: false,
        className: "plan-coverage-image",
      }).addTo(map);
      return { remove: () => layer.remove() };
    },
    addPath(spots, style = {}) {
      const layer = L.polyline(spots.map((s) => (Array.isArray(s) ? s : [s.lat, s.lon])), { pane: "planLines", interactive: false, ...style }).addTo(map);
      return { remove: () => layer.remove() };
    },
    addCircle(spot, meters, style = {}) {
      const layer = L.circle([spot.lat, spot.lon], { radius: meters, pane: "planLines", interactive: false, fill: false, ...style }).addTo(map);
      return { remove: () => layer.remove() };
    },
    addDot(spot, style = {}) {
      const layer = L.circleMarker([spot.lat, spot.lon], { pane: "planMarks", interactive: false, fillOpacity: 1, ...style }).addTo(map);
      return { remove: () => layer.remove() };
    },
    addGeoJSON,
    addPoints,
    showTooltip,
    hideTooltip,
    /** Takes the map down (a page that removes its map, as the configurator's views). */
    remove() {
      detachShade?.();
      map.remove();
    },
    addMarker(spot, { html = "", className = "", size = [20, 20], anchor, draggable = false, title = "", interactive = true, tooltip = "" } = {}) {
      const icon = (h, c) => L.divIcon({ className: c, html: h, iconSize: size, iconAnchor: anchor ?? [size[0] / 2, size[1] / 2] });
      let current = { html, className };
      const m = L.marker([spot.lat, spot.lon], {
        pane: "planMarks",
        icon: icon(html, className),
        draggable,
        title,
        alt: title,
        // a mark with a name on hover must take the pointer, not the keyboard
        interactive: interactive || Boolean(tooltip),
        keyboard: interactive,
        riseOnHover: interactive,
      }).addTo(map);
      if (tooltip) m.bindTooltip(asText(tooltip));
      return {
        get element() {
          return m.getElement();
        },
        getLatLng() {
          const ll = m.getLatLng();
          return { lat: ll.lat, lon: ll.lng };
        },
        setLatLng(next) {
          m.setLatLng([next.lat, next.lon]);
        },
        setIcon(next) {
          current = { ...current, ...next };
          m.setIcon(icon(current.html, current.className));
        },
        setDraggable(on) {
          if (on) m.dragging?.enable();
          else m.dragging?.disable();
        },
        isDragging: () => Boolean(m.dragging?.moved?.()),
        on(type, fn) {
          m.on(type, fn);
        },
        remove() {
          m.remove();
        },
      };
    },
  };
  return engine;
}
