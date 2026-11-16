// The shared top bar spec on all four pages: one row of 44px at 1280 and 1024 in every language, Bootstrap
// icons in 28px frames with 32px (44px on a phone) hit areas, the selected language light on ink (the
// current tool is the only yellow block), and a ☰ menu of 220px that opens under ☰ inside the window.
import { mockStats } from "./fixtures/mock-stats.mjs";

const PAGES = ["/", "/stats", "/region-map", "/configurator"];
const setup = (path) => async (p) => {
  await p.route("**/auth/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: false }) }));
  if (path === "/stats") await mockStats(p);
};

/** The bar's height, whether every visible item sits inside it, the icon buttons and the yellow blocks. */
const measure = (phone) => {
  const bar = document.querySelector(".topbar");
  const b = bar.getBoundingClientRect();
  const items = [];
  const walk = (el) => {
    for (const c of el.children) {
      const cs = getComputedStyle(c);
      if (cs.display === "contents") walk(c);
      else if (cs.display !== "none" && !c.classList.contains("menu")) {
        const r = c.getBoundingClientRect();
        if (r.width || r.height) items.push(r);
      }
    }
  };
  walk(bar);
  const outside = items.filter((r) => r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5 || r.right > b.right + 0.5);
  const reach = phone ? 21 : 15;
  const icons = [...bar.querySelectorAll("button.icon")].filter((x) => x.getClientRects().length).map((x) => {
    const r = x.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = [[reach, 0], [-reach, 0], [0, reach], [0, -reach]].every(([dx, dy]) => {
      const e = document.elementFromPoint(cx + dx, cy + dy);
      return !!e && (e === x || x.contains(e));
    });
    return { name: x.getAttribute("aria-label"), size: `${Math.round(r.width)}x${Math.round(r.height)}`, hit, glyph: !x.querySelector("i.bi") || !!x.textContent.trim() };
  });
  const yellow = [...bar.querySelectorAll("*")].filter((x) => x.getClientRects().length && !x.closest(".menu") && getComputedStyle(x).backgroundColor === "rgb(255, 255, 0)").length;
  const pressed = [...bar.querySelectorAll(".lang-switch:not(.menu-lang) button[aria-pressed=true]")].map((x) => getComputedStyle(x).backgroundColor);
  return { height: Math.round(b.height), outside: outside.length, scroll: bar.scrollWidth - bar.clientWidth, icons, yellow, pressed };
};

export default async function (ctx) {
  for (const path of PAGES) {
    for (const [width, height] of [
      [1280, 800],
      [1024, 768],
      [390, 844],
    ]) {
      for (const lang of width === 390 ? ["fr"] : ["en", "nl", "fr"]) {
        const name = `header ${path} ${width} ${lang}`;
        const page = await ctx.open(`${path}?lang=${lang}`, { width, height, setup: setup(path) });
        await page.waitForSelector("#menu-toggle");
        const m = await page.evaluate(measure, width <= 600);
        ctx.check(`${name}: the bar is one row of 44px`, m.height === 44 && !m.outside && m.scroll <= 0, JSON.stringify(m).slice(0, 200));
        const wrong = m.icons.filter((i) => i.size !== "28x28" || !i.hit || i.glyph);
        ctx.check(`${name}: icon buttons are 28px Bootstrap icons with ${width <= 600 ? 44 : 32}px hit areas`, m.icons.length >= 2 && !wrong.length, JSON.stringify(wrong));
        ctx.check(`${name}: the current tool is the only yellow block`, m.yellow <= 1, String(m.yellow));
        ctx.check(`${name}: the selected language is light on ink`, m.pressed.every((c) => c === "rgb(237, 242, 247)"), m.pressed.join(","));
        await page.locator("#menu-toggle").click();
        const menu = await page.locator("#page-menu").evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, bottom: r.bottom, width: Math.round(r.width), vw: document.documentElement.clientWidth, vh: innerHeight, focus: el.contains(document.activeElement) };
        });
        ctx.check(`${name}: ☰ opens 220px wide inside the window`, menu.width === 220 && menu.left >= 0 && menu.right <= menu.vw && menu.bottom <= menu.vh, JSON.stringify(menu));
        ctx.check(`${name}: a click leaves the focus on ☰`, !menu.focus);
        ctx.check(`${name}: no page errors`, !page.errors.length, page.errors.join("; "));
        await page.close();
      }
    }
    // Opened with the keyboard, the focus moves to the first row.
    const page = await ctx.open(path, { width: 1280, height: 800, setup: setup(path) });
    await page.waitForSelector("#menu-toggle");
    await page.locator("#menu-toggle").focus();
    await page.keyboard.press("Enter");
    const first = await page.locator("#page-menu").evaluate((el) => el.contains(document.activeElement));
    ctx.check(`header ${path}: Enter on ☰ moves the focus into the menu`, first);
    await page.close();
  }
}
