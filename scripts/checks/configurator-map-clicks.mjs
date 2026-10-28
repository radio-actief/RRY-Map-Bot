// Configurator map clicks: only the Place step moves the pin; elsewhere a click leaves the pin and the regions alone.
import { next, openConfigurator } from "./fixtures/configurator.mjs";

const pinBox = async (page) => {
  const b = await page.locator(".map-pin").boundingBox();
  return b ? `${Math.round(b.x)},${Math.round(b.y)}` : "none";
};
const regionStates = (page) =>
  page.locator("li.region-row").evaluateAll((rows) => rows.map((r) => `${r.dataset.code}:${r.querySelector('.region-state [aria-pressed="true"]')?.dataset.state}`).join(" "));

export default async function (ctx) {
  const n = "configurator map clicks";
  const page = await openConfigurator(ctx);
  const map = page.locator(".map-canvas");
  const box = await map.boundingBox();
  const at = (dx, dy) => ({ x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy });

  await page.mouse.click(at(0, 0).x, at(0, 0).y);
  await page.waitForTimeout(300);
  ctx.check(`${n}: a click on Connect sets no pin`, (await page.locator(".map-pin").count()) === 0);

  await page.getByRole("button", { name: /Continue without a device/ }).click();
  await page.mouse.click(at(-40, 20).x, at(-40, 20).y);
  await page.waitForSelector(".map-pin");
  const placed = await pinBox(page);
  ctx.check(`${n}: a click on Place sets the pin`, placed !== "none", placed);
  const latBox = page.getByRole("textbox", { name: "Latitude" });
  await page.waitForFunction(() => document.querySelector(".coord-row input")?.value);
  const lat = await latBox.inputValue();

  await next(page).click();
  await page.mouse.click(at(120, -80).x, at(120, -80).y);
  await page.waitForTimeout(300);
  ctx.check(`${n}: a click on Name leaves the pin`, (await pinBox(page)) === placed, `${placed} → ${await pinBox(page)}`);

  await next(page).click();
  await page.waitForSelector("li.region-row");
  const before = await regionStates(page);
  // Off every drawn region area, so the click only reaches the map.
  await page.locator(".map-canvas").evaluate((el) => el.querySelectorAll("path").forEach((p) => (p.style.pointerEvents = "none")));
  await page.mouse.click(at(160, 100).x, at(160, 100).y);
  await page.waitForTimeout(300);
  ctx.check(`${n}: a click on Regions leaves the pin`, (await pinBox(page)) === placed, `${placed} → ${await pinBox(page)}`);
  ctx.check(`${n}: a click on Regions leaves the regions`, (await regionStates(page)) === before);

  await page.getByRole("button", { name: "← Back" }).click();
  await page.getByRole("button", { name: "← Back" }).click();
  await page.waitForFunction(() => document.querySelector(".coord-row input")?.value);
  ctx.check(`${n}: back on Place the coordinates are unchanged`, (await latBox.inputValue()) === lat, `${lat} → ${await latBox.inputValue()}`);
  await page.mouse.click(at(150, 90).x, at(150, 90).y);
  await page.waitForTimeout(300);
  ctx.check(`${n}: a click on Place moves the pin again`, (await latBox.inputValue()) !== lat, `${lat} → ${await latBox.inputValue()}`);
  ctx.check(`${n}: no page errors`, !page.errors.length, page.errors.join("; "));
  await page.close();
}
