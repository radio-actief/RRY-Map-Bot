// Configurator on a phone (390×844, touch): sheet height per step with a slide, steps open at their top, search picked on lift.
import { next, openConfigurator, searchPlace } from "./fixtures/configurator.mjs";

const sheetIs = (page, size) => page.locator(".panel.sheet").evaluate((el, s) => el.classList.contains(s), size);
const bodyTop = (page) => page.locator(".panel-body").evaluate((el) => el.scrollTop);

/** Sample the sheet's height on every frame for ~0.5 s while `act` runs. */
async function heightsDuring(page, act) {
  await page.evaluate(() => {
    const el = document.querySelector(".panel.sheet");
    window.__heights = [];
    const t0 = performance.now();
    const step = () => {
      window.__heights.push(Math.round(el.getBoundingClientRect().height));
      if (performance.now() - t0 < 500) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await act();
  await page.waitForTimeout(600);
  return page.evaluate(() => window.__heights);
}

export default async function (ctx) {
  const n = "configurator phone";
  const page = await openConfigurator(ctx, { phone: true });

  ctx.check(`${n}: Connect opens the sheet full`, await sheetIs(page, "full"));
  const transition = await page.locator(".panel.sheet").evaluate((el) => {
    const s = getComputedStyle(el);
    return `${s.transitionProperty} ${s.transitionDuration}`;
  });
  ctx.check(`${n}: the sheet slides its height`, /height/.test(transition) && !/^\S+ 0s$/.test(transition), transition);

  const heights = await heightsDuring(page, () => page.getByRole("button", { name: /Continue without a device/ }).tap());
  const [first, last] = [heights[0], heights[heights.length - 1]];
  const between = new Set(heights.filter((h) => h < first && h > last));
  ctx.check(`${n}: Place opens the sheet half`, await sheetIs(page, "half"));
  ctx.check(`${n}: the height moves through in-between sizes (no jump)`, first > last && between.size >= 3, heights.join(","));

  // The iPhone case: the keyboard closing blurs the input after the finger lifts and before the
  // click arrives, so the list closes under the tap. Blur at the mouse-down that follows a tap:
  // a pick that waited for the click is lost.
  await page.evaluate(() => window.addEventListener("mousedown", () => document.activeElement?.blur(), true));
  await searchPlace(page, "Gent", { tap: true });
  const line = (await page.locator(".place-line").textContent()) || "";
  ctx.check(`${n}: a tapped search hit is picked even when the input blurs first`, line.includes("Gent"), line);

  await next(page).tap();
  ctx.check(`${n}: Name opens the sheet full`, await sheetIs(page, "full"));
  await page.locator(".grab").tap();
  ctx.check(`${n}: the grab handle still changes the height`, await sheetIs(page, "peek"));

  await next(page).tap();
  ctx.check(`${n}: Regions opens the sheet half`, await sheetIs(page, "half"));
  await page.waitForSelector("li.region-row");
  const scrolled = await page.locator(".panel-body").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  ctx.check(`${n}: the Regions list scrolls on a phone`, scrolled > 0, String(scrolled));
  await next(page).tap();
  ctx.check(`${n}: Settings opens at its top`, (await bodyTop(page)) === 0, String(await bodyTop(page)));
  await page.locator(".panel-body").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole("button", { name: "← Back" }).first().tap();
  ctx.check(`${n}: back on Regions, it opens at its top again`, (await bodyTop(page)) === 0, String(await bodyTop(page)));

  ctx.check(`${n}: no page errors`, !page.errors.length, page.errors.join("; "));
  await page.close();

  const still = await page.context().browser().newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
  await still.goto(ctx.base + "/configurator", { waitUntil: "networkidle" });
  const none = await still.locator(".panel.sheet").evaluate((el) => getComputedStyle(el).transitionDuration);
  ctx.check(`${n}: no slide when reduced motion is asked`, none === "0s", none);
  await still.close();
}
