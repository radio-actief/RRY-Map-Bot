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
}
