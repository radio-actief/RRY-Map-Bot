// Copy and the QR image on a plain http page (like the LAN dev address), where the browser gives no
// clipboard API: copying must still work, say so only when it did, and the QR must be a real image
// that a long press or right click can save.
import { chromium } from "playwright";

const key = (i) => (i + 1).toString(16).padStart(2, "0").repeat(32);
const node = {
  adv_name: "BE-GEN-Copy check",
  adv_lat: 51.05,
  adv_lon: 3.72,
  city: "Gent",
  type: 2,
  source: "uploader",
  params: { bw: 62.5, cr: 8, freq: 869.618, sf: 8 },
  public_key: key(0),
  inserted_by: key(0),
  updated_by: key(0),
  inserted_date: new Date().toISOString(),
  updated_date: new Date().toISOString(),
  last_advert: new Date().toISOString(),
  link: `meshcore://11${key(0)}`,
};

export default async function (ctx) {
  // bemesh.test is not localhost, so Chrome treats http://bemesh.test as an insecure page.
  const port = new URL(ctx.base).port || "80";
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || undefined,
    args: ["--host-resolver-rules=MAP bemesh.test 127.0.0.1"],
  });
  for (const [width, height, size] of [
    [1440, 900, "desktop"],
    [390, 844, "390"],
  ]) {
    const n = `copy on plain http (${size})`;
    const page = await browser.newPage({ viewport: { width, height }, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify([node]) }));
    // Record what a real copy puts on the clipboard: the selection at the moment of the copy event.
    await page.addInitScript(() => {
      window.__copied = [];
      document.addEventListener("copy", () => window.__copied.push(String(document.getSelection())));
    });
    await page.goto(`http://bemesh.test:${port}/?node=${node.public_key}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".node-popup img.node-qr", { timeout: 10000 }).catch(() => {});

    const env = await page.evaluate(() => ({ secure: window.isSecureContext, api: !!navigator.clipboard }));
    ctx.check(`${n}: the page really is insecure, with no clipboard API`, !env.secure && !env.api, JSON.stringify(env));

    const tap = (sel) => (width < 600 ? page.locator(sel).first().tap() : page.locator(sel).first().click());
    const copied = () => page.evaluate(() => window.__copied.slice(-1)[0]);
    const copiedText = await page.evaluate(() => window.BEmeshI18n.t("map.copied"));

    await tap(".node-qr-card__header .node-popup__pk-wrap");
    await page.waitForTimeout(150);
    ctx.check(`${n}: tapping the public key copies it`, (await copied()) === node.public_key, String(await copied()));
    const fb = await page.locator(".node-qr-card__header").innerText();
    ctx.check(`${n}: and says it was copied`, fb.includes(copiedText), fb);

    await page.waitForTimeout(2700); // the feedback goes back to the link text
    await tap(".node-qr-card__footer .node-popup__pk-wrap");
    await page.waitForTimeout(150);
    ctx.check(`${n}: tapping the MeshCore link copies it`, (await copied()) === node.link, String(await copied()));

    await tap(".node-popup__prov-value .copyable");
    await page.waitForTimeout(150);
    ctx.check(`${n}: tapping the uploader key copies it`, (await copied()) === node.inserted_by, String(await copied()));

    // When the browser refuses, the popup says so instead of claiming success.
    await page.waitForTimeout(2700);
    await page.evaluate(() => (document.execCommand = () => false));
    await tap(".node-qr-card__header .node-popup__pk-wrap");
    await page.waitForTimeout(150);
    const failText = await page.evaluate(() => window.BEmeshI18n.t("map.copyFailed"));
    const ff = await page.locator(".node-qr-card__header").innerText();
    ctx.check(`${n}: a refused copy says it failed`, ff.includes(failText) && !ff.includes(copiedText), ff);

    // The QR is a sharp PNG image with alt text, not inline SVG.
    const qr = await page.locator(".node-popup img.node-qr").evaluate((img) => ({
      png: img.src.startsWith("data:image/png"),
      natural: img.naturalWidth,
      shown: Math.round(img.getBoundingClientRect().width),
      alt: img.alt,
    }));
    ctx.check(`${n}: the popup QR is a PNG of 512px or more, shown small, with alt text`, qr.png && qr.natural >= 512 && qr.shown <= 92 && qr.alt.includes(node.adv_name), JSON.stringify(qr));

    // A long press (finger up without a click) neither enlarges nor blocks the image menu.
    const long = await page.locator(".node-popup img.node-qr").evaluate((img) => {
      const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      img.dispatchEvent(menu);
      img.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, isPrimary: true, pointerType: "touch" }));
      return { menuBlocked: menu.defaultPrevented, enlarged: !!document.querySelector(".node-qr-enlarge-backdrop") };
    });
    ctx.check(`${n}: a long press on the QR keeps the image menu and doesn't enlarge`, !long.menuBlocked && !long.enlarged, JSON.stringify(long));

    // A tap enlarges; the big QR is a saveable image too.
    await tap(".node-popup img.node-qr");
    await page.waitForSelector(".node-qr-enlarge-qr img", { timeout: 5000 }).catch(() => {});
    const big = await page.evaluate(() => {
      const img = document.querySelector(".node-qr-enlarge-qr img");
      if (!img) return null;
      const c = getComputedStyle(img);
      const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      img.dispatchEvent(menu);
      return {
        png: img.src.startsWith("data:image/png"),
        natural: img.naturalWidth,
        alt: img.alt,
        callout: c.webkitTouchCallout || "default",
        select: c.userSelect,
        menuBlocked: menu.defaultPrevented,
        open: !!document.querySelector(".node-qr-enlarge-backdrop"),
      };
    });
    ctx.check(
      `${n}: the enlarged QR is a saveable PNG with the normal image menu`,
      !!big && big.png && big.natural >= 512 && !!big.alt && big.callout !== "none" && big.select !== "none" && !big.menuBlocked && big.open,
      JSON.stringify(big),
    );
    ctx.check(`${n}: no page errors`, !errors.length, errors.join("; "));
    await page.close();
  }
  await browser.close();
}
