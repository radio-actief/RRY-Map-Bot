// The shared top bar and ☰ menu on all four pages: switcher position, last buttons, sign in/out, links, phone and Escape.
import { mockStats } from "./fixtures/mock-stats.mjs";

const PAGES = ["/", "/stats", "/region-map", "/configurator"];
const LINKS = ["Radio-Actief Website", "#BEmesh Website", "Documentation", "Discord", "GitHub"];
const text = (s) => (s || "").replace(/\s+/g, " ").trim();
const signedIn = async (p) => {
  await p.route("**/auth/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { id: "1", username: "tester" } }) }));
};
const signedOut = async (p) => {
  await p.route("**/auth/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: false }) }));
};
const setup = (path, who) => async (p) => {
  await who(p);
  if (path === "/stats") await mockStats(p);
};

export default async function (ctx) {
  const lefts = {};
  for (const path of PAGES) {
    const name = `topbar ${path}`;
    const page = await ctx.open(path, { setup: setup(path, signedOut) });
    await page.waitForSelector(".topbar .switcher a");
    await page.waitForSelector("#menu-toggle");
    await page.waitForSelector(".menu a", { state: "attached" });
    lefts[path] = (await page.locator(".topbar .switcher").boundingBox()).x;

    const buttons = (await page.locator(".topbar button:visible").allTextContents()).map(text);
    ctx.check(`${name}: last two buttons are ☰ then ◐`, buttons.slice(-2).join(",") === "☰,◐", buttons.join(","));

    const chip = page.locator(".topbar a.signin-chip");
    const href = (await chip.getAttribute("href").catch(() => "")) || "";
    ctx.check(`${name}: signed out shows the sign-in chip with next`, (await chip.count()) === 1 && href.endsWith(`next=${path}`), href);
    ctx.check(`${name}: the chip is a plain chip, not purple`, await chip.evaluate((a) => !/rgb\(88, 101, 242\)|#5865f2/i.test(getComputedStyle(a).backgroundColor)));

    await page.locator("#menu-toggle").click();
    ctx.check(`${name}: ☰ reports aria-expanded`, (await page.locator("#menu-toggle").getAttribute("aria-expanded")) === "true");
    const ext = (await page.locator("#page-menu a[target=_blank]").allTextContents()).map((s) => text(s).replace(/\s*↗$/, ""));
    ctx.check(`${name}: ☰ lists the five links in order`, ext.join("|") === LINKS.join("|"), ext.join("|"));
    const rels = await page.locator("#page-menu a[target=_blank]").evaluateAll((as) => as.every((a) => a.rel.includes("noopener")));
    ctx.check(`${name}: external links use noopener`, rels);
    const login = (await page.locator('#page-menu a:has-text("Sign in with Discord")').getAttribute("href")) || "";
    ctx.check(`${name}: ☰ has Sign in with Discord with next`, login === `/auth/login?next=${path}`, login);
    const pageLinks = await page.locator("#page-menu a.menu-page:visible").count();
    ctx.check(`${name}: no page links in ☰ on desktop`, pageLinks === 0, String(pageLinks));
    await page.keyboard.press("Escape");
    ctx.check(
      `${name}: Escape closes ☰ and returns focus`,
      !(await page.locator("#page-menu").isVisible()) && (await page.locator("#menu-toggle").getAttribute("aria-expanded")) === "false" && (await page.locator("#menu-toggle").evaluate((el) => el === document.activeElement)),
    );
    await page.locator("#menu-toggle").click();
    await page.mouse.click(700, 500);
    ctx.check(`${name}: an outside click closes ☰`, !(await page.locator("#page-menu").isVisible()));
    ctx.check(`${name}: no page errors`, !page.errors.length, page.errors.join("; "));
    await page.close();

    const me = await ctx.open(path, { setup: setup(path, signedIn) });
    await me.waitForSelector("#menu-toggle");
    await me.waitForSelector(".menu a", { state: "attached" });
    ctx.check(`${name}: signed in has no sign-in chip`, (await me.locator(".topbar a.signin-chip").count()) === 0);
    await me.locator("#menu-toggle").click();
    const menu = text(await me.locator("#page-menu").textContent());
    ctx.check(`${name}: signed in ☰ shows @tester and Log out`, menu.includes("@tester") && menu.includes("Log out") && !menu.includes("Sign in"), menu);
    const out = (await me.locator('#page-menu a:has-text("Log out")').getAttribute("href")) || "";
    ctx.check(`${name}: Log out returns to this page`, out === `/auth/logout?next=${path}`, out);
    if (path === "/") {
      ctx.check("topbar /: ☰ shows My nodes next to @tester", /@tester\s*My nodes \d+/.test(menu), menu);
    } else if (path !== "/configurator") {
      ctx.check(`${name}: no My nodes outside the map`, !menu.includes("My nodes"), menu);
    }
    await me.close();

    const phone = await ctx.open(path, { width: 390, height: 800, scheme: "dark", setup: setup(path, signedOut) });
    await phone.waitForSelector("#menu-toggle");
    await phone.waitForSelector(".menu a", { state: "attached" });
    await phone.locator("#menu-toggle").click();
    const first = (await phone.locator("#page-menu a:visible").allTextContents()).map(text);
    if (path === "/configurator") {
      ctx.check(`${name}: ☰ at 390 leaves the page links to the tools drawer`, !first.includes("Stats") && first[0].startsWith("Radio-Actief"), first.join("|"));
    } else {
      ctx.check(`${name}: ☰ at 390 starts with the four page links`, first.slice(0, 4).join("|") === "Map|Stats|Region map|Configurator", first.join("|"));
      const cur = await phone.locator('#page-menu a[aria-current="page"]').getAttribute("href");
      ctx.check(`${name}: the current page is marked`, cur === path, String(cur));
    }
    ctx.check(`${name}: the bar chip is hidden at 390`, !(await phone.locator(".topbar a.signin-chip").isVisible().catch(() => false)));
    const rect = await phone.locator("#page-menu").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    ctx.check(`${name}: ☰ stays on screen at 390`, rect.left >= 0 && rect.right <= 390, JSON.stringify(rect));
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    ctx.check(`${name}: no horizontal scroll at 390`, w <= 390, String(w));
    await phone.close();
  }
  const xs = Object.values(lefts);
  ctx.check("topbar: the switcher starts at the same x on every page", Math.max(...xs) - Math.min(...xs) <= 1, JSON.stringify(lefts));
}
