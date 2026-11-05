// Stats: on a phone the tiles fill their rows (Active spans the width, Claimed and Discord users
// share a row), and the chart's growth and decline bars use the status colours, apart from the
// repeater line's node green.
import { mockStats } from "./fixtures/mock-stats.mjs";

export default async function (ctx) {
  const page = await ctx.open("/stats", { width: 390, height: 844, setup: (p) => mockStats(p) });
  const box = (sel) => page.locator(sel).boundingBox();
  const grid = await box(".stats-tiles");
  const active = await box('.tile:has(#stats-chip-new)');
  const claimed = await box('.tile:has(#stats-chip-claimed)');
  const users = await box('.tile:has(#stats-chip-users)');
  ctx.check(
    "stats tiles (390): Active spans the width, Claimed and Discord users share a row",
    Math.abs(active.width - grid.width) < 2 && Math.abs(claimed.y - users.y) < 2 && users.x > claimed.x,
    JSON.stringify({ grid: grid.width, active: active.width, claimed: [claimed.x, claimed.y], users: [users.x, users.y] }),
  );
  await page.close();

  // Tablet (4 columns): no tile sits alone either.
  const tab = await ctx.open("/stats", { width: 820, height: 1000, setup: (p) => mockStats(p) });
  const rows = await tab.locator(".stats-tiles .tile").evaluateAll((tiles) => {
    const byRow = {};
    for (const t of tiles) {
      const r = t.getBoundingClientRect();
      (byRow[Math.round(r.top)] ||= []).push(Math.round(r.width));
    }
    return Object.values(byRow);
  });
  const gridW = (await tab.locator(".stats-tiles").boundingBox()).width;
  const full = rows.every((ws) => Math.abs(ws.reduce((a, b) => a + b, 0) + (ws.length - 1) * 8 - gridW) < 12);
  ctx.check("stats tiles (820): every row of tiles is full", full, JSON.stringify({ gridW, rows }));

  // Legend: bars show a square swatch, line series a short line, so same-colour series still differ.
  await tab.waitForSelector("#stats-chart .apexcharts-legend-series", { timeout: 15000 }).catch(() => {});
  await tab.waitForTimeout(800);
  const legend = await tab.locator("#stats-chart .apexcharts-legend-series").evaluateAll((items) =>
    items.map((it) => ({ text: it.textContent.trim(), line: !!it.querySelector(".legend-line") })),
  );
  const lines = legend.filter((l) => l.line).length;
  ctx.check("stats legend: growth and decline are squares, the node-type lines are lines", legend.length >= 3 && !legend[0].line && !legend[1].line && lines === legend.length - 2, JSON.stringify(legend));
  await tab.close();

  // A theme switch recolours the growth and decline bars and their legend swatches.
  const sw = await ctx.open("/stats", { scheme: "light", setup: (pg) => mockStats(pg) });
  await sw.waitForSelector("#stats-chart .apexcharts-bar-area", { timeout: 15000 }).catch(() => {});
  await sw.locator(".topbar [data-theme-toggle]").click(); // system → light
  await sw.locator(".topbar [data-theme-toggle]").click(); // light → dark
  await sw.waitForTimeout(1200);
  const after = await sw.evaluate(() => ({
    bars: [...new Set([...document.querySelectorAll("#stats-chart .apexcharts-series[seriesName] .apexcharts-bar-area")].map((b) => (b.getAttribute("fill") || "").toLowerCase()))],
    swatches: [...document.querySelectorAll("#stats-chart .apexcharts-legend-marker")].slice(0, 2).map((m) => getComputedStyle(m).backgroundColor),
  }));
  ctx.check(
    "stats chart: after switching to dark, the bars and swatches use the dark green and red",
    after.bars.some((f) => f.includes("63,185,80") || f === "#3fb950") &&
      after.bars.some((f) => f.includes("248,81,73") || f === "#f85149") &&
      !after.bars.some((f) => f.includes("26,127,55")) &&
      after.swatches.join() === "rgb(63, 185, 80),rgb(248, 81, 73)",
    JSON.stringify(after),
  );
  await sw.close();

  // Phone: the chart keeps a usable plot area under its legend and date labels.
  const phoneChart = await ctx.open("/stats", { width: 390, height: 1500, setup: (pg) => mockStats(pg) });
  await phoneChart.waitForSelector("#stats-chart .apexcharts-grid", { timeout: 15000 }).catch(() => {});
  await phoneChart.waitForTimeout(800);
  const plot = await phoneChart.evaluate(() => Math.round(document.querySelector("#stats-chart .apexcharts-grid")?.getBoundingClientRect().height || 0));
  ctx.check("stats chart (390): the plot area is at least 200px tall", plot >= 200, `${plot}px`);
  await phoneChart.close();

  // Laptop widths, one row of eight tiles: every value fits its tile (Active has three numbers).
  for (const width of [1024, 1100, 1200, 1280, 1366, 1440]) {
    const p = await ctx.open("/stats", { width, height: 900, setup: (pg) => mockStats(pg) });
    await p.waitForFunction(() => /\d/.test(document.getElementById("stats-chip-new")?.textContent || ""), null, { timeout: 15000 }).catch(() => {});
    const cut = await p.locator(".stats-tiles .tile").evaluateAll((tiles) =>
      tiles.flatMap((t) => [...t.querySelectorAll(".tile-value, .tile-label")])
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.textContent.trim()} ${el.clientWidth}/${el.scrollWidth}`),
    );
    ctx.check(`stats tiles (${width}): every tile's label and value fit`, !cut.length, cut.join("; "));
    await p.close();
  }

  for (const [scheme, ok, bad, rep] of [
    ["light", "#1a7f37", "#c62828", "#4caf50"],
    ["dark", "#3fb950", "#f85149", "#4caf50"],
  ]) {
    const p = await ctx.open("/stats", { scheme, setup: (pg) => mockStats(pg) });
    const c = await p.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      const v = (n) => s.getPropertyValue(n).trim().toLowerCase();
      return { added: v("--stats-chart-added"), removed: v("--stats-chart-removed"), repeaters: v("--stats-chart-type-2") };
    });
    ctx.check(`stats chart (${scheme}): growth and decline bars use the status colours`, c.added === ok && c.removed === bad && c.repeaters === rep, JSON.stringify(c));
    await p.close();
  }
}
