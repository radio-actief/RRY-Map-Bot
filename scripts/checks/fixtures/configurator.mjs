// Shared setup for the configurator checks: stub map tiles and the node list, open the app at a size.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

/** A few repeaters around Gent, so the map has nearby nodes. */
export const NODES = Array.from({ length: 5 }, (_, i) => {
  const key = (i + 1).toString(16).padStart(2, "0").repeat(32);
  return { public_key: key, type: 2, adv_name: `BE-GEN-Check${i + 1}`, adv_lat: 51.03 + i * 0.02, adv_lon: 3.68 + i * 0.03 };
});

/** Stub tiles and nodes on a page. */
export async function stub(page) {
  for (const host of ["**/tile.openstreetmap.org/**", "**/*.tile.openstreetmap.org/**"]) {
    await page.route(host, (r) => r.fulfill({ contentType: "image/png", body: PNG }));
  }
  await page.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(NODES) }));
}

/**
 * Open /configurator. `phone` gives a 390×844 touch screen; page errors and console errors are
 * collected in page.errors as ctx.open does.
 */
export async function openConfigurator(ctx, { phone = false } = {}) {
  const page = await ctx.browser.newPage(
    phone
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: "light" }
      : { viewport: { width: 1440, height: 900 }, colorScheme: "light" },
  );
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await stub(page);
  await page.goto(ctx.base + "/configurator", { waitUntil: "networkidle" });
  await page.waitForSelector(".panel .panel-body h2");
  return page;
}

/** Search a place on the Place step and pick the first hit (tap on a phone, click otherwise). */
export async function searchPlace(page, query, { tap = false } = {}) {
  const box = page.getByRole("combobox", { name: "Search a place" });
  if (tap) await box.tap();
  else await box.click();
  await box.fill(query);
  const hit = page.getByRole("option").first();
  await hit.waitFor();
  if (tap) await hit.tap();
  else await hit.click();
}

/** The step's Next button in the panel footer. */
export const next = (page) => page.locator(".panel-foot .btn.primary");
