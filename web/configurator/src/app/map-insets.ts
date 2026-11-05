import type * as L from "leaflet";

/**
 * How much of the map the step panel covers: the docked panel its left side, the phone sheet its
 * lower part. `room` keeps that much of the map in play, even under a full-height sheet.
 */
export function coveredInsets(map: L.Map, room = 80): { left: number; bottom: number } {
  const el = map.getContainer?.();
  if (!el) return { left: 0, bottom: 0 };
  const host = el.getBoundingClientRect();
  const panel = document.querySelector<HTMLElement>(".panel.docked, .panel.sheet");
  if (!panel || !host.width || !host.height) return { left: 0, bottom: 0 };
  const p = panel.getBoundingClientRect();
  const left = panel.classList.contains("docked") ? Math.min(Math.max(0, p.right - host.left), host.width - room) : 0;
  const bottom = panel.classList.contains("sheet") ? Math.min(Math.max(0, host.bottom - p.top), host.height - room) : 0;
  return { left, bottom };
}

/** Centre a point in the part of the map the panel leaves visible. */
export function centreInView(map: L.Map, at: L.LatLngExpression, zoom: number): void {
  const { left, bottom } = coveredInsets(map);
  if (!left && !bottom) return void map.setView(at, zoom);
  // The visible centre lies left/2 to the right of and bottom/2 above the map's own centre.
  const shifted = map.project(at, zoom).add([-left / 2, bottom / 2]);
  map.setView(map.unproject(shifted, zoom), zoom);
}

/**
 * Fit bounds into the part of the map the panel leaves visible. When the phone sheet leaves less
 * than a third of the map, a small strip would shrink the area to a speck: `lowerSheet` may bring
 * the sheet down to half (it returns true when it did), and the area fits above it; otherwise the
 * area fits the whole map.
 */
export function fitInView(map: L.Map, bounds: L.LatLngBounds, maxZoom: number, lowerSheet?: () => boolean, margin = 24): void {
  let { left, bottom } = coveredInsets(map, 0);
  const height = map.getContainer?.()?.getBoundingClientRect().height ?? 0;
  if (height && height - bottom < height / 3) bottom = lowerSheet?.() ? height / 2 : 0;
  map.fitBounds(bounds, { paddingTopLeft: [margin + left, margin], paddingBottomRight: [margin, margin + bottom], maxZoom });
}
