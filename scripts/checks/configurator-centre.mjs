// Configurator: a chosen place lands in the middle of the part of the map you can see, not behind
// the step panel (the phone sheet below, the docked panel on the left).
import { openConfigurator, searchPlace, stub } from "./fixtures/configurator.mjs";

/** The pin's tip against the centre of the map area the panel leaves visible. */
const offset = (page) =>
  page.evaluate(() => {
    const map = document.querySelector(".map-canvas").getBoundingClientRect();
    const panel = document.querySelector(".panel.docked, .panel.sheet");
    const p = panel ? panel.getBoundingClientRect() : null;
    let { left, right, top, bottom } = map;
    if (p && panel.classList.contains("docked")) left = Math.max(left, p.right);
    if (p && panel.classList.contains("sheet")) bottom = Math.min(bottom, p.top);
    const pin = document.querySelector(".map-pin").getBoundingClientRect();
    const tip = { x: pin.left + pin.width / 2, y: pin.bottom };
    return { dx: Math.round(tip.x - (left + right) / 2), dy: Math.round(tip.y - (top + bottom) / 2), visible: { left, right, top, bottom } };
  });

/** Share of the visible map (above the sheet) the focused outline fills, and the sheet's state. */
const outlineFill = (page) =>
  page.evaluate(() => {
    const map = document.querySelector(".map-canvas").getBoundingClientRect();
    const sheet = document.querySelector(".panel.sheet");
    const bottom = sheet ? Math.min(map.bottom, sheet.getBoundingClientRect().top) : map.bottom;
    const visible = (bottom - map.top) * map.width;
    let box = null;
    for (const p of document.querySelectorAll("path.map-region-focus")) {
      const r = p.getBoundingClientRect();
      box = box ? { l: Math.min(box.l, r.left), t: Math.min(box.t, r.top), r: Math.max(box.r, r.right), b: Math.max(box.b, r.bottom) } : { l: r.left, t: r.top, r: r.right, b: r.bottom };
    }
    if (!box) return { fill: 0, w: 0, h: 0, sheet: sheet?.className };
    const w = Math.max(0, Math.min(box.r, map.right) - Math.max(box.l, map.left));
    const h = Math.max(0, Math.min(box.b, bottom) - Math.max(box.t, map.top));
    return { fill: Math.round((100 * w * h) / visible), w: Math.round(w), h: Math.round(h), visible: `${Math.round(map.width)}x${Math.round(bottom - map.top)}`, sheet: sheet?.className };
  });

export default async function (ctx) {
  // Companion page on a phone: the sheet stays full after picking a place (the channels are what
  // people came for). The outline must not be a speck: once the sheet is lowered, it refits into
  // the map that shows.
  {
    const n = "configurator centre (Companion, 390, sheet full)";
    const page = await ctx.browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    await stub(page);
    await page.goto(ctx.base + "/join", { waitUntil: "networkidle" });
    await page.waitForSelector(".step-companion h2");
    const box = page.getByRole("combobox", { name: "Search a town or province" });
    await box.tap();
    await box.fill("Oostende");
    await page.getByRole("option").first().tap();
    await page.waitForSelector("path.map-region-focus");
    await page.waitForTimeout(800);
    const before = await outlineFill(page);
    ctx.check(`${n}: the sheet stays full with the channels`, /\bfull\b/.test(before.sheet || ""), JSON.stringify(before));
    await page.locator(".grab").tap(); // full → peek
    await page.waitForTimeout(800);
    // Reference: the outline was 182x195 px on 1.0.4's code; the next zoom step no longer fits the
    // phone's width. Under 150 px it has shrunk (the regression made it 23x24).
    const readable = (f) => f.w >= 150 && f.h >= 150;
    const lowered = await outlineFill(page);
    ctx.check(`${n}: lowered by hand, the outline is readable in the visible map`, readable(lowered) && /\bpeek\b/.test(lowered.sheet || ""), JSON.stringify(lowered));
    await page.locator(".grab").tap(); // peek → half
    await page.waitForTimeout(800);
    const half = await outlineFill(page);
    ctx.check(`${n}: at half the outline is readable in the visible map`, readable(half) && /\bhalf\b/.test(half.sheet || ""), JSON.stringify(half));
    ctx.check(`${n}: no page errors`, !page.errors.length, page.errors.join("; "));
    await page.close();
  }

  for (const phone of [true, false]) {
    const n = `configurator centre (${phone ? "390" : "desktop"})`;
    const page = await openConfigurator(ctx, { phone });
    await page.getByRole("button", { name: /Continue without a device/ }).click();
    await searchPlace(page, "Gent", { tap: phone });
    await page.waitForSelector(".map-pin");
    await page.waitForTimeout(600);
    const o = await offset(page);
    ctx.check(`${n}: a searched place lands in the middle of the visible map`, Math.abs(o.dx) <= 12 && Math.abs(o.dy) <= 12, JSON.stringify(o));
    ctx.check(`${n}: no page errors`, !page.errors.length, page.errors.join("; "));
    await page.close();
  }
}
