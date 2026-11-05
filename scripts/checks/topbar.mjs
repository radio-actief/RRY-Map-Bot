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
    // About: the release from /api/v1/version, public links only, nothing about our setup.
    const want = await page.evaluate(() => fetch("/api/v1/version").then((r) => r.json()));
    await page.locator('#page-menu button:has-text("About")').click();
    ctx.check(`${name}: About closes ☰`, !(await page.locator("#page-menu").isVisible()));
    const about = page.locator("dialog.about-dialog");
    await about.locator(".about-version").waitFor();
    const aboutText = text(await about.textContent());
    ctx.check(`${name}: About shows the running version`, (await about.locator(".about-version").textContent()) === want.version, aboutText.slice(0, 120));
    const hrefs = await about.locator("a").evaluateAll((as) => as.map((a) => a.href));
    ctx.check(`${name}: About links only to the public repo`, hrefs.length === 2 && hrefs.every((h) => h.startsWith("https://github.com/radio-actief/RRY-Map-Bot")), hrefs.join(" "));
    // About names no hosting details: every address in it is a public project address, and no
    // private network address appears.
    const PUBLIC = /(^|\.)(radio-actief\.be|bemesh\.be|github\.com|discord\.gg|discord\.com|meshcore\.dev|meshcore\.io)$/i;
    const hosts = (aboutText.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) || []).filter((h) => !PUBLIC.test(h));
    const privateIp = /\b(127\.\d+|10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+\b/.test(aboutText);
    ctx.check(`${name}: About says nothing about our setup`, !hosts.length && !privateIp, `${hosts.join(" ")} ${aboutText.slice(0, 80)}`);
    await page.keyboard.press("Escape");
    await about.waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
    ctx.check(
      `${name}: Escape closes About and returns focus to ☰`,
      !(await about.isVisible()) && (await page.locator("#menu-toggle").evaluate((el) => el === document.activeElement)),
    );
    await page.locator("#menu-toggle").click();
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
    ctx.check(`${name}: ☰ at 390 starts with the four page links`, first.slice(0, 4).join("|") === "Map|Stats|Region map|Configurator", first.join("|"));
    const cur = await phone.locator('#page-menu a[aria-current="page"]').getAttribute("href");
    ctx.check(`${name}: the current page is marked`, cur === path, String(cur));
    ctx.check(`${name}: the bar chip is hidden at 390`, !(await phone.locator(".topbar a.signin-chip").isVisible().catch(() => false)));
    const rect = await phone.locator("#page-menu").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    ctx.check(`${name}: ☰ stays on screen at 390`, rect.left >= 0 && rect.right <= 390, JSON.stringify(rect));
    // Every row in the open ☰ is a 44px tap target on a phone, and the menu fits or scrolls.
    const rows = await phone.locator("#page-menu").evaluate((menu) =>
      [...menu.querySelectorAll("a, button")]
        .filter((el) => el.getClientRects().length)
        .map((el) => ({ t: el.textContent.trim().slice(0, 14), h: Math.round(el.getBoundingClientRect().height) })),
    );
    const short = rows.filter((r) => r.h < 44);
    ctx.check(`${name}: ☰ rows are 44px tall at 390`, rows.length > 4 && !short.length, JSON.stringify(short));
    const fits = await phone.locator("#page-menu").evaluate((m) => {
      const r = m.getBoundingClientRect();
      return r.bottom <= window.innerHeight || m.scrollHeight > m.clientHeight;
    });
    ctx.check(`${name}: ☰ fits the screen or scrolls`, fits);
    // Nothing (map markers, tiles, panels) may cover the open menu: probe a grid of points across it.
    await phone.waitForTimeout(500);
    const covered = await phone.locator("#page-menu").evaluate((menu) => {
      const r = menu.getBoundingClientRect();
      const out = [];
      for (let fx = 0.1; fx < 1; fx += 0.2)
        for (let fy = 0.05; fy < 1; fy += 0.1) {
          const e = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
          if (e && !menu.contains(e)) out.push(String(e.className?.baseVal ?? e.className).split(" ")[0] || e.tagName);
        }
      return [...new Set(out)];
    });
    ctx.check(`${name}: the open ☰ is on top of the page at 390`, !covered.length, covered.join(","));
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    ctx.check(`${name}: no horizontal scroll at 390`, w <= 390, String(w));
    await phone.close();
  }
  const xs = Object.values(lefts);
  ctx.check("topbar: the switcher starts at the same x on every page", Math.max(...xs) - Math.min(...xs) <= 1, JSON.stringify(lefts));
}
