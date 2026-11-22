// Configurator with a simulated repeater: the signal (SNR) per neighbour after a Read, and the
// "Don't set a password" tick on Send (off at first; ticked, the field is disabled, a warning shows
// and the script has no password line). On a desktop and on a phone, light and dark.
import { stub } from "./fixtures/configurator.mjs";
import { installFakeRepeater, NEIGHBOUR_NODES } from "./fixtures/fake-repeater.mjs";

const WORDS = ["weak", "good", "fair", "good", "fair", "weak", "weak"];

async function open(ctx, { phone, scheme }) {
  const page = await ctx.browser.newPage(
    phone
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: scheme }
      : { viewport: { width: 1280, height: 800 }, colorScheme: scheme },
  );
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await stub(page);
  await page.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(NEIGHBOUR_NODES) }));
  await installFakeRepeater(page);
  await page.goto(ctx.base + "/configurator", { waitUntil: "networkidle" });
  await page.waitForSelector(".panel .panel-body h2");
  return page;
}

export default async function (ctx) {
  for (const [phone, scheme] of [
    [false, "light"],
    [true, "dark"],
  ]) {
    const n = `configurator password and signal (${phone ? "phone" : "desktop"}, ${scheme})`;
    const page = await open(ctx, { phone, scheme });
    await page.locator(".step-connect").getByRole("button", { name: "Connect over USB" }).click();
    await page.getByRole("button", { name: "Read settings from repeater" }).click();
    const list = page.getByRole("list", { name: "Hears 7 repeaters" });
    await list.waitFor({ timeout: 20000 });

    const rows = await list.locator("li").evaluateAll((lis) =>
      lis.map((li) => {
        const signal = li.querySelector(".neighbour-signal");
        const box = li.getBoundingClientRect();
        const s = signal.getBoundingClientRect();
        return {
          word: li.querySelector(".neighbour-quality").textContent,
          bars: li.querySelectorAll(".signal-bars i.on").length,
          color: getComputedStyle(signal).color,
          inside: s.left >= box.left - 0.5 && s.right <= box.right + 0.5,
        };
      }),
    );
    ctx.check(`${n}: each neighbour has its quality word`, rows.map((r) => r.word).join() === WORDS.join(), rows.map((r) => r.word).join());
    ctx.check(`${n}: good has 3 bars, fair 2, weak 1`, rows.every((r) => r.bars === { good: 3, fair: 2, weak: 1 }[r.word]));
    const colors = new Set(rows.map((r) => r.color));
    ctx.check(`${n}: good, fair and weak each have their own colour`, colors.size === 3, [...colors].join(" / "));
    ctx.check(`${n}: the signal stays inside its row`, rows.every((r) => r.inside));
    const named = await list.locator("li").first().locator(".neighbour-who").textContent();
    ctx.check(`${n}: an unknown neighbour shows its key prefix`, /^99aabbcc/.test(named || ""), named);

    await page.locator(".stepper .seg").last().click();
    const admin = page.locator("#set-adminPassword");
    const skip = page.getByRole("checkbox", { name: "Don't set a password" });
    await skip.waitFor();
    ctx.check(`${n}: Don't set a password is not ticked at first`, !(await skip.isChecked()));
    const tick = await skip.boundingBox();
    ctx.check(`${n}: the tick is a checkbox beside its words, not a stretched field`, !!tick && tick.width <= 24, JSON.stringify(tick));
    await admin.fill("s3cret");
    const withPw = (await page.locator(".script").textContent()) || "";
    ctx.check(`${n}: a typed password is in the script`, /(^|\n)password s3cret/.test(withPw));
    await skip.check();
    ctx.check(`${n}: ticked, the password field is disabled and empty`, (await admin.isDisabled()) && (await admin.inputValue()) === "");
    const warn = page.locator("#pw-skip-warn");
    ctx.check(`${n}: ticked, a warning says the repeater keeps its password`, /keeps its current one/.test((await warn.textContent()) || ""));
    const script = (await page.locator(".script").textContent()) || "";
    ctx.check(`${n}: ticked, the script has no password line`, !/(^|\n)password /.test(script));
    const warnBox = await warn.boundingBox();
    const cardBox = await page.locator(".card-before").boundingBox();
    ctx.check(`${n}: the warning fits in its card`, !!warnBox && !!cardBox && warnBox.x + warnBox.width <= cardBox.x + cardBox.width + 0.5);
    ctx.check(`${n}: no page errors`, page.errors.length === 0, page.errors.join(" | "));
    await page.close();
  }
}
