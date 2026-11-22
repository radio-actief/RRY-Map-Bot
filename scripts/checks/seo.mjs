// Search engines: on all four pages, at 390 and 1280 px, the head carries the title, description,
// keywords, canonical, the three languages, the share card and JSON-LD, with no policy violation;
// the page's visible "what this is" is there, covers no control and moves nothing (the page's own
// parts sit exactly where they sit without it); nothing scrolls sideways. The map's caption closes
// and stays closed.
import { mockStats } from "./fixtures/mock-stats.mjs";

const KEY = (i) => (i + 1).toString(16).padStart(2, "0").repeat(32);
const now = new Date().toISOString();
const NODES = [
  { city: "Gent", source: "app", params: { bw: 62.5, cr: 8, freq: 869.618, sf: 8 }, inserted_date: now, updated_date: now, last_advert: now, adv_name: "BE-GEN-Seo", public_key: KEY(0), type: 2, adv_lat: 51.05, adv_lon: 3.72, link: `meshcore://11${KEY(0)}`, discord_owner_id: null, discord_owner_name: null },
];

/** The page's own parts whose place the caption must not change, and the controls it must not cover. */
const PAGES = {
  "/": { parts: [".topbar", "#map", ".search-box", ".map-ctrls", ".add-node"], controls: [".search-box", ".map-ctrls", ".add-node", ".maplibregl-ctrl-attrib", ".totals-chip"] },
  "/stats": { parts: [".topbar", ".stats-header-main", "#stats-content", ".stats-chart-and-map", ".stats-footer-note"], controls: [] },
  "/region-map": { parts: [".topbar", "#controls", "#region-map-container", "#hierarchy", ".region-map-search-wrap"], controls: [] },
  "/configurator": { parts: [".topbar", ".panel-head", ".panel-foot", ".step-connect h2", ".step-connect .btn.primary", ".continue"], controls: [] },
};

const setup = (path) => async (p) => {
  await p.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await p.route("**/auth/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: false }) }));
  await p.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(NODES) }));
  if (path === "/stats") await mockStats(p);
};

const headTags = () => {
  const q = (s) => document.head.querySelector(s);
  const all = (s) => [...document.head.querySelectorAll(s)];
  let ld = null;
  try {
    ld = JSON.parse(q('script[type="application/ld+json"]')?.textContent || "null");
  } catch {
    ld = "invalid";
  }
  return {
    lang: document.documentElement.lang,
    title: document.title,
    titles: all("title").length,
    description: q('meta[name="description"]')?.content || "",
    descriptions: all('meta[name="description"]').length,
    keywords: q('meta[name="keywords"]')?.content || "",
    canonical: q('link[rel="canonical"]')?.href || "",
    hreflang: Object.fromEntries(all('link[rel="alternate"][hreflang]').map((l) => [l.hreflang, l.href])),
    og: Object.fromEntries(all('meta[property^="og:"]').map((m) => [m.getAttribute("property"), m.content])),
    twitter: q('meta[name="twitter:card"]')?.content || "",
    ld: ld && ld["@graph"] ? ld["@graph"].map((n) => n["@type"]) : ld,
    robots: q('meta[name="robots"]')?.content || null,
  };
};

const measure = ({ parts, controls }) => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 2) / 2);
  };
  const intro = document.querySelector(".page-intro");
  const rect = intro?.getBoundingClientRect();
  const cs = intro && getComputedStyle(intro);
  const overlaps = controls.flatMap((sel) => [...document.querySelectorAll(sel)]).filter((el) => {
    if (!el.getClientRects().length || !rect) return false;
    const c = el.getBoundingClientRect();
    return c.left < rect.right && c.right > rect.left && c.top < rect.bottom && c.bottom > rect.top;
  });
  return {
    parts: Object.fromEntries(parts.map((sel) => [sel, document.querySelector(sel) ? box(document.querySelector(sel)) : null])),
    intro: intro
      ? {
          heading: intro.querySelector("h1")?.textContent.trim() || "",
          text: intro.querySelector("p")?.textContent.trim() || "",
          size: rect.width * rect.height,
          inView: rect.left >= 0 && rect.right <= innerWidth + 0.5,
          shown: cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.9,
          fontPx: parseFloat(getComputedStyle(intro.querySelector("p")).fontSize),
        }
      : null,
    overlaps: overlaps.map((el) => el.className || el.tagName),
    sideways: document.documentElement.scrollWidth > innerWidth + 1,
  };
};

export default async function (ctx) {
  for (const [path, spec] of Object.entries(PAGES)) {
    for (const width of [390, 1280]) {
      const name = `seo ${path} ${width}px`;
      const page = await ctx.open(path, { width, height: width === 390 ? 844 : 800, setup: setup(path) });
      await page.waitForSelector(".page-intro h1", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
      const h = await page.evaluate(headTags);
      ctx.check(`${name}: one title of at most 60 characters`, h.titles === 1 && h.title.length > 0 && h.title.length <= 60, h.title);
      ctx.check(`${name}: one description of 140–160 characters`, h.descriptions === 1 && h.description.length >= 140 && h.description.length <= 160, String(h.description.length));
      ctx.check(`${name}: keywords`, /MeshCore Belgium/.test(h.keywords) && /#BEmesh/.test(h.keywords), h.keywords.slice(0, 60));
      ctx.check(`${name}: <html lang> is the page language`, h.lang === "en", h.lang);
      const self = `${ctx.base}${path}`.replace(/\/$/, "") + (path === "/" ? "/" : "");
      ctx.check(`${name}: canonical is the page's own address`, h.canonical === self, h.canonical);
      ctx.check(
        `${name}: en, nl, fr and x-default`,
        h.hreflang.en === self && h.hreflang["x-default"] === self && h.hreflang.nl === `${self}?lang=nl` && h.hreflang.fr === `${self}?lang=fr`,
        JSON.stringify(h.hreflang),
      );
      ctx.check(`${name}: Open Graph and Twitter card`, h.og["og:title"] === h.title && /\/img\/share\/bemesh-card\.png$/.test(h.og["og:image"] || "") && h.og["og:url"] === self && h.twitter === "summary_large_image", JSON.stringify(h.og));
      ctx.check(`${name}: JSON-LD`, Array.isArray(h.ld) && h.ld[0] === "Organization" && h.ld[1] === "WebSite" && h.ld.length === 3, JSON.stringify(h.ld));
      ctx.check(`${name}: indexable`, h.robots === null, String(h.robots));
      const share = await page.request.get(h.og["og:image"]);
      ctx.check(`${name}: the share card loads`, share.ok() && share.headers()["content-type"] === "image/png");

      const withIntro = await page.evaluate(measure, spec);
      const i = withIntro.intro;
      ctx.check(`${name}: "what this is" is shown`, !!i && i.shown && i.size > 0 && i.inView && i.heading.length > 0 && i.text.length > 40 && i.fontPx >= 12, JSON.stringify(i));
      ctx.check(`${name}: it covers no control`, withIntro.overlaps.length === 0, withIntro.overlaps.join(", "));
      ctx.check(`${name}: nothing scrolls sideways`, !withIntro.sideways);
      await page.evaluate(() => document.querySelectorAll(".page-intro").forEach((el) => (el.style.display = "none")));
      const without = await page.evaluate(measure, spec);
      const moved = Object.keys(withIntro.parts).filter((sel) => JSON.stringify(withIntro.parts[sel]) !== JSON.stringify(without.parts[sel]));
      const missing = Object.keys(withIntro.parts).filter((sel) => !withIntro.parts[sel]);
      ctx.check(`${name}: the page's own parts are where they are without it`, !moved.length && !missing.length, `moved ${moved.join(", ")} missing ${missing.join(", ")}`);
      const violations = await page.evaluate(() => window.__csp || []);
      ctx.check(`${name}: no policy violation`, violations.length === 0, violations.join(" | "));
      ctx.check(`${name}: no page errors`, page.errors.length === 0, page.errors.join("; "));
      await page.close();
    }
  }

  // Each language: the head and the visible text in that language, from the server and the page alike.
  for (const [path, lang, word] of [["/", "nl", "Belg"], ["/stats", "fr", "Belg"], ["/configurator", "nl", "Belg"], ["/region-map", "fr", "Belg"]]) {
    const page = await ctx.open(`${path}?lang=${lang}`, { width: 390, height: 844, setup: setup(path) });
    await page.waitForSelector(".page-intro h1", { timeout: 10000 }).catch(() => {});
    const h = await page.evaluate(headTags);
    const intro = await page.evaluate(() => document.querySelector(".page-intro")?.textContent || "");
    const self = `${ctx.base}${path}`;
    ctx.check(`seo ${path}?lang=${lang}: head in ${lang}`, h.lang === lang && h.title.includes(word) && h.description.includes(word) && h.og["og:locale"] === `${lang}_BE`, `${h.lang} ${h.title}`);
    ctx.check(`seo ${path}?lang=${lang}: canonical keeps the language`, h.canonical === `${self}?lang=${lang}`, h.canonical);
    ctx.check(`seo ${path}?lang=${lang}: "what this is" in ${lang}`, intro.includes(word) && !/Every repeater|Network statistics|The MeshCore Belgium region|Configure a MeshCore/.test(intro), intro.slice(0, 80));
    const raw = await (await page.request.get(`${self}?lang=${lang}`)).text();
    ctx.check(`seo ${path}?lang=${lang}: the server sends that language`, raw.includes(`<html lang="${lang}"`) && raw.includes(h.title.replace(/&/g, "&amp;")), raw.slice(0, 80));
    await page.close();
  }

  // The map's caption: closing it keeps it closed on this device.
  {
    const page = await ctx.open("/", { width: 390, height: 844, setup: setup("/") });
    await page.locator("[data-page-intro-close]").click();
    const gone = await page.locator(".map-intro").isHidden();
    await page.reload({ waitUntil: "networkidle" });
    const still = await page.locator(".map-intro").isHidden();
    ctx.check("seo map: the caption closes and stays closed", gone && still);
    await page.evaluate(() => localStorage.removeItem("bemesh.intro.closed"));
    await page.close();
  }
}
