// Content-Security-Policy: every page is served with one and works under it, with no violation in
// the browser, also when the map popup's menus, QR code and Claim are used, the stats chart draws
// and the region map loads its geometry library.
import { stub } from "./fixtures/configurator.mjs";
import { mockStats } from "./fixtures/mock-stats.mjs";

const KEY = (i) => (i + 1).toString(16).padStart(2, "0").repeat(32);
const now = new Date().toISOString();
const NODES = [
  { city: "Gent", source: "app", params: { bw: 62.5, cr: 8, freq: 869.618, sf: 8 }, inserted_date: now, updated_date: now, last_advert: now, adv_name: "BE-GEN-Csp", public_key: KEY(0), type: 2, adv_lat: 51.05, adv_lon: 3.72, link: `meshcore://11${KEY(0)}`, discord_owner_id: null, discord_owner_name: null },
];

/** Opens `path` with violations recorded (securitypolicyviolation events and console reports). */
async function open(ctx, path, setup) {
  const page = await ctx.browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light", locale: "en-US" });
  page.violations = [];
  page.errors = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) page.violations.push(m.text());
    else if (m.type() === "error") page.errors.push(m.text());
  });
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  if (setup) await setup(page);
  const resp = await page.goto(ctx.base + path, { waitUntil: "networkidle" });
  page.policy = (await resp?.headerValue("content-security-policy")) || "";
  return page;
}

async function finish(ctx, name, page) {
  const events = await page.evaluate(() => window.__csp || []).catch(() => []);
  const all = [...events, ...page.violations];
  ctx.check(`csp ${name}: served with a policy`, /script-src 'self'/.test(page.policy) || /^default-src 'self'; frame-ancestors/.test(page.policy), page.policy);
  ctx.check(`csp ${name}: no 'unsafe-eval' and no inline scripts allowed`, !/unsafe-eval/.test(page.policy) && !/script-src[^;]*unsafe-inline/.test(page.policy), page.policy);
  ctx.check(`csp ${name}: no violations`, all.length === 0, all.join(" | "));
  ctx.check(`csp ${name}: no page errors`, page.errors.length === 0, page.errors.join("; "));
  await page.close();
}

export default async function (ctx) {
  // The map, with a popup: its menus, its QR code (from the CDN) and Claim, all without inline code.
  {
    const page = await open(ctx, `/?node=${KEY(0)}`, async (p) => {
      await p.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(NODES) }));
      await p.route("**/auth/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { id: "1", username: "tester" } }) }));
      // NodeBook's lookup, wherever the server's tool list puts NodeBook.
      await p.route(/\/api\/nodes\/[0-9a-f]{64}$/, (r) =>
        r.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": new URL(ctx.base).origin, "Access-Control-Allow-Credentials": "true" }, body: JSON.stringify({ fleets: [] }) }),
      );
      await p.route(`**/api/v1/nodes/${KEY(0)}/claim`, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true }) }));
    });
    await page.waitForSelector(".node-popup", { timeout: 10000 }).catch(() => {});
    await page.waitForSelector("img.node-qr", { timeout: 15000 }).catch(() => {});
    ctx.check("csp map: the popup's QR code draws", (await page.locator("img.node-qr").count()) > 0);
    const toggles = [".coords-menu-toggle", ".node-popup-analyzer-menu__toggle"];
    for (const sel of toggles) {
      const t = page.locator(`.node-popup ${sel}`).first();
      if (!(await t.count())) {
        ctx.check(`csp map: popup has ${sel}`, false);
        continue;
      }
      await t.click();
      const open1 = await t.evaluate((el) => el.parentElement.classList.contains("open"));
      await t.click();
      const open2 = await t.evaluate((el) => el.parentElement.classList.contains("open"));
      ctx.check(`csp map: ${sel} opens and closes its menu`, open1 && !open2, `${open1} ${open2}`);
    }
    const dialogs = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.accept();
    });
    const claimed = page.waitForRequest((r) => r.url().endsWith(`/api/v1/nodes/${KEY(0)}/claim`) && r.method() === "POST", { timeout: 5000 }).catch(() => null);
    await page.locator('.node-popup [data-popup-action="claim"]').click().catch(() => {});
    ctx.check("csp map: Claim asks first, then claims", !!(await claimed) && dialogs.length >= 1, dialogs.join(" | "));
    ctx.check("csp map: Claim leaves the address alone", !page.url().includes("#") && !page.url().startsWith("javascript"), page.url());
    // The search box: Enter submits nothing.
    await page.locator("#search-nodes-input").fill("BE-GEN");
    await page.locator("#search-nodes-input").press("Enter");
    await page.waitForTimeout(300);
    ctx.check("csp map: Enter in the search box stays on the page", page.url().startsWith(ctx.base + "/?") || page.url() === ctx.base + "/", page.url());
    await finish(ctx, "map", page);
  }
  {
    const page = await open(ctx, "/stats", (p) => mockStats(p));
    await page.waitForSelector("#stats-chart .apexcharts-canvas", { timeout: 15000 }).catch(() => {});
    ctx.check("csp stats: the chart draws", (await page.locator("#stats-chart .apexcharts-canvas").count()) > 0);
    await finish(ctx, "stats", page);
  }
  {
    const page = await open(ctx, "/region-map");
    await page.waitForFunction(() => typeof window.turf === "object", null, { timeout: 15000 }).catch(() => {});
    ctx.check("csp region map: its geometry library loads", await page.evaluate(() => typeof window.turf === "object"));
    // The province outlines are hulls: they must still compute (a refused eval would fail quietly).
    const hulls = await page.evaluate(() => {
      const pts = { type: "FeatureCollection", features: [[3.7, 51], [4.4, 51.2], [4.1, 50.6], [3.9, 50.9], [4.3, 50.8]].map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } })) };
      try {
        return [window.turf.concave(pts, { maxEdge: 200, units: "kilometers" })?.geometry?.type, window.turf.convex(pts)?.geometry?.type].join(" ");
      } catch (e) {
        return String(e);
      }
    });
    ctx.check("csp region map: outlines compute", hulls === "Polygon Polygon", hulls);
    await finish(ctx, "region map", page);
  }
  {
    const page = await open(ctx, "/region-map?embed=1");
    ctx.check("csp region map: the embed layout still applies", await page.evaluate(() => document.documentElement.classList.contains("region-map-embed")));
    await finish(ctx, "region map embedded", page);
  }
  {
    const page = await open(ctx, "/configurator", stub);
    await page.waitForSelector(".panel .panel-body h2", { timeout: 15000 }).catch(() => {});
    ctx.check("csp configurator: the app starts", (await page.locator(".panel .panel-body h2").count()) > 0);
    await page.waitForSelector(".leaflet-tile", { timeout: 15000 }).catch(() => {});
    await finish(ctx, "configurator", page);
  }
  {
    const page = await open(ctx, "/auth/signout?next=/stats");
    ctx.check("csp sign-out page: one Log out button", (await page.locator('form[method="post"] button[type="submit"]').count()) === 1);
    await finish(ctx, "sign-out page", page);
  }
  {
    const page = await open(ctx, "/device-hub.html");
    await finish(ctx, "device hub", page);
  }
}
