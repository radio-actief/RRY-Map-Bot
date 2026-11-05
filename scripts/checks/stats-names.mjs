// Stats playback map: a node's name is shown as text in its hover label, never run as HTML
// (anyone can advertise any name on the mesh).
import { mockStats } from "./fixtures/mock-stats.mjs";

const NAME = '<img src=x onerror="window.__ran=1">';

function changes() {
  return JSON.stringify([
    { sync_date: "2026-10-01T06:00:00Z", public_key: "k1", change_type: "added", lat: 50.85, lon: 4.35, adv_name: NAME, type: 2 },
    { sync_date: "2026-10-02T06:00:00Z", public_key: "k2", change_type: "added", lat: 51.05, lon: 3.72, adv_name: "Plain", type: 1 },
  ]);
}

export default async function (ctx) {
  const page = await ctx.open("/stats", { setup: (p) => mockStats(p, changes()) });
  await page.waitForFunction(() => Number(document.querySelector("#playback-slider")?.max) > 0, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => {
    const s = document.querySelector("#playback-slider");
    s.value = s.max;
    s.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  // Hover each dot and read its label while it shows.
  const dots = page.locator("#stats-map path.leaflet-interactive");
  const n = await dots.count();
  const labels = [];
  let imgs = 0;
  for (let i = 0; i < n; i++) {
    await dots.nth(i).hover({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    const t = await page.evaluate(() => {
      const tip = document.querySelector(".leaflet-tooltip");
      return tip ? { text: tip.textContent, imgs: tip.querySelectorAll("img").length } : null;
    });
    if (t) {
      labels.push(t.text);
      imgs += t.imgs;
    }
  }
  const result = { ran: await page.evaluate(() => !!window.__ran), imgs, labels };
  ctx.check("stats names: a node name with HTML is shown as text, never run", n === 2 && !result.ran && result.imgs === 0 && result.labels.some((l) => l.includes("<img")), JSON.stringify({ dots: n, ...result }));
  await page.close();
}
