// Configurator ☰ menu: on a phone it holds the links to the four tool pages, like on the other
// pages (the top bar has no room for them there); on a computer they stay in the top bar.
import { openConfigurator } from "./fixtures/configurator.mjs";

const pageLinks = (page) =>
  page.locator("#page-menu a.menu-page").evaluateAll((els) =>
    els.filter((a) => a.getClientRects().length).map((a) => ({ href: a.getAttribute("href"), current: a.getAttribute("aria-current") })),
  );

export default async function (ctx) {
  const phone = await openConfigurator(ctx, { phone: true });
  await phone.locator("#menu-toggle").tap();
  await phone.waitForTimeout(200);
  const links = await pageLinks(phone);
  ctx.check(
    "configurator menu (390): ☰ has the four tool pages, with the configurator marked",
    links.map((l) => l.href).join(" ") === "/ /stats /region-map /configurator" && links.find((l) => l.href === "/configurator")?.current === "page",
    JSON.stringify(links),
  );
  // The device drawer (🛠) is for the device: it no longer repeats the page links.
  await phone.keyboard.press("Escape");
  await phone.locator('.topbar button:has-text("🛠")').tap();
  await phone.waitForSelector(".drawer");
  ctx.check("configurator menu (390): the device drawer no longer repeats them", (await phone.locator(".drawer a[href='/stats']").count()) === 0);
  ctx.check("configurator menu (390): no page errors", !phone.errors.length, phone.errors.join("; "));
  await phone.close();

  const desk = await openConfigurator(ctx);
  await desk.locator("#menu-toggle").click();
  await desk.waitForTimeout(200);
  ctx.check("configurator menu (desktop): the page links stay in the top bar, not in ☰", (await pageLinks(desk)).length === 0 && (await desk.locator(".topbar .switcher a").count()) === 4);
  await desk.close();
}
