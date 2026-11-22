// Browser check of one application on four addresses (SITE_TOOLS_JSON with the map, stats, region
// map and configurator each on its own address; DEPLOYMENT.md "One application, four addresses").
// It starts the server itself, once per setting (hidden, shown, old paths redirecting), each address
// a port of 127.0.0.1, with a fresh database, and needs the build (`npm run build`).
// Usage: PYTHON=<python with requirements.txt> node scripts/check-hosts.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = { map: 4801, stats: 4802, regionMap: 4803, configurator: 4804, other: 4805 };
const at = (key) => `http://127.0.0.1:${PORT[key]}`;
const FOREIGN = "http://foreign.test";
const KEYS = ["map", "stats", "regionMap", "configurator"];
const LABELS = { map: "Map", stats: "Stats", regionMap: "Region map", configurator: "Configurator" };

/** The tool list: the four pages on their ports, with these flags on stats, regionMap and configurator. */
const toolList = (flags) => JSON.stringify(KEYS.map((key) => ({ key, label: LABELS[key], url: `${at(key)}/`, ...(key === "map" ? {} : flags) })));

const SERVE = `
import os, sys
sys.path.insert(0, sys.argv[1])
from backend.database import init_database
init_database()
from backend.api.app import app
from waitress import serve
serve(app, listen=sys.argv[2], threads=8, ident="check")
`;

async function withServer(flags, run) {
  const dir = mkdtempSync(join(tmpdir(), "check-hosts-"));
  const env = { ...process.env, SITE_TOOLS_JSON: toolList(flags), DATABASE_PATH: join(dir, "belgian_nodes.db"), CSP_ENABLED: "true", FLASK_DEBUG: "false" };
  const listen = Object.values(PORT).map((p) => `127.0.0.1:${p}`).join(" ");
  const server = spawn(process.env.PYTHON || "python3", ["-c", SERVE, root, listen], { env, cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  server.stderr.on("data", (d) => (log += d));
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(`${at("map")}/api/v1/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (i > 60) throw new Error(`server did not start: ${log.slice(-400)}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    await run();
  } finally {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

/** A new tab in a fresh browser profile; page and console errors are kept. */
async function open(context, url) {
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await page.goto(url, { waitUntil: "networkidle" });
  return page;
}
const pageKey = (page) => page.evaluate(() => document.documentElement.getAttribute("data-bemesh-page") || (document.getElementById("app") ? "configurator" : null));
const barLinks = (page) => page.locator(".topbar .switcher a").evaluateAll((as) => as.slice(0, 4).map((a) => a.href));
/** Whether a fetch of the map's /auth/me with the visitor's cookie works from this page (CORS). */
const asksMap = (page) =>
  page.evaluate((map) => fetch(`${map}/auth/me`, { credentials: "include" }).then((r) => r.json()).then((d) => d.authenticated === false, () => false), at("map"));

// 1. Hidden: every page reachable on its address; the map names none of them.
await withServer({ hidden: true }, async () => {
  const context = await browser.newContext();
  for (const key of KEYS) {
    const page = await open(context, `${at(key)}/`);
    check(`hidden: ${key} answers at / on its address`, (await pageKey(page)) === key, String(await pageKey(page)));
    check(`hidden: ${key} has no page errors`, !page.errors.length, page.errors.join("; "));
    if (key === "stats") {
      const bar = await barLinks(page);
      check("hidden: stats links the map and the other pages on the map's address", bar.join(" ") === `${at("map")}/ ${at("stats")}/ ${at("map")}/region-map ${at("map")}/configurator`, bar.join(" "));
      check("hidden: stats may ask the map who is signed in", await asksMap(page));
      const signIn = await page.locator(".signin-chip").first().getAttribute("href");
      check("hidden: stats signs in on the map, back to itself", signIn === `${at("map")}/auth/login?next=${encodeURIComponent(`${at("stats")}/`)}`, signIn);
    }
    await page.close();
  }
  const map = await open(context, `${at("map")}/`);
  const bar = await barLinks(map);
  check("hidden: the map keeps its paths", bar.join(" ") === `${at("map")}/ ${at("map")}/stats ${at("map")}/region-map ${at("map")}/configurator`, bar.join(" "));
  await map.close();
  const other = await open(context, `${at("other")}/`);
  check("hidden: a host not listed gets the map", (await pageKey(other)) === "map");
  check("hidden: a host not listed may not ask the map who is signed in", !(await asksMap(other)));
  await other.close();
  await context.close();
});

// 2. Shown: the bars link the addresses; the configurator joins the hub and moves its settings once.
await withServer({}, async () => {
  const context = await browser.newContext();
  const map = await open(context, `${at("map")}/`);
  const bar = await barLinks(map);
  check("shown: the map links the four addresses", bar.join(" ") === KEYS.map((k) => `${at(k)}/`).join(" "), bar.join(" "));
  await map.evaluate(() => {
    localStorage.setItem("configurator.theme", "dark");
    localStorage.setItem("configurator.layers", JSON.stringify({ nodes: false, borders: true }));
    localStorage.setItem("configurator.includeDefaults", "1");
    localStorage.setItem("bemesh.device.last", JSON.stringify({ transport: "usb", usbVendorId: 12346, usbProductId: 4097, role: "repeater", name: "Moved", publicKey: null, at: Date.now() }));
  });
  await map.close();

  const conf = await open(context, `${at("configurator")}/`);
  await conf.waitForFunction(() => localStorage.getItem("configurator.moved"), null, { timeout: 10000 }).catch(() => {});
  const stored = await conf.evaluate(() => ({
    moved: localStorage.getItem("configurator.moved"),
    theme: localStorage.getItem("configurator.theme"),
    layers: localStorage.getItem("configurator.layers"),
    includeDefaults: localStorage.getItem("configurator.includeDefaults"),
    last: JSON.parse(localStorage.getItem("bemesh.device.last") || "null")?.name,
    shown: document.documentElement.getAttribute("data-theme"),
  }));
  check("shown: the configurator takes its settings from the map once, through the hub", !!stored.moved && stored.theme === "dark" && stored.includeDefaults === "1" && stored.last === "Moved", JSON.stringify(stored));
  check("shown: the moved theme is applied at once", stored.shown === "dark", String(stored.shown));
  check("shown: the configurator has no page errors", !conf.errors.length, conf.errors.join("; "));
  const hubFrame = conf.frames().find((f) => f.url() === `${at("map")}/device-hub.html`);
  check("shown: a listed page frames the device hub", !!hubFrame && (await hubFrame.evaluate(() => document.documentElement.hasAttribute("data-device-hub"))));
  await conf.evaluate(() => localStorage.setItem("configurator.theme", "light"));
  await conf.close();

  const again = await open(context, `${at("map")}/`);
  await again.evaluate(() => localStorage.setItem("configurator.theme", "system-from-map"));
  await again.close();
  const conf2 = await open(context, `${at("configurator")}/`);
  await conf2.waitForTimeout(1500);
  check("shown: a setting made on the configurator's address is never overwritten", (await conf2.evaluate(() => localStorage.getItem("configurator.theme"))) === "light");
  await conf2.close();

  // A foreign origin may not frame the hub; Playwright serves its page (no DNS needed).
  const foreign = await context.newPage();
  await foreign.route(`${FOREIGN}/`, (r) => r.fulfill({ contentType: "text/html", body: `<iframe src="${at("map")}/device-hub.html"></iframe>` }));
  await foreign.goto(`${FOREIGN}/`, { waitUntil: "networkidle" });
  const framed = foreign.frames().find((f) => f !== foreign.mainFrame());
  const loaded = framed ? await framed.evaluate(() => document.documentElement.hasAttribute("data-device-hub")).catch(() => false) : false;
  check("shown: a foreign origin may not frame the device hub", !!framed && !loaded, framed ? "it loaded" : "no frame");
  await foreign.close();
  await context.close();
});

// 3. Old paths redirect: 301 to the new address with what follows and the query; the fragment
// (a hand-off) arrives too, as browsers carry it over a redirect.
await withServer({ redirectOldPath: true }, async () => {
  const context = await browser.newContext();
  const cases = [
    ["/stats?lang=nl", `${at("stats")}/?lang=nl`, "stats"],
    ["/region-map?lang=fr#node=ab", `${at("regionMap")}/?lang=fr#node=ab`, "regionMap"],
    ["/configurator?lang=nl#handoff=eyJhIjoxfQ", `${at("configurator")}/?lang=nl`, "configurator"],
  ];
  for (const [path, want, key] of cases) {
    const page = await open(context, `${at("map")}${path}`);
    const url = page.url();
    // The configurator takes the hand-off out of the address at once; it must have seen it.
    const ok = key === "configurator" ? url.startsWith(want) : url === want;
    check(`redirects: ${path} lands on ${want}`, ok && (await pageKey(page)) === key, url);
    await page.close();
  }
  const r = await fetch(`${at("map")}/configurator/assets/does-not-exist.js`, { redirect: "manual" });
  check("redirects: an old path answers 301", r.status === 301);

  // Search engines: each address names itself, its robots.txt its own sitemap; another name for the
  // map points at the map.
  for (const key of KEYS) {
    const page = await open(context, `${at(key)}/?lang=fr`);
    const head = await page.evaluate(() => ({
      canonical: document.querySelector('link[rel="canonical"]')?.href,
      xdefault: document.querySelector('link[rel="alternate"][hreflang="x-default"]')?.href,
      lang: document.documentElement.lang,
    }));
    check(`search: ${key} names its own address`, head.canonical === `${at(key)}/?lang=fr` && head.xdefault === `${at(key)}/` && head.lang === "fr", JSON.stringify(head));
    await page.close();
    const robots = await (await fetch(`${at(key)}/robots.txt`)).text();
    check(`search: ${key}'s robots.txt names its sitemap`, robots.includes(`Sitemap: ${at(key)}/sitemap.xml`) && /User-agent: GPTBot[\s\S]*?Disallow: \/\n/.test(robots));
  }
  const other = await open(context, `${at("other")}/`);
  const canonical = await other.evaluate(() => document.querySelector('link[rel="canonical"]')?.href);
  check("search: another name for the map points at the map", canonical === `${at("map")}/`, canonical);
  await other.close();
  await context.close();
});

await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
