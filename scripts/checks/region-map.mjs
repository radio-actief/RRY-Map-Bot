// Region map: top bar, panel controls, province layer, and no horizontal scroll on a phone.
// The map is MapLibre's where the browser has WebGL, Leaflet's without: the checks take either.

/** How many areas (provinces, gewesten, countries) the map draws. */
const areaCount = (page) =>
  page.evaluate(() => {
    const m = window.bemeshMap;
    if (!m) return 0;
    if (m.kind !== "maplibre") return document.querySelectorAll(".leaflet-overlay-pane path.leaflet-interactive").length;
    const layers = m.map.getStyle().layers.map((l) => l.id).filter((id) => /^bemesh-o\d+-fill$/.test(id));
    return new Set(m.map.queryRenderedFeatures({ layers }).map((f) => f.properties.i)).size;
  });
const waitForAreas = (page) => page.waitForFunction(() => window.bemeshMap && document.querySelector("#counter-text")?.textContent, null, { timeout: 15000 }).then(() => page.waitForTimeout(800)).catch(() => {});
/** A click on the map at a place (inside the area there). */
async function clickAt(page, spot) {
  const p = await page.evaluate((s) => window.bemeshMap.project(s), spot);
  const box = await page.locator("#region-map-container").boundingBox();
  await page.mouse.click(box.x + p.x, box.y + p.y);
}
const POPUP = ":is(.leaflet-popup, .bemesh-popup)";

export default async function (ctx) {
  const page = await ctx.open("/region-map");
  await waitForAreas(page);

  const wordmark = await page.locator(".topbar .wordmark").first().textContent().catch(() => "");
  ctx.check("region map: wordmark", (wordmark || "").replace(/\s+/g, " ").trim() === "#BEmesh region map", wordmark);
  const current = await page.locator('.switcher a[aria-current="page"]').allTextContents();
  ctx.check("region map: Region map is the current page", current.length === 1 && current[0].trim() === "Region map", current.join("|"));

  const input = page.locator("#code-input");
  ctx.check("region map: search is empty", (await input.inputValue().catch(() => "x")) === "");
  ctx.check("region map: search placeholder", (await input.getAttribute("placeholder").catch(() => "")) === "Search city, province or region");

  const labels = await page.locator(".segmented button").allTextContents();
  ctx.check("region map: border buttons", labels.map((s) => s.trim()).join(",") === "Off,Provinces,Gewesten,Countries", labels.join(","));
  const pressed = await page.locator('.segmented button[aria-pressed="true"]').allTextContents();
  ctx.check("region map: Provinces is pressed", pressed.length === 1 && pressed[0].trim() === "Provinces", pressed.join(","));
  ctx.check("region map: Location points is checked", await page.locator("#show-places").isChecked().catch(() => false));

  const be = (await page.locator(`.hierarchy-node[data-code="be"]`).first().innerText().catch(() => "")) || "";
  ctx.check("region map: Belgium row shows be and a number", /\bbe\b/.test(be) && /\d/.test(be), be.trim());
  const eu = (await page.locator(`.hierarchy-node[data-code="eu"] .region-meta`).first().innerText().catch(() => "")) || "";
  ctx.check("region map: the EU row reads wider region", eu.trim() === "eu · wider region", eu.trim());
  const paths = await areaCount(page);
  ctx.check("region map: at least 10 province areas", paths >= 10, String(paths));
  ctx.check("region map: search stays empty after load", (await input.inputValue().catch(() => "x")) === "");

  await page.getByRole("button", { name: "Gewesten" }).click();
  ctx.check("region map: Gewesten gets pressed", (await page.getByRole("button", { name: "Gewesten" }).getAttribute("aria-pressed")) === "true");
  ctx.check("region map: no page errors", !page.errors.length, page.errors.join("; "));
  await page.close();

  for (const scheme of ["light", "dark"]) {
    const p = await ctx.open("/region-map", { width: 390, height: 800, scheme });
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    ctx.check(`region map: no horizontal scroll at 390 (${scheme})`, w <= 390, String(w));
    await p.close();
  }

  // Dark mode: the popup frame and tip follow the theme, not the map library's white.
  const dark = await ctx.open("/region-map", { scheme: "dark" });
  await waitForAreas(dark);
  await clickAt(dark, { lat: 51.05, lon: 3.72 });
  await dark.waitForSelector(":is(.leaflet-popup-content-wrapper, .bemesh-popup .maplibregl-popup-content)", { timeout: 5000 }).catch(() => {});
  const bg = await dark.evaluate(() => {
    const w = document.querySelector(".leaflet-popup-content-wrapper, .bemesh-popup .maplibregl-popup-content");
    const t = document.querySelector(".leaflet-popup-tip, .bemesh-popup .maplibregl-popup-tip");
    return { wrapper: w && getComputedStyle(w).backgroundColor, tip: t && getComputedStyle(t).backgroundColor };
  });
  const notWhite = (c) => !!c && c !== "rgb(255, 255, 255)";
  ctx.check("region map: dark popup wrapper and tip are not white", notWhite(bg.wrapper) && notWhite(bg.tip), JSON.stringify(bg));
  await dark.close();

  // ☰ stays on screen at 390 and Escape closes it, returning focus.
  const phone = await ctx.open("/region-map", { width: 390, height: 800 });
  await phone.locator("#menu-toggle").click();
  const rect = await phone.locator("#page-menu").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  });
  ctx.check("region map: ☰ menu stays on screen at 390", rect.width > 0 && rect.left >= 0 && rect.right <= 390, JSON.stringify(rect));
  await phone.keyboard.press("Escape");
  ctx.check("region map: Escape closes ☰ and returns focus", !(await phone.locator("#page-menu").isVisible()) && (await phone.locator("#menu-toggle").getAttribute("aria-expanded")) === "false" && (await phone.locator("#menu-toggle").evaluate((el) => el === document.activeElement)));
  await phone.close();

  // Rows are buttons, the highlight follows typing, and a collapsed panel leaves the tab order.
  const rows = await ctx.open("/region-map");
  await rows.waitForSelector(".hierarchy-node", { timeout: 8000 });
  const tags = await rows.locator(".hierarchy-node").evaluateAll((els) => [...new Set(els.map((e) => e.tagName + ":" + e.getAttribute("type")))]);
  ctx.check("region map: code rows are buttons", tags.join() === "BUTTON:button", tags.join());
  const province = rows.locator('.hierarchy-node[data-type="province"]').first();
  await province.focus();
  await rows.keyboard.press("Enter");
  ctx.check("region map: Enter on a row selects it", await province.evaluate((e) => e.classList.contains("active")));
  await rows.locator("#code-input").fill("zzzz");
  ctx.check("region map: typing clears the highlighted row", (await rows.locator(".hierarchy-node.active").count()) === 0);
  await rows.locator("#toggle-controls").click();
  await rows.waitForTimeout(400);
  const reachable = await rows.evaluate(() => {
    const el = document.getElementById("code-input");
    el.focus();
    return document.activeElement === el;
  });
  ctx.check("region map: a collapsed panel cannot take focus", !reachable);
  await rows.close();

  // A foreign country switches borders to Countries; Belgium or a Belgian province switches back to Provinces.
  const back = await ctx.open("/region-map");
  await back.waitForSelector(".hierarchy-node", { timeout: 8000 });
  const pressedBorder = () => back.locator('#overlay-seg button[aria-pressed="true"]').innerText();
  await back.locator('.hierarchy-node[data-code="nl"]').click();
  ctx.check("region map: a foreign country switches borders to Countries", (await pressedBorder()).trim() === "Countries", await pressedBorder());
  await back.locator('.hierarchy-node[data-code="be"]').click();
  ctx.check("region map: Belgium switches borders back to Provinces", (await pressedBorder()).trim() === "Provinces", await pressedBorder());
  await back.locator('.hierarchy-node[data-code="nl"]').click();
  await back.locator('.hierarchy-node[data-code="be-vov"]').click();
  ctx.check("region map: a Belgian province switches borders back to Provinces", (await pressedBorder()).trim() === "Provinces", await pressedBorder());
  await back.getByRole("button", { name: "Gewesten" }).click();
  await back.locator('.hierarchy-node[data-code="be-van"]').click();
  ctx.check("region map: a chosen Gewesten stays on a Belgian province", (await pressedBorder()).trim() === "Gewesten", await pressedBorder());

  // The gewest popup lists its provinces as short name / code rows, not one squeezed column.
  await back.locator('.hierarchy-node[data-code="be"]').click();
  await back.getByRole("button", { name: "Gewesten" }).click();
  await back.waitForTimeout(800);
  // Flanders, between Ghent and Antwerp (no location point there to catch the click)
  let popup = null;
  for (const spot of [{ lat: 51.12, lon: 4.05 }, { lat: 50.4, lon: 4.9 }]) {
    await clickAt(back, spot);
    await back.waitForTimeout(300);
    if (await back.locator(POPUP).count()) {
      popup = back.locator(POPUP).first();
      break;
    }
  }
  const popupText = popup ? await popup.innerText() : "";
  const popupHeight = popup ? (await popup.boundingBox()).height : 0;
  ctx.check("region map: the gewest popup opens", !!popup);
  ctx.check("region map: the gewest popup has no long label", !/optional under gewest/.test(popupText), popupText);
  ctx.check("region map: the gewest popup lists provinces with their codes", /\bbe-(van|wht)\b/.test(popupText), popupText);
  ctx.check("region map: the gewest popup stays compact", popupHeight > 0 && popupHeight < 320, String(popupHeight));
  await back.close();
}
