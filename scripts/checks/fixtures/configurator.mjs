// Shared setup for the configurator checks: stub map tiles and the node list, open the app at a size.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

/** A few repeaters around Gent, so the map has nearby nodes. */
export const NODES = Array.from({ length: 5 }, (_, i) => {
  const key = (i + 1).toString(16).padStart(2, "0").repeat(32);
  return { public_key: key, type: 2, adv_name: `BE-GEN-Check${i + 1}`, adv_lat: 51.03 + i * 0.02, adv_lon: 3.68 + i * 0.03 };
});

/** Stub tiles and nodes on a page. */
export async function stub(page) {
  for (const host of ["**/tile.openstreetmap.org/**", "**/*.tile.openstreetmap.org/**"]) {
    await page.route(host, (r) => r.fulfill({ contentType: "image/png", body: PNG }));
  }
  await page.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(NODES) }));
}

/**
 * Open /configurator. `phone` gives a 390×844 touch screen; page errors and console errors are
 * collected in page.errors as ctx.open does.
 */
export async function openConfigurator(ctx, { phone = false } = {}) {
  const page = await ctx.browser.newPage(
    phone
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: "light" }
      : { viewport: { width: 1440, height: 900 }, colorScheme: "light" },
  );
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await stub(page);
  await page.goto(ctx.base + "/configurator", { waitUntil: "networkidle" });
  await page.waitForSelector(".panel .panel-body h2");
  return page;
}

/** Search a place on the Place step and pick the first hit (tap on a phone, click otherwise). */
export async function searchPlace(page, query, { tap = false } = {}) {
  const box = page.getByRole("combobox", { name: "Search a place" });
  if (tap) await box.tap();
  else await box.click();
  await box.fill(query);
  const hit = page.getByRole("option").first();
  await hit.waitFor();
  if (tap) await hit.tap();
  else await hit.click();
}

/** The step's Next button in the panel footer. */
export const next = (page) => page.locator(".panel-foot .btn.primary");

/**
 * The map's areas drawn with a class (path.<cls> on the Leaflet map; on the MapLibre map, which draws
 * on its canvas, the rendered features of that class): how many, and their box on the page.
 */
export function areas(page, cls) {
  return page.evaluate((cls) => {
    const m = window.bemeshMap;
    const host = document.querySelector(".map-canvas")?.getBoundingClientRect();
    let boxes = [];
    if (m?.kind === "maplibre") {
      const layers = m.map.getStyle().layers.map((l) => l.id).filter((id) => /^bemesh-o\d+-(fill|hatch|line|dash)$/.test(id));
      const fs = m.map.queryRenderedFeatures({ layers }).filter((f) => String(f.properties.cls).split(/\s+/).includes(cls));
      const ids = new Set();
      for (const f of fs) {
        ids.add(f.properties.i);
        const pts = [];
        const walk = (c) => (typeof c[0] === "number" ? pts.push(m.project({ lat: c[1], lon: c[0] })) : c.forEach(walk));
        walk(f.geometry.coordinates);
        const xs = pts.map((p) => p.x + host.left);
        const ys = pts.map((p) => p.y + host.top);
        boxes.push({ left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) });
      }
      boxes.count = ids.size;
    } else {
      boxes = [...document.querySelectorAll(`path.${cls}`)].map((p) => p.getBoundingClientRect());
      boxes.count = boxes.length;
    }
    if (!boxes.length) return { count: 0, box: null };
    const box = {
      x: Math.min(...boxes.map((b) => b.left)),
      y: Math.min(...boxes.map((b) => b.top)),
      right: Math.max(...boxes.map((b) => b.right)),
      bottom: Math.max(...boxes.map((b) => b.bottom)),
    };
    return { count: boxes.count, box: { x: box.x, y: box.y, width: box.right - box.x, height: box.bottom - box.y } };
  }, cls);
}

/** Waits until the map shows an area of that class. */
export async function waitForArea(page, cls, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await areas(page, cls)).count > 0) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`no ${cls} on the map`);
}
