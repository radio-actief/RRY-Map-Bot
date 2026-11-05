// Configurator Companion page: /join and /visit, the channels for Oostende, QR codes, Open in app,
// the four-step guide, phone width without sideways scroll, dark theme, Dutch and French.
import { stub } from "./fixtures/configurator.mjs";

const OOSTENDE_LINK = "meshcore://channel/add?name=%23oostende&secret=a10656e857573cb63f14932cfe377368&region_scope=be-vwv";
const BEMESH_LINK = "meshcore://channel/add?name=%23bemesh&secret=4e92675e10b4a5b3df305e86a6f4f8fa&region_scope=be";

async function open(ctx, path, { phone = false, scheme = "light", locale = "en-US" } = {}) {
  const page = await ctx.browser.newPage({
    ...(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1440, height: 900 } }),
    colorScheme: scheme,
    locale,
  });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await stub(page);
  await page.goto(ctx.base + path, { waitUntil: "networkidle" });
  await page.waitForSelector(".step-companion h2");
  return page;
}

async function pick(page, name, query) {
  const box = page.getByRole("combobox", { name });
  await box.click();
  await box.fill(query);
  const hit = page.getByRole("option").first();
  await hit.waitFor();
  await hit.click();
  await page.waitForSelector(".channel-list");
}

const rowText = (page, name) => page.locator(`li.channel[aria-label="${name}"]`).textContent();
const noSideScroll = (page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.querySelector(".panel-body");
    return doc.scrollWidth <= doc.clientWidth && body.scrollWidth <= body.clientWidth + 1;
  });

export default async function (ctx) {
  const n = "configurator companion";

  for (const path of ["/join", "/visit"]) {
    const page = await open(ctx, path);
    const heading = await page.locator(".step-companion h2").textContent();
    ctx.check(`${n}: ${path} lands on the Companion page`, heading === "Using MeshCore in Belgium?" && page.url().endsWith("/configurator#companion"), `${heading} ${page.url()}`);
    const tab = await page.getByRole("tab", { name: "Companion" }).getAttribute("aria-selected");
    ctx.check(`${n}: ${path} selects the Companion tab`, tab === "true", tab);
    await page.close();
  }

  const page = await open(ctx, "/configurator#companion");
  const preset = (await page.getByRole("group", { name: "EU/UK (Narrow)" }).textContent()) || "";
  ctx.check(`${n}: the preset shows EU/UK (Narrow) values`, ["869.618 MHz", "62.5 kHz", "SF 8", "CR 8"].every((v) => preset.includes(v)), preset);

  await pick(page, "Search a town or province", "Oostende");
  const local = await page.getByRole("list", { name: "Local channels" }).locator("li.channel").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  ctx.check(`${n}: Oostende shows #oostende first, then #brugge`, local.join(",") === "#oostende,#brugge", local.join(","));
  for (const name of ["#oostende", "#brugge"]) {
    const text = (await rowText(page, name)) || "";
    ctx.check(`${n}: ${name} uses region West-Vlaanderen`, text.includes("Region: West-Vlaanderen (be-vwv)"), text);
  }
  const national = await page.getByRole("list", { name: "For all of Belgium" }).locator("li.channel").count();
  ctx.check(`${n}: the national channels are listed`, national === 2, String(national));
  const flanders = await page.getByRole("list", { name: "Mostly in Flanders" }).locator("li.channel").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  ctx.check(`${n}: the Flanders channels follow the wiki's order`, flanders.join(",") === "#73sbe,#b-stby,#hamradio,#radio-actief", flanders.join(","));
  const bot = (await rowText(page, "#bot")) || "";
  ctx.check(`${n}: #bot uses the province of the place`, bot.includes("West-Vlaanderen (be-vwv)"), bot);

  const href = await page.locator('li.channel[aria-label="#oostende"] a', { hasText: "Open in app" }).getAttribute("href");
  ctx.check(`${n}: Open in app for #oostende`, href === OOSTENDE_LINK, href);
  const bemesh = await page.locator('li.channel[aria-label="#bemesh"] a', { hasText: "Open in app" }).getAttribute("href");
  ctx.check(`${n}: Open in app for #bemesh carries region be`, bemesh === BEMESH_LINK, bemesh);

  const thumb = page.locator('li.channel[aria-label="#oostende"] .qr-thumb');
  const modules = await thumb.locator("path").evaluate((p) => (p.getAttribute("d").match(/h1v1h-1z/g) || []).length);
  const box = await thumb.boundingBox();
  ctx.check(`${n}: a QR code renders`, modules > 200 && box?.width >= 48, `${modules} modules, ${box?.width}px`);
  await thumb.click();
  const big = await page.locator("dialog[open] .qr-large svg").boundingBox();
  ctx.check(`${n}: the QR code opens large`, big?.width >= 200, String(big?.width));
  await page.locator("dialog[open]").getByRole("button", { name: "Close" }).first().click();

  const focus = await page.locator("path.map-region-focus").count();
  ctx.check(`${n}: the map outlines the place's province`, focus > 0, String(focus));

  await page.getByRole("button", { name: /View this first/ }).click();
  const guide = page.getByRole("region", { name: "Before you add the channels" });
  const counts = [await guide.locator(".guide-head .sub").textContent()];
  for (let i = 0; i < 3; i++) {
    await guide.getByRole("button", { name: "Next" }).click();
    counts.push(await guide.locator(".guide-head .sub").textContent());
  }
  ctx.check(`${n}: the guide steps through`, counts.join(",") === "1 / 4,2 / 4,3 / 4,4 / 4", counts.join(","));
  const anim = await guide.locator(".guide-phone .tap").evaluate((el) => getComputedStyle(el).animationName);
  ctx.check(`${n}: the guide is animated`, anim !== "none", anim);

  await page.getByRole("button", { name: "Without region" }).click();
  const plain = await page.locator('li.channel[aria-label="#oostende"] a', { hasText: "Open in app" }).getAttribute("href");
  ctx.check(`${n}: Without region drops region_scope`, plain === OOSTENDE_LINK.replace("&region_scope=be-vwv", ""), plain);

  await page.getByRole("tab", { name: "Repeater" }).click();
  ctx.check(`${n}: the Repeater tab goes back to the steps`, (await page.locator(".stepper").count()) === 1 && !page.url().includes("#companion"), page.url());
  ctx.check(`${n}: no page errors`, !page.errors.length, page.errors.join("; "));
  await page.close();

  // Reduced motion: the guide stands still.
  const still = await ctx.browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await stub(still);
  await still.goto(ctx.base + "/configurator#companion", { waitUntil: "networkidle" });
  await still.getByRole("button", { name: /View this first/ }).click();
  const none = await still.locator(".guide-phone .tap").evaluate((el) => getComputedStyle(el).animationName);
  ctx.check(`${n}: no guide animation when reduced motion is asked`, none === "none", none);
  await still.close();

  // Phone, light and dark: the page fits the width, with the channels and the guide open.
  for (const scheme of ["light", "dark"]) {
    const phone = await open(ctx, "/visit", { phone: true, scheme });
    await pick(phone, "Search a town or province", "Brussel");
    await phone.getByRole("button", { name: /View this first/ }).click();
    ctx.check(`${n}: 390 px ${scheme}: no sideways scroll`, await noSideScroll(phone));
    const full = await phone.locator(".panel.sheet").evaluate((el) => el.classList.contains("full"));
    ctx.check(`${n}: 390 px ${scheme}: the sheet opens full`, full);
    const qrBg = await phone.locator(".qr-thumb").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    ctx.check(`${n}: 390 px ${scheme}: QR codes stay on white`, qrBg === "rgb(255, 255, 255)", qrBg);
    if (scheme === "dark") {
      await phone.locator('li.channel[aria-label="#bruxelles"] .region-shape').tap();
      await phone.waitForTimeout(400);
      const half = await phone.locator(".panel.sheet").evaluate((el) => el.classList.contains("half"));
      const outlined = await phone.locator("path.map-region-focus").count();
      ctx.check(`${n}: 390 px: a channel's small map lowers the sheet to show its region`, half && outlined > 0, `${half} ${outlined}`);
    }
    ctx.check(`${n}: 390 px ${scheme}: no page errors`, !phone.errors.length, phone.errors.join("; "));
    await phone.close();
  }

  // Dutch and French, from the short link's ?lang=.
  const langs = [
    ["nl", "MeshCore gebruiken in België?", "Zoek een gemeente of provincie", "Regio: West-Vlaanderen (be-vwv)"],
    ["fr", "Vous utilisez MeshCore en Belgique ?", "Chercher une commune ou une province", "Région : Flandre-Occidentale (be-vwv)"],
  ];
  for (const [lang, title, search, region] of langs) {
    for (const phone of [false, true]) {
      const p = await open(ctx, `/join?lang=${lang}`, { phone, scheme: phone ? "dark" : "light" });
      const h = await p.locator(".step-companion h2").textContent();
      await pick(p, search, "Oostende");
      const text = (await rowText(p, "#oostende")) || "";
      const size = phone ? "390" : "1440";
      ctx.check(`${n}: ${lang} ${size}: renders`, h === title && text.includes(region), `${h} | ${text}`);
      if (phone) ctx.check(`${n}: ${lang} 390: no sideways scroll`, await noSideScroll(p));
      ctx.check(`${n}: ${lang} ${size}: no page errors`, !p.errors.length, p.errors.join("; "));
      await p.close();
    }
  }
}
