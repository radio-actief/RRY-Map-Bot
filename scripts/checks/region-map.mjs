// Region map: top bar, panel controls, province layer, and no horizontal scroll on a phone.
export default async function (ctx) {
  const page = await ctx.open("/region-map");
  await page.waitForSelector(".leaflet-overlay-pane path", { timeout: 8000 }).catch(() => {});

  const wordmark = await page.locator(".topbar .wordmark").first().textContent().catch(() => "");
  ctx.check("region map: wordmark", (wordmark || "").replace(/\s+/g, " ").trim() === "#BEmesh region map", wordmark);
  const current = await page.locator('.switcher a[aria-current="page"]').allTextContents();
  ctx.check("region map: Region map is the current page", current.length === 1 && current[0].trim() === "Region map", current.join("|"));

  const input = page.locator("#code-input");
  ctx.check("region map: search is empty", (await input.inputValue().catch(() => "x")) === "");
  ctx.check("region map: search placeholder", (await input.getAttribute("placeholder").catch(() => "")) === "Search city, province or region");

  const labels = await page.locator(".segmented button").allTextContents();
  ctx.check("region map: border buttons", labels.map((s) => s.trim()).join(",") === "Off,Provinces,Gewesten,Countries", labels.join(","));
  const pressed = await page.locator('.segmented button[aria-pressed="true"]').allTextContents();
  ctx.check("region map: Provinces is pressed", pressed.length === 1 && pressed[0].trim() === "Provinces", pressed.join(","));
  ctx.check("region map: Location points is checked", await page.locator("#show-places").isChecked().catch(() => false));

  const be = (await page.locator(`.hierarchy-node[data-code="be"]`).first().innerText().catch(() => "")) || "";
  ctx.check("region map: Belgium row shows be and a number", /\bbe\b/.test(be) && /\d/.test(be), be.trim());
  const eu = (await page.locator(`.hierarchy-node[data-code="eu"] .region-meta`).first().innerText().catch(() => "")) || "";
  ctx.check("region map: the EU row reads wider region", eu.trim() === "eu · wider region", eu.trim());
  const paths = await page.locator(".leaflet-overlay-pane path").count();
  ctx.check("region map: at least 10 province paths", paths >= 10, String(paths));
  ctx.check("region map: search stays empty after load", (await input.inputValue().catch(() => "x")) === "");

  await page.getByRole("button", { name: "Gewesten" }).click();
  ctx.check("region map: Gewesten gets pressed", (await page.getByRole("button", { name: "Gewesten" }).getAttribute("aria-pressed")) === "true");
  ctx.check("region map: no page errors", !page.errors.length, page.errors.join("; "));
  await page.close();

  for (const scheme of ["light", "dark"]) {
    const p = await ctx.open("/region-map", { width: 390, height: 800, scheme });
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    ctx.check(`region map: no horizontal scroll at 390 (${scheme})`, w <= 390, String(w));
    await p.close();
  }

  // Dark mode: the Leaflet popup wrapper and tip follow the theme, not Leaflet's white.
  const dark = await ctx.open("/region-map", { scheme: "dark" });
  await dark.waitForSelector(".leaflet-overlay-pane path", { timeout: 8000 }).catch(() => {});
  await dark.locator(".leaflet-overlay-pane path").first().click({ force: true });
  await dark.waitForSelector(".leaflet-popup-content-wrapper", { timeout: 5000 }).catch(() => {});
  const bg = await dark.evaluate(() => {
    const w = document.querySelector(".leaflet-popup-content-wrapper");
    const t = document.querySelector(".leaflet-popup-tip");
    return { wrapper: w && getComputedStyle(w).backgroundColor, tip: t && getComputedStyle(t).backgroundColor };
  });
  const notWhite = (c) => !!c && c !== "rgb(255, 255, 255)";
  ctx.check("region map: dark popup wrapper and tip are not white", notWhite(bg.wrapper) && notWhite(bg.tip), JSON.stringify(bg));
  await dark.close();

  // ☰ stays on screen at 390 and Escape closes it, returning focus.
  const phone = await ctx.open("/region-map", { width: 390, height: 800 });
  await phone.locator("#menu-toggle").click();
  const rect = await phone.locator("#page-menu").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  });
  ctx.check("region map: ☰ menu stays on screen at 390", rect.width > 0 && rect.left >= 0 && rect.right <= 390, JSON.stringify(rect));
  await phone.keyboard.press("Escape");
  ctx.check("region map: Escape closes ☰ and returns focus", !(await phone.locator("#page-menu").isVisible()) && (await phone.locator("#menu-toggle").getAttribute("aria-expanded")) === "false" && (await phone.locator("#menu-toggle").evaluate((el) => el === document.activeElement)));
  await phone.close();
}
