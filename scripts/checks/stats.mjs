// Stats page: top bar, tiles, range buttons, chart colours, cards, and no horizontal scroll on a phone.
// The local database may have no sync history, so the stats endpoints come from the public site once.
const LIVE = "https://meshmap.radio-actief.be";
const cache = new Map();

async function liveJson(path) {
  if (!cache.has(path)) {
    const res = await fetch(LIVE + path);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    cache.set(path, await res.text());
  }
  return cache.get(path);
}

async function mockStats(page) {
  for (const path of ["/api/v1/stats", "/api/v1/sync-history", "/api/v1/node-changes"]) {
    await page.route(`**${path}*`, async (route) => {
      const url = new URL(route.request().url());
      const body = path === "/api/v1/node-changes" ? "[]" : await liveJson(url.pathname + (url.search || ""));
      await route.fulfill({ contentType: "application/json", body });
    });
  }
}

const open = (ctx, opts = {}) => ctx.open("/stats", { ...opts, setup: mockStats });
const ready = (page) => page.waitForSelector("#stats-chart .apexcharts-yaxis-label", { timeout: 15000 }).catch(() => {});
const text = async (loc) => ((await loc.allTextContents()).map((s) => s.replace(/\s+/g, " ").trim()));
const categories = (page) => page.evaluate(() => window.__statsChartInstance?.w.globals.labels.length ?? -1);

export default async function (ctx) {
  const page = await open(ctx);
  await ready(page);

  const wordmark = await page.locator(".topbar .wordmark").first().textContent().catch(() => "");
  ctx.check("stats: wordmark", (wordmark || "").replace(/\s+/g, " ").trim() === "#BEmesh stats", wordmark);
  const current = await text(page.locator('.switcher a[aria-current="page"]'));
  ctx.check("stats: Stats is the current page", current.length === 1 && current[0] === "Stats", current.join("|"));

  const chip = page.locator("#stats-filter-menu-trigger");
  ctx.check("stats: preset chip reads Preset: All", /^Preset: All/.test((await text(chip))[0] || ""), (await text(chip)).join("|"));
  ctx.check("stats: preset list starts closed", !(await page.locator("#stats-preset-dropdown").isVisible()));
  await chip.click();
  const presets = await page.locator("#stats-preset-dropdown button").count();
  ctx.check("stats: Preset chip opens the preset list", (await page.locator("#stats-preset-dropdown").isVisible()) && presets > 1, String(presets));
  ctx.check("stats: custom radio filter is inside", (await page.locator("#stats-preset-custom-root").count()) === 1);
  await page.mouse.click(5, 400);
  ctx.check("stats: a click outside closes the preset list", !(await page.locator("#stats-preset-dropdown").isVisible()));

  await page.locator("#stats-download-btn").click();
  const links = await page.locator("#stats-download-menu a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  ctx.check(
    "stats: download menu has the 4 JSON links",
    links.join(",") === "/api/v1/companions/contacts,/api/v1/repeaters/contacts,/api/v1/room-servers/contacts,/api/v1/sensors/contacts",
    links.join(","),
  );
  await page.mouse.click(5, 400);

  const labels = await text(page.locator(".stats-tiles .tile .tile-label"));
  ctx.check("stats: tile labels in order", labels.join(",") === "Network,Companions,Repeaters,Rooms,Sensors,New · 1d / 7d / 30d,Claimed,Discord users", labels.join(","));
  const newTile = (await text(page.locator("#stats-chip-new")))[0] || "";
  ctx.check("stats: New tile reads a · b · c", /^[\d,]+ · [\d,]+ · [\d,]+$/.test(newTile), newTile);
  ctx.check("stats: Network tile has the gold highlight", await page.locator(".tile.is-hero").count() === 1);
  const total = (await text(page.locator("#stats-chip-total")))[0];
  ctx.check("stats: Network number is filled", /\d/.test(total || ""), total);

  const range = await text(page.locator("#stats-range button"));
  ctx.check("stats: range buttons", range.join(",") === "7d,Month,3m,6m,YTD,1y,All", range.join(","));
  const pressed = await text(page.locator('#stats-range button[aria-pressed="true"]'));
  ctx.check("stats: Month is pressed", pressed.join(",") === "Month", pressed.join(","));
  const before = await categories(page);
  await page.locator("#stats-range button", { hasText: "7d" }).click();
  await page.waitForTimeout(800);
  const after = await categories(page);
  const pressed2 = await text(page.locator('#stats-range button[aria-pressed="true"]'));
  ctx.check("stats: clicking 7d presses it", pressed2.join(",") === "7d", pressed2.join(","));
  ctx.check("stats: clicking 7d re-renders the chart", before > 0 && after > 0 && before !== after, `${before} -> ${after}`);
  await page.locator("#stats-range button", { hasText: "Month" }).click();

  for (const title of ["Changes", "Timeline playback", "Top cities", "Most repeaters added", "Links"]) {
    const h = await text(page.locator(".card h2", { hasText: title }));
    ctx.check(`stats: card "${title}" exists`, h.some((s) => s.startsWith(title)), h.join("|"));
  }
  ctx.check("stats: city rows are listed", (await page.locator("#stats-summary-cities li").count()) > 0);
  ctx.check("stats: links card has the three groups", (await page.locator(".stats-links-group").count()) === 3);
  ctx.check("stats: footnote is present", /synced from the official/.test((await page.locator(".stats-footer-note").textContent()) || ""));
  ctx.check("stats: no page errors", !page.errors.length, page.errors.join("; "));
  await page.close();

  const dark = await open(ctx, { scheme: "dark" });
  await ready(dark);
  const axis = await dark.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--mut)";
    document.body.appendChild(probe);
    const mut = getComputedStyle(probe).color;
    probe.remove();
    const label = document.querySelector("#stats-chart .apexcharts-yaxis-label");
    return { mut, fill: label ? getComputedStyle(label).fill : null };
  });
  ctx.check("stats: dark chart axis label equals --mut", !!axis.fill && axis.fill === axis.mut, `${axis.fill} vs ${axis.mut}`);
  // Switching the theme while the page is open re-renders the chart.
  await dark.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await dark.waitForTimeout(1200);
  const light = await dark.evaluate(() => {
    const label = document.querySelector("#stats-chart .apexcharts-yaxis-label");
    const probe = document.createElement("span");
    probe.style.color = "var(--mut)";
    document.body.appendChild(probe);
    const mut = getComputedStyle(probe).color;
    probe.remove();
    return { mut, fill: label ? getComputedStyle(label).fill : null };
  });
  ctx.check("stats: chart follows a theme switch", !!light.fill && light.fill === light.mut && light.mut !== axis.mut, `${light.fill} vs ${light.mut}`);
  ctx.check("stats: no page errors in dark", !dark.errors.length, dark.errors.join("; "));
  await dark.close();

  for (const scheme of ["light", "dark"]) {
    const p = await open(ctx, { width: 390, height: 800, scheme });
    await ready(p);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    ctx.check(`stats: no horizontal scroll at 390 (${scheme})`, w <= 390, String(w));
    await p.close();
  }
}
