// Configurator Regions step: a row's name lights its area on the map and zooms to it; a click on an area lights its row.
import { next, openConfigurator, searchPlace } from "./fixtures/configurator.mjs";

const focusedRows = (page) => page.locator("li.region-row.focused").evaluateAll((rows) => rows.map((r) => r.dataset.code).join(","));
/** The map's zoom level: the most common z among the loaded tiles (old levels are dropped after a zoom). */
const zoomOf = async (page) => {
  await page.waitForTimeout(800);
  return page.locator(".map-canvas").evaluate((el) => {
    const zs = [...el.querySelectorAll(".osm-tiles img.leaflet-tile-loaded")].map((i) => Number(/\/(\d+)\/\d+\/\d+\.png/.exec(i.src)?.[1]));
    const count = new Map();
    for (const z of zs) count.set(z, (count.get(z) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  });
};

export default async function (ctx) {
  const n = "configurator regions map";
  const page = await openConfigurator(ctx);
  await page.getByRole("button", { name: /Continue without a device/ }).click();
  await searchPlace(page, "Gent");
  await page.waitForFunction(() => document.querySelector(".place-line")?.textContent.includes("Gent"));
  await next(page).click();
  await next(page).click();
  await page.waitForSelector("li.region-row");
  await page.waitForSelector("path.map-region-allowed");

  const z0 = await zoomOf(page);
  await page.locator('li.region-row[data-code="be"] .region-name').click();
  await page.waitForSelector("path.map-region-focus");
  await page.waitForTimeout(400);
  ctx.check(`${n}: clicking Belgium's name lights its row`, (await focusedRows(page)) === "be", await focusedRows(page));
  ctx.check(`${n}: … outlines its area on the map`, (await page.locator("path.map-region-focus").count()) > 0);
  const z1 = await zoomOf(page);
  ctx.check(`${n}: … and zooms the map out to it`, z0 !== null && z1 !== null && z1 < z0, `${z0} → ${z1}`);
  const fit = await page.locator("path.map-region-focus").first().boundingBox();
  const mapBox = await page.locator(".map-canvas").boundingBox();
  ctx.check(`${n}: … the area fills the map`, fit.width > mapBox.width * 0.4 || fit.height > mapBox.height * 0.4, JSON.stringify(fit));

  // The province is allowed (recommended), drawn above Belgium: a click inside it, off the pin, picks its row.
  await page.locator('li.region-row[data-code="be-vov"] .region-name').click();
  await page.waitForTimeout(400);
  const prov = await page.locator("path.map-region-focus").first().boundingBox();
  await page.locator('li.region-row[data-code="be-vov"] .region-name').click();
  ctx.check(`${n}: a second click on the name lets go`, (await focusedRows(page)) === "", await focusedRows(page));
  const x = prov.x + prov.width * 0.3;
  const y = prov.y + prov.height * 0.5;
  await page.mouse.click(x, y);
  await page.waitForTimeout(300);
  ctx.check(`${n}: a click on the province's area lights its row`, (await focusedRows(page)) === "be-vov", await focusedRows(page));
  const inView = await page.locator('li.region-row[data-code="be-vov"]').evaluate((li) => {
    const r = li.getBoundingClientRect();
    const p = li.closest(".panel-body").getBoundingClientRect();
    return r.top >= p.top && r.bottom <= p.bottom;
  });
  ctx.check(`${n}: … and brings the row into view`, inView);
  await page.mouse.click(x, y);
  await page.waitForTimeout(300);
  ctx.check(`${n}: a second click on the area lets go`, (await focusedRows(page)) === "", await focusedRows(page));
  ctx.check(`${n}: no page errors`, !page.errors.length, page.errors.join("; "));
  await page.close();
}
