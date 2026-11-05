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
