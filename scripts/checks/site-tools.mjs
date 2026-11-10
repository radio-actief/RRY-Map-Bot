// Tools the site runs besides the map (GET /api/v1/site-tools): listed after the map's own pages
// in the top bar and the ☰ menu on all four pages; none when the site lists none.
import { mockStats } from "./fixtures/mock-stats.mjs";

const PAGES = ["/", "/stats", "/region-map", "/configurator"];
const TOOLS = [
  { key: "map", label: "Map", url: "/" },
  { key: "nodebook", label: "NodeBook", url: "/nodebook/" },
  { key: "meshmate", label: "MeshMate", url: "/app/" },
];
const setup = (path, tools) => async (p) => {
  await p.route("**/api/v1/site-tools", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(tools) }));
  if (path === "/stats") await mockStats(p);
};
const hrefs = (page, sel) => page.locator(sel).evaluateAll((as) => as.map((a) => a.getAttribute("href")));

export default async function (ctx) {
  for (const path of PAGES) {
    const page = await ctx.open(path, { setup: setup(path, TOOLS) });
    await page.waitForSelector('.topbar .switcher a[href="/app/"]', { timeout: 10000 }).catch(() => {});
    const bar = await hrefs(page, ".topbar .switcher a");
    ctx.check(`site tools ${path}: the top bar lists NodeBook and MeshMate after the four pages`, bar.join(" ") === "/ /stats /region-map /configurator /nodebook/ /app/", bar.join(" "));
    await page.locator("#menu-toggle").click();
    const menu = await hrefs(page, "#page-menu a.menu-page");
    ctx.check(`site tools ${path}: the ☰ menu lists them too`, menu.join(" ") === "/ /stats /region-map /configurator /nodebook/ /app/", menu.join(" "));
    ctx.check(`site tools ${path}: no page errors`, !page.errors.length, page.errors.join("; "));
    await page.close();

    const plain = await ctx.open(path, { setup: setup(path, []) });
    await plain.waitForTimeout(1200);
    const only = await hrefs(plain, ".topbar .switcher a");
    ctx.check(`site tools ${path}: without a list only the four pages`, only.join(" ") === "/ /stats /region-map /configurator", only.join(" "));
    await plain.close();
  }
  await popupChecks(ctx);
}

// The node popup: a signed-in visitor sees NodeBook's answer; a companion also gets Connect live.
const KEY = (i) => (i + 1).toString(16).padStart(2, "0").repeat(32);
const base = { city: "Gent", source: "app", params: { bw: 62.5, cr: 8, freq: 869.618, sf: 8 }, inserted_date: new Date().toISOString(), updated_date: new Date().toISOString(), last_advert: new Date().toISOString() };
const NODES = [
  { ...base, adv_name: "Companion one", public_key: KEY(0), type: 1, adv_lat: 51.05, adv_lon: 3.72 },
  { ...base, adv_name: "Repeater two", public_key: KEY(1), type: 2, adv_lat: 50.5, adv_lon: 4.5 },
];
const popupSetup = (signedIn, toolsDelayMs = 0) => async (p) => {
  await p.route("**/api/v1/site-tools", async (r) => {
    if (toolsDelayMs) await new Promise((res) => setTimeout(res, toolsDelayMs));
    await r.fulfill({ contentType: "application/json", body: JSON.stringify(TOOLS) });
  });
  await p.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(NODES) }));
  await p.route("**/auth/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(signedIn ? { authenticated: true, user: { id: "1", username: "tester" } } : { authenticated: false }) }));
  await p.route("**/nodebook/api/nodes/*", (r) => {
    const inFleet = r.request().url().endsWith(KEY(0));
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ public_key: KEY(0), fleets: inFleet ? [{ id: 1, name: "Home" }] : [] }) });
  });
};
const toolLinks = (page) => page.locator(".node-popup__tools a").evaluateAll((as) => as.map((a) => `${a.textContent}=${a.getAttribute("href")}`));

export async function popupChecks(ctx) {
  {
    // The tool list arrives after the popup opened: the popup is drawn again with Connect live.
    const page = await ctx.open(`/?node=${KEY(0)}`, { setup: popupSetup(false, 2500) });
    await page.waitForSelector(".node-popup__tools a", { timeout: 10000 }).catch(() => {});
    const got = await toolLinks(page);
    ctx.check("site tools popup: a late tool list still adds Connect live", got.join(" | ") === `Connect live=/app/?node=${KEY(0)}`, got.join(" | "));
    await page.close();
  }
  for (const [signedIn, i, want] of [
    [true, 0, [`In your NodeBook=/nodebook/node/${KEY(0)}`, `Connect live=/app/?node=${KEY(0)}`]],
    [true, 1, [`Add to NodeBook=/nodebook/node/${KEY(1)}`]],
    [false, 0, [`Connect live=/app/?node=${KEY(0)}`]],
    [false, 1, []],
  ]) {
    const name = `site tools popup (${signedIn ? "signed in" : "signed out"}, ${NODES[i].adv_name})`;
    const page = await ctx.open(`/?node=${KEY(i)}`, { setup: popupSetup(signedIn) });
    await page.waitForSelector(".node-popup", { timeout: 10000 }).catch(() => {});
    if (want.length) await page.waitForSelector(`.node-popup__tools a >> nth=${want.length - 1}`, { timeout: 8000 }).catch(() => {});
    else await page.waitForTimeout(1500);
    const got = await toolLinks(page);
    ctx.check(name, got.join(" | ") === want.join(" | "), got.join(" | "));
    ctx.check(`${name}: no page errors`, !page.errors.length, page.errors.join("; "));
    await page.close();
  }
}
