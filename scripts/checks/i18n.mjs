// Site translations: each page in Dutch and French via ?lang, <html lang>, the EN · NL · FR switch,
// and the layout in all three languages (390 px: no horizontal scroll, the switch in ☰; the top bar on
// one line at 390 and 1440 px; no clipped buttons).
import { mockStats } from "./fixtures/mock-stats.mjs";

const text = (s) => (s || "").replace(/\s+/g, " ").trim();
const HTML_LANG = { en: "en", nl: "nl-BE", fr: "fr-FR" };
const FIRST_LINK = { en: "Map", nl: "Kaart", fr: "Carte" };

// The local database is empty, so the map gets a few synthetic nodes (with a long-named Brussels city).
const key = "ab".repeat(32);
const nodes = Array.from({ length: 12 }, (_, i) => ({
  adv_name: `Check node ${i + 1}`,
  adv_lat: 50.6 + i * 0.05,
  adv_lon: 4.2 + i * 0.05,
  city: i === 0 ? "Elsene" : "Gent",
  public_key: i === 0 ? key : (i + 1).toString(16).padStart(2, "0").repeat(32),
  link: `meshcore://11${key}`,
  params: { bw: 62.5, cr: 8, freq: 869.618, sf: 8 },
  inserted_date: new Date(Date.now() - i * 86400000).toISOString(),
  updated_date: new Date(Date.now() - i * 86400000).toISOString(),
  last_advert: new Date(Date.now() - i * 86400000).toISOString(),
  source: "uploader",
  type: (i % 4) + 1,
}));

const setup = (path) => async (p) => {
  await p.route("**/auth/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: false }) }));
  await p.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(nodes) }));
  if (path === "/stats") await mockStats(p);
};

/** A page-specific text in each language: selector and expected text per language. */
const PAGES = {
  "/": {
    sel: "#search-nodes-input",
    attr: "placeholder",
    want: { en: "Search nodes, name or key", nl: "Zoek nodes, naam of sleutel", fr: "Chercher des nœuds, nom ou clé" },
  },
  "/stats": { sel: ".stats-chart h2", want: { en: "Changes", nl: "Wijzigingen", fr: "Évolution" } },
  "/region-map": { sel: "#borders-label", want: { en: "Borders", nl: "Grenzen", fr: "Frontières" } },
  "/configurator": {
    sel: ".step-connect h2",
    want: { en: "Connect your repeater", nl: "Verbind je repeater", fr: "Connectez votre répéteur" },
  },
};

async function ready(page) {
  await page.waitForSelector(".topbar .switcher a", { state: "attached" });
  await page.waitForSelector(".topbar .lang-switch button", { state: "attached" });
  await page.waitForSelector("#menu-toggle");
}

async function pageText(page, spec) {
  const el = page.locator(spec.sel).first();
  await el.waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
  return text(spec.attr ? await el.getAttribute(spec.attr).catch(() => "") : await el.textContent().catch(() => ""));
}

/** Buttons and chips whose content is cut off (truncating chips and the stepper's screen-reader-only names excepted). */
async function clipped(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("button, .chip, .switcher a, .segmented button, .lang-switch button")]
      .filter((el) => el.offsetParent !== null && !el.closest(".trunc, .leaflet-control, .apexcharts-canvas"))
      .filter((el) => getComputedStyle(el).textOverflow !== "ellipsis" && !el.querySelector(".sr"))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}: ${el.textContent.trim().slice(0, 30)}`),
  );
}

/** Whether the visible top bar items share one row: together no taller than the tallest of them. */
async function oneLine(page) {
  return page.evaluate(() => {
    const rects = [...document.querySelector(".topbar").children]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const tallest = Math.max(...rects.map((r) => r.height));
    return { ok: bottom - top <= tallest + 2, span: bottom - top, tallest };
  });
}

export default async function (ctx) {
  for (const [path, spec] of Object.entries(PAGES)) {
    for (const lang of ["nl", "fr"]) {
      const name = `i18n ${path} ?lang=${lang}`;
      const page = await ctx.open(`${path}?lang=${lang}`, { setup: setup(path) });
      await ready(page);
      ctx.check(`${name}: <html lang>`, (await page.evaluate(() => document.documentElement.lang)) === HTML_LANG[lang]);
      const first = text(await page.locator(".topbar .switcher a").first().textContent());
      ctx.check(`${name}: top bar in ${lang}`, first === FIRST_LINK[lang], first);
      const own = await pageText(page, spec);
      ctx.check(`${name}: page text in ${lang}`, own === spec.want[lang], own);
      const pressed = await page.locator('.topbar .lang-switch:not(.menu-lang) button[aria-pressed="true"]').textContent();
      ctx.check(`${name}: the switch marks ${lang.toUpperCase()}`, text(pressed) === lang.toUpperCase(), pressed);
      ctx.check(`${name}: ?lang is remembered`, (await page.evaluate(() => localStorage.getItem("bemesh.lang"))) === lang);
      ctx.check(`${name}: no page errors`, !page.errors.length, page.errors.join("; "));

      // The switch: EN puts the page (and the ?lang in the address) back in English.
      if (lang === "nl") {
        await page.locator(".topbar .lang-switch:not(.menu-lang) button", { hasText: "EN" }).click();
        await page.waitForFunction(() => document.documentElement.lang === "en", null, { timeout: 15000 }).catch(() => {});
        await ready(page);
        await page.waitForFunction((want) => document.querySelector(".topbar .switcher a")?.textContent.trim() === want, "Map", { timeout: 15000 }).catch(() => {});
        const after = text(await page.locator(".topbar .switcher a").first().textContent());
        const own2 = await pageText(page, spec);
        const where = await page.evaluate(() => [location.search, localStorage.getItem("bemesh.lang")]);
        ctx.check(
          `${name}: EN switches the page to English`,
          after === "Map" && own2 === spec.want.en && where[0].includes("lang=en") && where[1] === "en",
          `${after} | ${own2} | ${where.join(" ")}`,
        );
      }
      await page.close();
    }
  }

  // Remembered without ?lang, and the browser language on a first visit.
  const stored = await ctx.open("/region-map", { setup: async (p) => { await setup("/region-map")(p); await p.addInitScript(() => localStorage.setItem("bemesh.lang", "fr")); } });
  await ready(stored);
  ctx.check("i18n: a stored choice applies without ?lang", (await stored.evaluate(() => document.documentElement.lang)) === "fr-FR");
  await stored.close();
  const browser = await ctx.open("/stats", { locale: "nl-BE", setup: setup("/stats") });
  await ready(browser);
  ctx.check("i18n: a first visit follows the browser language (nl-BE → nl)", text(await browser.locator(".topbar .switcher a").first().textContent()) === "Kaart");
  await browser.close();

  // A node popup and a Brussels municipality in French.
  const pop = await ctx.open(`/?node=${key}&lang=fr`, { setup: setup("/") });
  await pop.waitForSelector(".leaflet-popup", { timeout: 10000 }).catch(() => {});
  const popup = text(await pop.locator(".leaflet-popup").first().textContent().catch(() => ""));
  ctx.check("i18n: the node popup in French, with Elsene as Ixelles", popup.includes("Revendiquer") && popup.includes("Ixelles") && popup.includes("Radio"), popup.slice(0, 200));
  await pop.close();

  // Layout in every language.
  for (const path of Object.keys(PAGES)) {
    for (const lang of ["en", "nl", "fr"]) {
      const name = `i18n ${path} ${lang}`;
      const wide = await ctx.open(`${path}?lang=${lang}`, { setup: setup(path) });
      await ready(wide);
      await wide.waitForTimeout(300);
      const line = await oneLine(wide);
      ctx.check(`${name}: top bar on one line at 1440`, line.ok, JSON.stringify(line));
      const cut = await clipped(wide);
      ctx.check(`${name}: no clipped buttons at 1440`, !cut.length, cut.join(" | "));
      await wide.close();

      const phone = await ctx.open(`${path}?lang=${lang}`, { width: 390, height: 800, setup: setup(path) });
      await ready(phone);
      await phone.waitForTimeout(300);
      const w = await phone.evaluate(() => document.documentElement.scrollWidth);
      ctx.check(`${name}: no horizontal scroll at 390`, w <= 390, String(w));
      const line390 = await oneLine(phone);
      ctx.check(`${name}: top bar on one line at 390`, line390.ok, JSON.stringify(line390));
      const cut390 = await clipped(phone);
      ctx.check(`${name}: no clipped buttons at 390`, !cut390.length, cut390.join(" | "));
      ctx.check(`${name}: the bar switch is hidden at 390`, !(await phone.locator(".topbar .lang-switch:not(.menu-lang)").isVisible()));
      await phone.locator("#menu-toggle").click();
      const inMenu = await phone.locator("#page-menu .lang-switch").isVisible();
      const rect = await phone.locator("#page-menu").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      });
      ctx.check(`${name}: ☰ holds the switch at 390 and stays on screen`, inMenu && rect.left >= 0 && rect.right <= 390, JSON.stringify(rect));
      await phone.close();
    }
  }
}
