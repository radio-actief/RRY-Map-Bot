// Configurator export: with a password in the plan, Export first asks whether the file keeps the
// passwords; "Leave them out" downloads a file without them.
import { readFileSync } from "node:fs";
import { openConfigurator } from "./fixtures/configurator.mjs";

const FIXTURE = new URL("../../web/configurator/tests/fixtures/parity/admin-password.backup.json", import.meta.url);

export default async function (ctx) {
  const page = await openConfigurator(ctx, { phone: true });
  const drawer = () => page.locator('.topbar button:has-text("🛠")').tap().then(() => page.waitForSelector(".drawer"));
  await drawer();
  await page.locator('.drawer input[type="file"]').setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: readFileSync(FIXTURE),
  });
  await page.waitForTimeout(300);
  await drawer();
  await page.locator('.drawer button:has-text("Export JSON")').tap();
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor({ timeout: 3000 }).catch(() => {});
  const box = await dialog.boundingBox().catch(() => null);
  ctx.check("configurator export (390): Export asks about the passwords, inside the screen", !!box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/configurator-export.png` });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 3000 }).catch(() => null), dialog.locator('button:has-text("Leave them out")').tap()]);
  const json = download ? JSON.parse(readFileSync(await download.path(), "utf8")) : null;
  ctx.check("configurator export (390): \"Leave them out\" downloads a file without the passwords", json?.plan?.settings?.adminPassword === "" && json?.plan?.settings?.guestPassword === "", JSON.stringify(json?.plan?.settings ?? null).slice(0, 200));
  ctx.check("configurator export (390): no page errors", !page.errors.length, page.errors.join("; "));
  await page.close();
}
