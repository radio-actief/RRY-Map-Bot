// Stats timeline playback: controls on the map, keyboard stepping, Links colour, phone theme switch.
import { mockStats } from "./fixtures/mock-stats.mjs";

function changes() {
  const rows = [];
  const spots = [[50.85, 4.35], [51.05, 3.72], [50.63, 5.57], [51.22, 4.4], [50.46, 4.86], [49.68, 5.8]];
  const days = ["2026-10-01", "2026-10-03", "2026-10-06", "2026-10-10", "2026-10-15", "2026-10-20"];
  spots.forEach(([lat, lon], i) => {
    rows.push({
      sync_date: days[i] + "T06:00:00Z",
      public_key: "k" + i,
      change_type: "added",
      lat,
      lon,
      adv_name: "Node " + i,
      type: (i % 4) + 1,
    });
  });
  rows.push({ sync_date: "2026-10-20T06:00:00Z", public_key: "k9", change_type: "added", lat: 50.9, lon: 4.1, adv_name: "Node 9", type: 2 });
  return JSON.stringify(rows);
}

const open = (ctx, opts = {}) => ctx.open("/stats", { ...opts, setup: (p) => mockStats(p, changes()) });
const ready = async (page) => {
  await page.waitForSelector("#stats-chart .apexcharts-yaxis-label", { timeout: 15000 }).catch(() => {});
  await page.waitForSelector("#playback-slider", { state: "attached", timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => Number(document.querySelector("#playback-slider")?.max) > 0, null, { timeout: 15000 }).catch(() => {});
};
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const mutOf = (page) =>
  page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--mut)";
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
const yFill = (page) => page.evaluate(() => {
  const l = document.querySelector("#stats-chart .apexcharts-yaxis-label");
  return l ? getComputedStyle(l).fill : null;
});

export default async function (ctx) {
  const page = await open(ctx, { width: 1440, height: 900 });
  await ready(page);
  const card = page.locator("#stats-playback");

  const total = norm(await page.locator("#playback-legend-count-total").textContent().catch(() => ""));
  ctx.check("playback: counts panel shows a total", /^\d+$/.test(total), total);
  const dots = await page.locator(".map-float .dot").count();
  const counts = await page.locator('.map-float [id^="playback-legend-count-"]:not(#playback-legend-count-total)').count();
  ctx.check("playback: four dotted counts", dots === 4 && counts === 4, `${dots} dots, ${counts} counts`);
  ctx.check("playback: counts sit on the map", (await page.locator("#stats-map-container .map-float #playback-date").count()) === 1);

  ctx.check("playback: bar has a play button", (await page.locator("#stats-map-container .map-float .btn.primary#playback-play").count()) === 1);
  ctx.check("playback: bar has a range input", (await page.locator('#stats-map-container .map-float input[type="range"]#playback-slider').count()) === 1);
  const seg = await page.locator("#stats-map-container .segmented button").allTextContents();
  ctx.check("playback: speed buttons", seg.map(norm).join(",") === "½×,1×,2×,4×", seg.join(","));
  const pressed = await page.locator('#stats-map-container .segmented button[aria-pressed="true"]').allTextContents();
  ctx.check("playback: 1× pressed", pressed.map(norm).join(",") === "1×", pressed.join(","));
  ctx.check("playback: no speed select", (await card.locator("select").count()) === 0);

  const stepBtns = await card.locator("button").allTextContents();
  ctx.check("playback: no step buttons", !stepBtns.some((t) => /[◀▶]\|?/.test(t.trim()) && t.trim() !== "▶" && t.trim() !== "⏸"), stepBtns.map(norm).join("|"));
  ctx.check("playback: no prev/next ids", (await page.locator("#playback-prev, #playback-next").count()) === 0);

  const slider = page.locator("#playback-slider");
  const val = async () => Number(await slider.inputValue());
  const max = Number(await slider.getAttribute("max"));
  const dateText = async () => norm(await page.locator("#playback-date").textContent());
  ctx.check("playback: slider starts at last date", (await val()) === max && max > 0, `${await val()}/${max}`);
  const fill = await slider.evaluate((el) => el.style.getPropertyValue("--fill"));
  ctx.check("playback: slider track is filled to the current date", fill === "100%", fill);
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  ctx.check("playback: ArrowRight at last date does nothing", (await val()) === max, String(await val()));
  const lastDate = await dateText();
  await page.keyboard.press("ArrowLeft");
  ctx.check("playback: ArrowLeft steps back one day", (await val()) === max - 1 && (await dateText()) !== lastDate, `${await val()} ${await dateText()}`);
  await slider.evaluate((el) => { el.value = 0; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  ctx.check("playback: ArrowLeft at first date does nothing", (await val()) === 0, String(await val()));
  await slider.evaluate((el, m) => { el.value = m; el.dispatchEvent(new Event("input", { bubbles: true })); }, max);

  await page.locator("#stats-map-container .segmented button", { hasText: "4×" }).click();
  const p4 = await page.locator('#stats-map-container .segmented button[aria-pressed="true"]').allTextContents();
  ctx.check("playback: clicking 4× presses it", p4.map(norm).join(",") === "4×", p4.join(","));
  const d0 = await dateText();
  await page.locator("#playback-play").click();
  await page.waitForTimeout(3000);
  const d1 = await dateText();
  ctx.check("playback: play advances the date", d0 !== d1, `${d0} -> ${d1}`);
  await page.locator("#playback-play").click();
  const d2 = await dateText();
  await page.waitForTimeout(1200);
  ctx.check("playback: second click pauses", d2 === (await dateText()), d2);

  const link = await page.evaluate(() => {
    const a = document.querySelector(".stats-links a");
    const probe = document.createElement("span");
    probe.style.color = "var(--node)";
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return { color: getComputedStyle(a).color, deco: getComputedStyle(a).textDecorationLine, want };
  });
  ctx.check("playback: Links colour is --node, no underline", link.color === link.want && link.deco === "none", JSON.stringify(link));
  ctx.check("playback: no page errors", !page.errors.length, page.errors.join("; "));
  await page.close();

  for (const scheme of ["light", "dark"]) {
    const p = await open(ctx, { width: 390, height: 800, scheme });
    await ready(p);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    ctx.check(`playback: no horizontal scroll at 390 (${scheme})`, w <= 390, String(w));
    await p.close();
  }

  const phone = await open(ctx, { width: 390, height: 800, scheme: "dark" });
  await ready(phone);
  for (let i = 0; i < 2; i++) {
    await phone.locator("[data-theme-toggle]").click();
    await phone.waitForTimeout(1500);
    const mut = await mutOf(phone);
    const fill = await yFill(phone);
    const xfill = await phone.evaluate(() => {
      const l = document.querySelector("#stats-chart .apexcharts-xaxis-label");
      return l ? getComputedStyle(l).fill : null;
    });
    ctx.check(`playback: phone chart labels follow the theme toggle (${i + 1})`, !!fill && fill === mut && xfill === mut, `y ${fill}, x ${xfill} vs ${mut}`);
  }
  ctx.check("playback: no page errors on phone", !phone.errors.length, phone.errors.join("; "));
  await phone.close();
}
