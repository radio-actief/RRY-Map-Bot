// The ☰ menu closes as soon as you press outside it, also when that press starts a map drag (a
// drag gives no click, so the menu used to stay open over the panning map), and a swipe at the
// end of the menu doesn't scroll the page behind it.
import { openConfigurator } from "./fixtures/configurator.mjs";

async function dragClosesMenu(page) {
  await page.locator("#menu-toggle").click();
  await page.waitForTimeout(150);
  const openBefore = await page.locator("#page-menu").isVisible();
  const box = await page.locator(".leaflet-container").first().boundingBox();
  const x = box.x + 40;
  const y = box.y + box.height - 60;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y - 40, { steps: 5 });
  const openDuring = await page.locator("#page-menu").isVisible();
  await page.mouse.up();
  return { openBefore, openDuring };
}

export default async function (ctx) {
  const map = await ctx.open("/", { width: 390, height: 844 });
  await map.waitForSelector("#menu-toggle");
  const m = await dragClosesMenu(map);
  ctx.check("menu close (map, 390): a map drag closes the open ☰ menu", m.openBefore && !m.openDuring, JSON.stringify(m));
  const contain = await map.locator("#page-menu").evaluate((el) => getComputedStyle(el).overscrollBehaviorY);
  ctx.check("menu close (map, 390): a swipe in the menu doesn't scroll the page behind it", contain === "contain", contain);
  await map.close();

  const conf = await openConfigurator(ctx);
  const c = await dragClosesMenu(conf);
  ctx.check("menu close (configurator): a map drag closes the open ☰ menu", c.openBefore && !c.openDuring, JSON.stringify(c));
  ctx.check("menu close: no page errors", !conf.errors.length, conf.errors.join("; "));
  await conf.close();
}
