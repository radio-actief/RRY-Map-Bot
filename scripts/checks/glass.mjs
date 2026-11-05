// House style: glass over the map, its solid fallback, focus rings, field borders, disabled buttons
// and the rim around single nodes, in both themes.
import { openConfigurator } from "./fixtures/configurator.mjs";
import { mockStats } from "./fixtures/mock-stats.mjs";

const nodes = Array.from({ length: 12 }, (_, i) => {
  const key = (i + 1).toString(16).padStart(2, "0").repeat(32);
  return {
    adv_name: `Glass node ${i + 1}`,
    adv_lat: 50.6 + (i % 4) * 0.4,
    adv_lon: 3.5 + Math.floor(i / 4) * 0.8,
    city: "Gent",
    public_key: key,
    inserted_by: key,
    updated_by: key,
    inserted_date: new Date().toISOString(),
    updated_date: new Date().toISOString(),
    last_advert: new Date().toISOString(),
    link: `meshcore://11${key}`,
    params: { bw: 62.5, cr: 8, freq: 869.618, sf: 8 },
    source: "app",
    type: (i % 4) + 1,
  };
});
const withNodes = async (p) => {
  await p.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(nodes) }));
};

const GLASS = { light: "rgba(255, 255, 255, 0.82)", dark: "rgba(26, 32, 44, 0.82)" };
const PANEL = { light: "rgb(255, 255, 255)", dark: "rgb(26, 32, 44)" };
const FOCUS = { light: "rgb(17, 89, 175)", dark: "rgb(255, 255, 0)" };
const FIELD = { light: "rgb(100, 116, 139)", dark: "rgb(160, 174, 192)" };
const RIM = { light: "rgb(26, 32, 44)", dark: "rgb(237, 242, 247)" };

const look = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const c = getComputedStyle(el);
    return { bg: c.backgroundColor, blur: c.backdropFilter || c.webkitBackdropFilter, border: c.borderTopColor, shadow: c.boxShadow };
  }, sel);

const isGlass = (l, scheme) => !!l && l.bg === GLASS[scheme] && /blur\(14px\)/.test(l.blur || "");

/** Tab until the element matching sel has keyboard focus; returns its outline colour. */
async function tabTo(page, sel, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate((s) => {
      const a = document.activeElement;
      if (!a || !a.matches(s)) return null;
      const c = getComputedStyle(a);
      return { color: c.outlineColor, style: c.outlineStyle, width: c.outlineWidth, offset: c.outlineOffset };
    }, sel);
    if (hit) return hit;
  }
  return null;
}

export default async function (ctx) {
  for (const scheme of ["light", "dark"]) {
    const n = `glass (${scheme})`;
    const page = await ctx.open("/", { scheme, setup: withNodes });
    await page.waitForSelector(".svg-node-icon", { timeout: 10000 }).catch(() => {});

    ctx.check(`${n}: map search box is glass`, isGlass(await look(page, ".search-box"), scheme), JSON.stringify(await look(page, ".search-box")));
    const bar = await look(page, ".topbar");
    ctx.check(`${n}: top bar stays solid ink`, bar && bar.bg === "rgb(26, 32, 44)", JSON.stringify(bar));
    const field = await look(page, ".search-row .input");
    ctx.check(`${n}: the search field is solid with a field border`, field && field.bg === PANEL[scheme] && field.border === FIELD[scheme], JSON.stringify(field));
    for (const [what, sel] of [["initials", ".svg-node-icon"], ["pictogram", "img.node-icon"]]) {
      const rim = await look(page, sel);
      ctx.check(`${n}: a single node (${what}) has a 2px rim`, !!rim && rim.shadow.includes(RIM[scheme]) && /2px/.test(rim.shadow), JSON.stringify(rim));
    }

    // Keyboard focus: the theme ring in the work area, yellow on the bar.
    const workFocus = await tabTo(page, ".search-row .input");
    ctx.check(`${n}: focus ring on the search field`, workFocus && workFocus.color === FOCUS[scheme] && workFocus.width === "2px", JSON.stringify(workFocus));
    await page.evaluate(() => document.activeElement.blur());
    await page.locator(".topbar").focus().catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.click(1, 1);
    const onYellow = await tabTo(page, '.switcher a[aria-current="page"]');
    ctx.check(`${n}: focus ring on the yellow current page is ink`, onYellow && onYellow.color === "rgb(26, 32, 44)", JSON.stringify(onYellow));
    const barFocus = await tabTo(page, '.topbar a:not([aria-current]), .topbar button:not([aria-pressed="true"])');
    ctx.check(`${n}: focus ring on the top bar is yellow`, barFocus && barFocus.color === "rgb(255, 255, 0)", JSON.stringify(barFocus));

    // The ☰ menu is glass in the theme's colours.
    await page.locator("[data-page-menu] .icon, [data-page-menu] button").first().click();
    await page.waitForTimeout(200);
    const menu = await look(page, "[data-page-menu] .menu");
    ctx.check(`${n}: the ☰ menu is glass`, isGlass(menu, scheme), JSON.stringify(menu));
    await page.keyboard.press("Escape");

    // A node popup is glass, and its card lets the glass show through.
    await page.locator(".svg-node-icon").first().click();
    await page.waitForSelector(".leaflet-popup-content-wrapper", { timeout: 10000 }).catch(() => {});
    const popup = await look(page, ".leaflet-popup-content-wrapper");
    const card = await look(page, ".node-popup");
    ctx.check(`${n}: a node popup is glass`, isGlass(popup, scheme) && card && card.bg === "rgba(0, 0, 0, 0)", JSON.stringify({ popup, card: card && card.bg }));
    ctx.check(`${n}: no page errors`, !page.errors.length, page.errors.join("; "));
    await page.close();
  }

  // No backdrop-filter, or reduced transparency asked for: solid panels and a solid bar.
  const solid = await ctx.open("/", { setup: withNodes });
  const cdp = await solid.context().newCDPSession(solid);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  const s = await look(solid, ".search-box");
  ctx.check("glass: reduced transparency gives solid panels without blur", s && s.bg === PANEL.light && (!s.blur || s.blur === "none"), JSON.stringify(s));
  await solid.close();

  // Disabled buttons: no hover, not-allowed cursor, muted text.
  const disabled = await ctx.open("/", { setup: withNodes });
  const d = await disabled.evaluate(() => {
    const b = document.createElement("button");
    b.className = "btn primary";
    b.disabled = true;
    b.textContent = "x";
    document.body.appendChild(b);
    const c = getComputedStyle(b);
    return { cursor: c.cursor, bg: c.backgroundColor, color: c.color };
  });
  ctx.check("glass: a disabled button reads disabled", d.cursor === "not-allowed" && d.bg === "rgb(247, 250, 252)" && d.color === "rgb(100, 116, 139)", JSON.stringify(d));
  await disabled.close();

  // A pressed button in dark keeps a 1px gold ring: the 2px yellow ring means keyboard focus only.
  const pressed = await ctx.open("/", { scheme: "dark", setup: withNodes });
  const ring = await pressed.evaluate(() => {
    const g = document.createElement("div");
    g.className = "segmented";
    g.innerHTML = '<button aria-pressed="true">a</button><button aria-pressed="false">b</button>';
    document.body.appendChild(g);
    return getComputedStyle(g.firstChild).boxShadow;
  });
  ctx.check("glass: a pressed button in dark has a 1px gold ring, not yellow", ring.includes("rgb(212, 160, 23)") && /0px 0px 0px 1px inset|inset 0px 0px 0px 1px/.test(ring), ring);
  await pressed.close();

  // Ink-filled pressed buttons: a yellow focus ring inside the fill, in light too (blue on ink was 2.39:1).
  const inkRing = async (page, sel) => {
    await page.keyboard.press("Tab");
    return page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      el.focus();
      const c = getComputedStyle(el);
      return { color: c.outlineColor, offset: c.outlineOffset };
    }, sel);
  };
  const statsPage = await ctx.open("/stats", { setup: (p) => mockStats(p) });
  const r1 = await tabTo(statsPage, '#stats-range button[aria-pressed="true"]', 80);
  ctx.check("glass: focus on a pressed ink button (stats range) is yellow inside", r1 && r1.color === "rgb(255, 255, 0)" && r1.offset === "-2px", JSON.stringify(r1));
  // Stats map: the container clips, so its ring sits inside.
  const sm = await statsPage.evaluate(() => {
    const m = document.getElementById("stats-map");
    m.setAttribute("tabindex", "0");
    return true;
  });
  const r2 = sm && (await tabTo(statsPage, "#stats-map", 120));
  ctx.check("glass: the stats map focus ring sits inside its container", r2 && r2.offset === "-2px", JSON.stringify(r2));
  // The custom radio fields in the Preset menu get the field border.
  const cf2 = await statsPage.evaluate(() => {
    const el = document.getElementById("stats-custom-freq");
    return el && getComputedStyle(el).borderTopColor;
  });
  ctx.check("glass: stats custom radio fields get the field border", cf2 === FIELD.light, String(cf2));
  await statsPage.close();

  const confFocus = await openConfigurator(ctx);
  const r3 = await inkRing(confFocus, '.task-tabs button[aria-selected="true"]');
  ctx.check("glass: focus on the selected configurator tab is yellow inside", r3 && r3.color === "rgb(255, 255, 0)" && r3.offset === "-2px", JSON.stringify(r3));
  await confFocus.close();

  // The map credit line is solid in dark, so its text and focus ring read.
  const credit = await ctx.open("/", { scheme: "dark", setup: withNodes });
  const at = await look(credit, ".leaflet-control-attribution");
  ctx.check("glass: the map credit line is solid in dark", at && at.bg === PANEL.dark, JSON.stringify(at));
  // Filters on the glass search box: no fill of its own, a field border.
  const ft = await look(credit, ".search-box .filter-toggle");
  ctx.check("glass: Filters on the glass search box has no fill and a field border", ft && ft.bg === "rgba(0, 0, 0, 0)" && ft.border === FIELD.dark, JSON.stringify(ft));
  // The About box's Close button on glass: no fill of its own, a field border.
  await credit.evaluate(() => window.BEmeshAbout.open());
  await credit.waitForSelector(".about-dialog .about-foot .btn");
  const ab = await look(credit, ".about-dialog .about-foot .btn");
  ctx.check("glass: the About box's Close button has no fill and a field border", ab && ab.bg === "rgba(0, 0, 0, 0)" && ab.border === FIELD.dark, JSON.stringify(ab));
  await credit.close();

  // On a phone the search box keeps its glass fill but drops the blur; the desktop keeps the blur.
  const phoneMap = await ctx.open("/", { width: 390, height: 844, setup: withNodes });
  const pb = await look(phoneMap, ".search-box");
  ctx.check("glass: the phone search box has the glass fill without blur", pb && pb.bg === GLASS.light && (!pb.blur || pb.blur === "none"), JSON.stringify(pb));
  await phoneMap.close();

  // Stats: the playback legend over its map is glass.
  const stats = await ctx.open("/stats");
  ctx.check("glass: stats playback legend is glass", isGlass(await look(stats, "#playback-legend"), "light"), JSON.stringify(await look(stats, "#playback-legend")));
  await stats.close();

  // Region map: the search suggestions are glass.
  const region = await ctx.open("/region-map");
  ctx.check("glass: region map suggestions are glass", isGlass(await look(region, "#autocomplete"), "light"), JSON.stringify(await look(region, "#autocomplete")));
  await region.close();

  // Configurator: the layer switches over the map are glass, fields get the field border.
  const conf = await openConfigurator(ctx);
  await conf.waitForSelector(".map-layers");
  ctx.check("glass: configurator layer switches are glass", isGlass(await look(conf, ".map-layers"), "light"), JSON.stringify(await look(conf, ".map-layers")));
  await conf.getByRole("button", { name: /Continue without a device/ }).click();
  await conf.waitForSelector(".search input, .coord-row input");
  const cf = await look(conf, ".coord-row input");
  ctx.check("glass: configurator fields get the field border", cf && cf.border === FIELD.light, JSON.stringify(cf));
  ctx.check("glass: configurator no page errors", !conf.errors.length, conf.errors.join("; "));
  await conf.close();

  // Configurator in dark: Leaflet's own stylesheet loads after ours there, and must not win on the
  // tooltip text or the credit line.
  const confDark = await openConfigurator(ctx);
  await confDark.emulateMedia({ colorScheme: "dark" });
  await confDark.waitForTimeout(200);
  const cd = await confDark.evaluate(() => {
    const host = document.querySelector(".leaflet-container");
    const tip = document.createElement("div");
    tip.className = "leaflet-tooltip";
    tip.textContent = "BE-GEN-Check";
    host.appendChild(tip);
    const attr = document.querySelector(".leaflet-control-attribution");
    return { tip: getComputedStyle(tip).color, attrBg: attr && getComputedStyle(attr).backgroundColor, attrInk: attr && getComputedStyle(attr).color };
  });
  ctx.check("glass: configurator tooltip text is light in dark", cd.tip === "rgb(237, 242, 247)", JSON.stringify(cd));
  ctx.check("glass: configurator credit line is solid in dark", cd.attrBg === PANEL.dark && cd.attrInk === "rgb(237, 242, 247)", JSON.stringify(cd));
  await confDark.close();

  // On a touch screen a tapped button keeps its own gold: no hover look stuck after the tap.
  const phone = await openConfigurator(ctx, { phone: true });
  const primary = phone.locator(".panel-foot .btn.primary");
  await primary.tap();
  await phone.waitForTimeout(300);
  const tapped = await phone.locator(".panel-foot .btn.primary").evaluate((b) => getComputedStyle(b).backgroundColor);
  ctx.check("glass: a tapped button on a phone shows no hover gold", tapped === "rgb(212, 160, 23)", tapped);
  await phone.close();
}
