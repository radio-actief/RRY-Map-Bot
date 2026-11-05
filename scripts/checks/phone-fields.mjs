// Phone: every text field is at least 16px, or iOS zooms in on it and the page stays zoomed. Checks
// every input, select and textarea in the page (hidden ones too: menus and later steps), on all four
// tools and through the configurator's steps. Pinch zoom stays allowed: no maximum-scale in the viewport.
import { mockStats } from "./fixtures/mock-stats.mjs";
import { next, openConfigurator } from "./fixtures/configurator.mjs";

const small = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")]
      .filter((el) => !["checkbox", "radio", "range", "hidden", "color", "file", "button", "submit"].includes(el.type))
      .map((el) => ({ id: el.id || el.name || el.className || el.getAttribute("aria-label") || el.tagName, px: parseFloat(getComputedStyle(el).fontSize) }))
      .filter((f) => f.px < 16),
  );

const pinch = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('meta[name="viewport"]')?.content || "";
    return !/maximum-scale|user-scalable\s*=\s*(no|0)/i.test(v);
  });

export default async function (ctx) {
  const phone = { width: 390, height: 844 };
  for (const [path, setup] of [
    ["/", null],
    ["/stats", (p) => mockStats(p)],
    ["/region-map", null],
  ]) {
    const page = await ctx.open(path, { ...phone, setup: setup || undefined });
    const s = await small(page);
    ctx.check(`phone fields ${path}: every text field is 16px or more`, !s.length, JSON.stringify(s));
    ctx.check(`phone fields ${path}: pinch zoom stays allowed`, await pinch(page));
    await page.close();
  }

  const conf = await openConfigurator(ctx, { phone: true });
  const seen = [];
  const sample = async (step) => {
    for (const f of await small(conf)) seen.push(`${step}: ${f.id} ${f.px}px`);
  };
  await sample("connect");
  await conf.getByRole("button", { name: /Continue without a device/ }).tap();
  await conf.waitForSelector(".search input");
  await sample("place");
  for (const step of ["name", "regions", "settings", "send"]) {
    const btn = next(conf);
    if (!(await btn.count()) || (await btn.isDisabled())) break;
    if (step === "name") {
      // Place needs a spot before Next: tap the map.
      const box = await conf.locator(".map-canvas").boundingBox();
      await conf.touchscreen.tap(box.x + box.width / 2, box.y + 80);
      await conf.waitForTimeout(300);
    }
    await btn.tap().catch(() => {});
    await conf.waitForTimeout(500);
    await sample(step);
  }
  ctx.check("phone fields /configurator: every text field in every step is 16px or more", !seen.length, seen.join("; "));
  ctx.check("phone fields /configurator: pinch zoom stays allowed", await pinch(conf));
  await conf.close();
}
