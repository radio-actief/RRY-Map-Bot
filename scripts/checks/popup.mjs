// Node popup: compact (no taller than 420px), every field still there, no text under 11px.
const key = (i) => (i + 1).toString(16).padStart(2, "0").repeat(32);
const day = 86400000;
const node = {
  adv_name: "BE-GEN-Popup check",
  adv_lat: 51.05,
  adv_lon: 3.72,
  city: "Gent",
  type: 2,
  source: "uploader",
  discord_owner_id: "1",
  discord_owner_name: "radiofan",
  params: { bw: 62.5, cr: 8, freq: 869.618, sf: 8 },
  public_key: key(0),
  inserted_by: key(0),
  updated_by: key(5),
  inserted_date: new Date(Date.now() - 40 * day).toISOString(),
  updated_date: new Date(Date.now() - 2 * day).toISOString(),
  last_advert: new Date(Date.now() - 3600e3).toISOString(),
  link: `meshcore://11${key(0)}`,
};
const unclaimed = { ...node, adv_name: "BE-GEN-Free", public_key: key(1), inserted_by: key(1), discord_owner_id: null, discord_owner_name: null, adv_lon: 3.8, params: { bw: 125, cr: 5, freq: 869.4, sf: 9 } };
const setup = async (p) => {
  await p.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify([node, unclaimed]) }));
};

/** WCAG contrast of two "rgb(a)" colours, the first composited over a background. */
function contrast(fg, bg) {
  const lum = ([r, g, b]) => {
    const c = [r, g, b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
const parse = (c) => c.match(/[\d.]+/g).map(Number);
const over = (rgba, base) => {
  const [r, g, b, a = 1] = parse(rgba);
  return [r, g, b].map((v, i) => v * a + base[i] * (1 - a));
};

/** The popup's buttons: which are gold primaries, and their sizes. */
const buttons = (page) =>
  page.locator(".node-popup").evaluate((root) =>
    [...root.querySelectorAll(".node-popup-action, .node-popup__source-icon")].map((el) => {
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { cls: el.className, bg: c.backgroundColor, w: Math.round(r.width), h: Math.round(r.height), label: el.getAttribute("aria-label") || el.textContent.trim() };
    }),
  );
const GOLD = "rgb(212, 160, 23)";

export default async function (ctx) {
  for (const [width, height, size] of [
    [1440, 900, "desktop"],
    [390, 844, "390"],
  ]) {
    const n = `popup (${size})`;
    const page = await ctx.open(`/?node=${node.public_key}`, { width, height, setup });
    await page.waitForSelector(".node-popup img.node-qr", { timeout: 10000 }).catch(() => {});
    const box = await page.locator(".leaflet-popup-content-wrapper").boundingBox();
    ctx.check(`${n}: no taller than 420px`, !!box && box.height <= 420, box ? `${Math.round(box.height)}px` : "no popup");

    const text = (await page.locator(".node-popup").innerText()).replace(/\s+/g, " ");
    const wanted = ["BE-GEN-Popup check", "Gent", "Inserted", "Updated", "Last advert", "Public key", "MeshCore link", "Radio", "EU/UK (Narrow)", "Added by", "Updated by", "Claimed by", "@radiofan"];
    const missing = wanted.filter((w) => !text.includes(w));
    ctx.check(`${n}: every field is still shown`, !missing.length, `missing: ${missing.join(", ")}`);
    ctx.check(`${n}: the QR code is there`, (await page.locator(".node-popup img.node-qr").count()) === 1);

    const small = await page.locator(".node-popup").evaluate((root) => {
      const out = [];
      root.querySelectorAll("*").forEach((el) => {
        const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        if (!own || !el.getClientRects().length) return;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < 11) out.push(`${el.className || el.tagName} ${px}px`);
      });
      return out;
    });
    ctx.check(`${n}: no visible text under 11px`, !small.length, small.join("; "));
    const edge = await page.locator(".node-popup").evaluate((e) => getComputedStyle(e).borderLeftWidth);
    ctx.check(`${n}: no coloured status edge`, edge === "0px", edge);

    // A claimed node, signed out: no claim possible, so no primary button; every button labelled.
    const owned = await buttons(page);
    ctx.check(`${n}: no gold primary when claiming isn't possible`, !owned.some((b) => b.bg === GOLD), JSON.stringify(owned));
    ctx.check(`${n}: every popup button has a label`, owned.every((b) => b.label), JSON.stringify(owned));
    if (width < 600) {
      const small = owned.filter((b) => b.w < 44 || b.h < 44);
      ctx.check(`${n}: popup buttons are at least 44px on a phone`, !small.length, JSON.stringify(small));
    }
    ctx.check(`${n}: no page errors`, !page.errors.length, page.errors.join("; "));
    await page.close();

    // The analyzer menu opens inside the view and each item can be tapped (on a phone the popup scrolls and clipped it).
    const pop = await ctx.open(`/?node=${node.public_key}`, { width, height, setup });
    await pop.waitForSelector(".node-popup-analyzer-menu__toggle", { timeout: 10000 }).catch(() => {});
    await pop.locator(".node-popup-analyzer-menu__toggle").click();
    await pop.waitForTimeout(200);
    const items = await pop.locator(".node-popup-analyzer-menu .coords-menu a").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { text: el.textContent.trim(), h: Math.round(r.height), reachable: !!hit && (hit === el || el.contains(hit)) };
      }),
    );
    ctx.check(`${n}: every analyzer menu item can be tapped`, items.length === 2 && items.every((i) => i.reachable), JSON.stringify(items));
    if (width < 600) {
      ctx.check(`${n}: analyzer menu items are at least 44px on a phone`, items.every((i) => i.h >= 44), JSON.stringify(items));
      const close = await pop.locator(".leaflet-popup-close-button").boundingBox();
      ctx.check(`${n}: the popup close × is at least 44px on a phone`, !!close && close.width >= 44 && close.height >= 44, JSON.stringify(close));
    }
    await pop.close();

    // An unclaimed node: Claim is the one gold primary.
    const free = await ctx.open(`/?node=${unclaimed.public_key}`, { width, height, setup });
    await free.waitForSelector(".node-popup-action", { timeout: 10000 }).catch(() => {});
    const fb = await buttons(free);
    const primaries = fb.filter((b) => b.bg === GOLD);
    ctx.check(`${n}: Claim is the one gold primary`, primaries.length === 1 && /claim/i.test(primaries[0].label), JSON.stringify(fb));
    await free.close();
  }

  // Every visible link and copy target (owner, city, uploader keys) reads on glass, over a white or a black map.
  for (const scheme of ["light", "dark"]) {
    const page = await ctx.open(`/?node=${node.public_key}`, { scheme, setup });
    await page.waitForSelector(".node-popup__discord-user", { timeout: 10000 }).catch(() => {});
    const c = await page.evaluate(() => ({
      glass: getComputedStyle(document.querySelector(".leaflet-popup-content-wrapper")).backgroundColor,
      links: [...document.querySelectorAll(".node-popup a:not(.node-popup-action), .node-popup .copyable")]
        .filter((el) => el.getClientRects().length && el.textContent.trim() && !el.closest(".node-qr-card, .coords-menu"))
        .map((el) => ({ text: el.textContent.trim().slice(0, 16), fg: getComputedStyle(el).color })),
    }));
    const weak = c.links
      .map((l) => ({ ...l, ratio: Math.min(contrast(parse(l.fg), over(c.glass, [255, 255, 255])), contrast(parse(l.fg), over(c.glass, [0, 0, 0]))) }))
      .filter((l) => l.ratio < 4.5);
    ctx.check(`popup (${scheme}): every link reaches 4.5:1 on glass (${c.links.length} links)`, c.links.length >= 3 && !weak.length, JSON.stringify(weak.map((l) => `${l.text} ${l.fg} ${l.ratio.toFixed(2)}:1`)));
    await page.close();

    // The "Custom" radio label is secondary text on glass: 4.5:1 over any map.
    const free = await ctx.open(`/?node=${unclaimed.public_key}`, { scheme, setup });
    await free.waitForSelector(".node-popup__chip-hint--lead", { timeout: 10000 }).catch(() => {});
    const h = await free.evaluate(() => ({
      fg: getComputedStyle(document.querySelector(".node-popup__chip-hint--lead")).color,
      glass: getComputedStyle(document.querySelector(".leaflet-popup-content-wrapper")).backgroundColor,
    }));
    const r = Math.min(contrast(parse(h.fg), over(h.glass, [255, 255, 255])), contrast(parse(h.fg), over(h.glass, [0, 0, 0])));
    ctx.check(`popup (${scheme}): the "Custom" label reaches 4.5:1 on glass`, r >= 4.5, `${r.toFixed(2)}:1 ${JSON.stringify(h)}`);
    await free.close();
  }
}
