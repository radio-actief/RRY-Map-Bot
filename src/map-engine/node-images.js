// Adapted from map.meshcore.io (https://github.com/meshcore-dev/map.meshcore.io), MIT License,
// Copyright (c) 2025 Rastislav Vysoky. See src/coverage/LICENSE.
// The node markers and cluster bubbles of the MapLibre map, drawn on a canvas in the look the
// Leaflet map gets from CSS: the type icon or a companion's coloured initials, the rim, the freshness
// tint, the claimed / own-node glow (css/map.css .node-marker…, src/shared/bemesh-shell.css .node-icon
// and .marker-cluster). The look is read from those rules (computed styles of hidden probes), so the
// CSS stays the one place to change it. Safari has no canvas `filter`: the colour filters are applied
// to the pixels (upstream's applyCssFilter), the drop shadows as canvas shadows.

export const ICON_SIZE = 32;
export const CLUSTER_SIZE = 40;
const CLUSTER_INNER = 30;

// CSS filter functions as 3x4 colour matrices in sRGB, as the Filter Effects spec defines them
function luminanceMatrix([r, g, b], s) {
  return [
    r + (1 - r) * s, g - g * s, b - b * s, 0,
    r - r * s, g + (1 - g) * s, b - b * s, 0,
    r - r * s, g - g * s, b + (1 - b) * s, 0,
  ];
}

const FILTER_MATRICES = {
  saturate: (s) => luminanceMatrix([0.213, 0.715, 0.072], s),
  grayscale: (a) => luminanceMatrix([0.2126, 0.7152, 0.0722], 1 - Math.min(1, a)),
  "hue-rotate": (degrees) => {
    const angle = (degrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [
      0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928, 0,
      0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283, 0,
      0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072, 0,
    ];
  },
  contrast: (c) => [c, 0, 0, 0.5 - 0.5 * c, 0, c, 0, 0.5 - 0.5 * c, 0, 0, c, 0.5 - 0.5 * c],
};

const COLOUR = /(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8}\b)/;

/**
 * A CSS `filter` value (as written or as computed) split into the colour matrices to apply to the
 * pixels and the drop shadows ({ x, y, blur, color }), in order. Other functions are left out.
 */
export function parseFilter(text) {
  const tint = [];
  const shadows = [];
  for (const [, name, args] of String(text || "").matchAll(/([a-z-]+)\(((?:[^()]|\([^()]*\))*)\)/g)) {
    if (name === "drop-shadow") {
      const color = args.match(COLOUR)?.[1] ?? "rgb(0, 0, 0)";
      const [x = 0, y = 0, blur = 0] = args.replace(COLOUR, " ").trim().split(/\s+/).map(parseFloat).filter(Number.isFinite);
      shadows.push({ x, y, blur, color });
      continue;
    }
    const matrix = FILTER_MATRICES[name];
    const value = /^\s*([\d.]+)\s*(deg|%)?\s*$/.exec(args);
    if (!matrix || !value) continue;
    tint.push(matrix(value[2] === "%" ? Number(value[1]) / 100 : Number(value[1])));
  }
  return { tint, shadows };
}

/** Applies colour matrices to RGBA pixels in place (fully transparent pixels stay as they are). */
export function tintPixels(data, matrices) {
  if (!matrices.length) return data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;
    for (const m of matrices) {
      const nr = m[0] * r + m[1] * g + m[2] * b + m[3];
      const ng = m[4] * r + m[5] * g + m[6] * b + m[7];
      const nb = m[8] * r + m[9] * g + m[10] * b + m[11];
      r = Math.min(1, Math.max(0, nr));
      g = Math.min(1, Math.max(0, ng));
      b = Math.min(1, Math.max(0, nb));
    }
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
  }
  return data;
}

/** The first colour in a computed `box-shadow` (its spread ring), or the fallback. */
export function shadowColour(boxShadow, fallback) {
  return String(boxShadow || "").match(COLOUR)?.[1] ?? fallback;
}

/**
 * The image id of a node's marker look: type icon or a companion's initials, freshness, mark.
 * look: { type, status, mark, label?, color? } (mark: "", "claimed" or "user-owned").
 */
export function nodeImageId(look) {
  const mark = look.mark || "-";
  if (look.label != null) return `l|${look.status}|${mark}|${look.color}|${look.label}`;
  return `t|${look.status}|${mark}|${look.type}`;
}

/** The look back from an image id (the label may itself contain "|"). */
export function parseNodeImageId(id) {
  const [kind, status, mark, a, ...rest] = id.split("|");
  const look = { status, mark: mark === "-" ? "" : mark };
  if (kind === "l") return { ...look, color: a, label: rest.join("|") };
  return { ...look, type: Number(a) };
}

function canvas(size, dpr) {
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(size * dpr);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.scale(dpr, dpr);
  return [c, ctx];
}

const typeImages = new Map();
function typeImage(type) {
  let p = typeImages.get(type);
  if (!p) {
    const img = new Image();
    img.src = new URL(`../../img/node_types/${type}.svg`, import.meta.url).href;
    p = img.decode().then(() => img);
    p.catch(() => typeImages.delete(type));
    typeImages.set(type, p);
  }
  return p;
}

/**
 * Reads the markers' look from the page's CSS (hidden probes in `host`): the rim colour, each
 * freshness and mark's filter and opacity, and the cluster bubble's colours and font.
 */
export function readLook(host) {
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0";
  host.append(probe);
  try {
    const marker = document.createElement("span");
    marker.style.display = "block";
    probe.append(marker);
    const filters = {};
    for (const status of ["none", "recent", "stale", "old", "extinct"]) {
      for (const mark of ["", "claimed", "user-owned"]) {
        marker.className = `node-marker node-icon update-${status}${mark ? ` ${mark}` : ""}`;
        const cs = getComputedStyle(marker);
        filters[`${status}|${mark}`] = { ...parseFilter(cs.filter), opacity: Number(cs.opacity) || 1 };
      }
    }
    marker.className = "node-icon";
    const rim = shadowColour(getComputedStyle(marker).boxShadow, "#1a202c");
    const cluster = document.createElement("div");
    cluster.className = "marker-cluster marker-cluster-small";
    cluster.innerHTML = "<div><span>1</span></div>";
    probe.append(cluster);
    const inner = cluster.firstElementChild;
    const span = inner.firstElementChild;
    const cs = getComputedStyle(cluster);
    const ci = getComputedStyle(inner);
    const sp = getComputedStyle(span);
    return {
      rim,
      filters,
      cluster: {
        outer: cs.backgroundColor,
        inner: ci.backgroundColor,
        ring: shadowColour(ci.boxShadow, "transparent"),
        text: sp.color,
        font: `${sp.fontWeight || 800} 12px ${sp.fontFamily || "sans-serif"}`,
      },
    };
  } finally {
    probe.remove();
  }
}

/** A node marker as ImageData at the device pixel ratio (with room around it for the glow). */
export async function drawNodeImage(look, theme, dpr = globalThis.devicePixelRatio || 1) {
  const filter = theme.filters[`${look.status}|${look.mark || ""}`] ?? { tint: [], shadows: [], opacity: 1 };
  const pad = Math.ceil(filter.shadows.reduce((sum, s) => sum + s.blur + Math.max(Math.abs(s.x), Math.abs(s.y)), 0)) + 3;
  const size = ICON_SIZE + 2 * pad;
  const r = ICON_SIZE / 2;
  const c0 = size / 2;
  let [cur, ctx] = canvas(size, dpr);
  // the 2px rim around the 32px disc (.node-icon box-shadow)
  ctx.beginPath();
  ctx.arc(c0, c0, r + 1, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.rim;
  ctx.stroke();
  if (look.label != null) {
    ctx.fillStyle = look.color;
    ctx.beginPath();
    ctx.arc(c0, c0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${(ICON_SIZE * 150) / 512}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(look.label, c0, c0);
  } else {
    ctx.drawImage(await typeImage(look.type), pad, pad, ICON_SIZE, ICON_SIZE);
  }
  if (filter.tint.length) {
    const pixels = ctx.getImageData(0, 0, cur.width, cur.height);
    tintPixels(pixels.data, filter.tint);
    ctx.putImageData(pixels, 0, 0);
  }
  // drop-shadow() after drop-shadow(): each one shadows what the previous made
  for (const s of filter.shadows) {
    const [next, nctx] = canvas(size, dpr);
    nctx.shadowColor = s.color;
    nctx.shadowBlur = s.blur * dpr;
    nctx.shadowOffsetX = s.x * dpr;
    nctx.shadowOffsetY = s.y * dpr;
    nctx.drawImage(cur, 0, 0, size, size);
    [cur, ctx] = [next, nctx];
  }
  if (filter.opacity < 1) {
    const [next, nctx] = canvas(size, dpr);
    nctx.globalAlpha = filter.opacity;
    nctx.drawImage(cur, 0, 0, size, size);
    [cur, ctx] = [next, nctx];
  }
  return ctx.getImageData(0, 0, cur.width, cur.height);
}

/** A cluster bubble with its count (markercluster's 40px disc with a 30px centre). */
export async function drawClusterImage(count, theme, dpr = globalThis.devicePixelRatio || 1) {
  const look = theme.cluster;
  try {
    await document.fonts?.load(look.font, String(count));
  } catch {
    /* the fallback font draws it */
  }
  const [c, ctx] = canvas(CLUSTER_SIZE + 4, dpr);
  const m = (CLUSTER_SIZE + 4) / 2;
  ctx.fillStyle = look.outer;
  ctx.beginPath();
  ctx.arc(m, m, CLUSTER_SIZE / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = look.ring;
  ctx.beginPath();
  ctx.arc(m, m, CLUSTER_INNER / 2 + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = look.inner;
  ctx.beginPath();
  ctx.arc(m, m, CLUSTER_INNER / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = look.text;
  ctx.font = look.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(count), m, m + 0.5);
  return ctx.getImageData(0, 0, c.width, c.height);
}
