// Dark map tiles: follows the theme, the switch on the map overrides it, one key shared by every map.
import { mockStats } from "./fixtures/mock-stats.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const KEY = "bemesh.mapShade";

const nodes = Array.from({ length: 6 }, (_, i) => {
  const key = (i + 1).toString(16).padStart(2, "0").repeat(32);
  return {
    adv_name: `Shade node ${i + 1}`, adv_lat: 50.6 + i * 0.1, adv_lon: 4 + i * 0.1, city: "Gent", coords: "50.6, 4",
    discord_owner_id: null, discord_owner_name: null, inserted_by: key, updated_by: key,
    inserted_date: new Date().toISOString(), updated_date: new Date().toISOString(), last_advert: new Date().toISOString(),
    link: `meshcore://11${key}`, params: { bw: 62.5, cr: 8, freq: 869.618, sf: 8 }, public_key: key, source: "app", type: (i % 4) + 1,
  };
});

const changes = JSON.stringify([
  { sync_date: "2026-10-01T06:00:00Z", public_key: "k1", change_type: "added", lat: 50.85, lon: 4.35, adv_name: "N1", type: 1 },
  { sync_date: "2026-10-10T06:00:00Z", public_key: "k2", change_type: "added", lat: 51.05, lon: 3.72, adv_name: "N2", type: 2 },
]);

const pages = [
  { name: "map", path: "/", map: "#map", tiles: true,
    setup: async (p) => p.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(nodes) })) },
  { name: "stats", path: "/stats", map: "#stats-map", setup: (p) => mockStats(p, changes) },
  { name: "region map", path: "/region-map", map: "#region-map-container" },
];

const setupFor = (pg, key) => async (p) => {
  await p.route("**/tile.openstreetmap.org/**", (r) => r.fulfill({ contentType: "image/png", body: PNG }));
  await p.route("**/*.tile.openstreetmap.org/**", (r) => r.fulfill({ contentType: "image/png", body: PNG }));
  await p.route("**/server.arcgisonline.com/**", (r) => r.fulfill({ contentType: "image/png", body: PNG }));
  if (pg.setup) await pg.setup(p);
  if (key) await p.addInitScript(([k, v]) => { if (!sessionStorage.getItem("__init")) { localStorage.setItem(k, v); sessionStorage.setItem("__init", "1"); } }, [KEY, key]);
};

const dark = (page, sel) => page.locator(sel).evaluate((e) => e.classList.contains("map-dark"));
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const settle = (page) => page.waitForTimeout(150);

export default async function (ctx) {
  for (const pg of pages) {
    const n = `map shade ${pg.name}`;
    let page = await ctx.open(pg.path, { scheme: "light", setup: setupFor(pg) });
    await page.waitForSelector(`${pg.map} .osm-tiles`, { timeout: 10000 }).catch(() => {});
    const btn = page.locator(`${pg.map} .map-shade-button`);
    ctx.check(`${n}: light and following, no map-dark`, !(await dark(page, pg.map)));
    ctx.check(`${n}: switch labelled Dark map (follows the theme)`,
      (await btn.count()) === 1 && (await btn.getAttribute("aria-label")) === "Dark map (follows the theme)", await btn.getAttribute("aria-label").catch(() => "none"));
    const filter0 = await page.locator(`${pg.map} .osm-tiles`).first().evaluate((e) => getComputedStyle(e).filter).catch(() => "");
    ctx.check(`${n}: light tiles are unfiltered`, filter0 === "none", filter0);

    const toggle = page.locator("[data-theme-toggle]:visible").first();
    await toggle.click(); // light
    await toggle.click(); // dark
    await settle(page);
    ctx.check(`${n}: dark theme gives map-dark`, await dark(page, pg.map));
    const filter1 = await page.locator(`${pg.map} .osm-tiles`).first().evaluate((e) => getComputedStyle(e).filter).catch(() => "");
    ctx.check(`${n}: dark tiles have an invert filter`, filter1.includes("invert"), filter1);
    const imgs = await page.locator(`${pg.map} .osm-tiles img`).count();
    ctx.check(`${n}: tile images exist under the filtered layer`, imgs > 0, String(imgs));
    ctx.check(`${n}: label flips to Light map (follows the theme)`, (await btn.getAttribute("aria-label")) === "Light map (follows the theme)");

    await btn.click();
    ctx.check(`${n}: click gives a light map`, !(await dark(page, pg.map)));
    ctx.check(`${n}: key is "light"`, (await stored(page)) === "light", String(await stored(page)));
    ctx.check(`${n}: label is Dark map`, (await btn.getAttribute("aria-label")) === "Dark map");

    await btn.click();
    ctx.check(`${n}: second click is dark again`, await dark(page, pg.map));
    ctx.check(`${n}: key removed (follows)`, (await stored(page)) === null, String(await stored(page)));

    if (pg.tiles) {
      await page.evaluate(() => {
        const radios = document.querySelectorAll(".leaflet-control-layers-base input[type=radio]");
        radios[1].click();
      });
      await page.waitForTimeout(400);
      ctx.check(`${n}: still a dark map on the satellite layer`, await dark(page, pg.map));
      const sat = await page.locator(`${pg.map} .leaflet-layer`).evaluateAll((els) => els.map((e) => ({ cls: e.className, f: getComputedStyle(e).filter })));
      ctx.check(`${n}: satellite layer is never filtered`, sat.length > 0 && sat.every((s) => !s.cls.includes("osm-tiles") && s.f === "none"), JSON.stringify(sat));
    }
    ctx.check(`${n}: no page errors`, !page.errors.length, page.errors.join("; "));
    await page.close();

    page = await ctx.open(pg.path, { scheme: "light", setup: setupFor(pg, "dark") });
    await page.waitForSelector(`${pg.map} .osm-tiles`, { timeout: 10000 }).catch(() => {});
    ctx.check(`${n}: stored dark on the light theme gives a dark map`, await dark(page, pg.map));
    ctx.check(`${n}: override label is Light map`, (await page.locator(`${pg.map} .map-shade-button`).getAttribute("aria-label")) === "Light map");
    ctx.check(`${n}: reload has no page errors`, !page.errors.length, page.errors.join("; "));
    await page.close();
  }
}
