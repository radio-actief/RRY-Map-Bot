// Main map: top bar, counts, auth states, search, filters, add button, and no horizontal scroll on a phone.
const text = (s) => (s || "").replace(/\s+/g, " ").trim();

// The local database is empty, so the page gets a small synthetic node list.
const nodes = Array.from({ length: 60 }, (_, i) => {
  const key = (i + 1).toString(16).padStart(2, "0").repeat(32);
  const day = 86400000;
  return {
    adv_name: `Check node ${i + 1}`,
    adv_lat: 50.6 + (i % 10) * 0.1,
    adv_lon: 3.5 + Math.floor(i / 10) * 0.3,
    city: ["Gent", "Brugge", "Leuven", "Namur"][i % 4],
    coords: "50.6, 3.5",
    discord_owner_id: i % 7 === 0 ? "1" : null,
    discord_owner_name: i % 7 === 0 ? "owner" : null,
    inserted_by: key,
    updated_by: key,
    inserted_date: new Date(Date.now() - i * 3 * day).toISOString(),
    updated_date: new Date(Date.now() - i * day).toISOString(),
    last_advert: new Date(Date.now() - i * day).toISOString(),
    link: `meshcore://11${key}`,
    params: { bw: 62.5, cr: 8, freq: 869.618, sf: 8 },
    public_key: key,
    source: i % 3 ? "uploader" : "app",
    type: (i % 4) + 1,
  };
});

const withNodes = (extra) => async (p) => {
  await p.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(nodes) }));
  if (extra) await extra(p);
};

export default async function (ctx) {
  const page = await ctx.open("/", { setup: withNodes() });
  await page.waitForSelector(".leaflet-marker-icon", { timeout: 10000 }).catch(() => {});

  const wordmark = await page.locator(".topbar .wordmark").first().textContent().catch(() => "");
  ctx.check("map: wordmark", text(wordmark) === "#BEmesh map", wordmark);
  const current = await page.locator('.switcher a[aria-current="page"]').allTextContents();
  ctx.check("map: Map is the current page", current.length === 1 && text(current[0]) === "Map", current.join("|"));

  const counts = text(await page.locator(".topbar .counts-chip").first().textContent().catch(() => ""));
  ctx.check("map: counts chip has a number", /\d/.test(counts), counts);
  const recent = text(await page.locator(".topbar .recent-chip").first().textContent().catch(() => ""));
  ctx.check("map: 24h/7d/30d chip", /24h\D*\d+/.test(recent) && /7d\D*\d+/.test(recent) && /30d\D*\d+/.test(recent), recent);

  const signin = page.locator('.topbar > a[href="/auth/login"]');
  ctx.check("map: signed out shows Sign in with Discord", (await signin.count()) === 1 && text(await signin.textContent()).includes("Sign in with Discord"));

  await page.locator("#menu-toggle").click();
  const menu = text(await page.locator("#page-menu").textContent());
  for (const w of ["Website", "Settings & news", "Docs", "Discord", "GitHub"]) {
    ctx.check(`map: menu has ${w}`, menu.includes(w), menu);
  }
  ctx.check("map: signed out menu has no Log out", !menu.includes("Log out"));
  await page.locator("#menu-toggle").click();

  const search = page.locator("#search-nodes-input");
  ctx.check("map: search placeholder", (await search.getAttribute("placeholder")) === "Search nodes, name or key");
  ctx.check("map: search is in a map-float", (await page.locator(".map-float #search-nodes-input").count()) === 1);

  await page.locator('button[aria-controls="node-filter"]').click();
  const panel = page.locator("#node-filter");
  ctx.check("map: Filters opens the panel", await panel.isVisible());
  const chips = (await panel.locator(".chip").allTextContents()).map(text);
  ctx.check("map: four type chips", ["Clients", "Repeaters", "Room servers", "Sensors"].every((c) => chips.includes(c)), chips.join(","));
  const segs = await panel.locator(".segmented").evaluateAll((els) => els.map((e) => [...e.querySelectorAll("button")].map((b) => b.textContent.trim()).join(",")));
  ctx.check("map: Source segment", segs.includes("All,App,Uploader"), segs.join("|"));
  ctx.check("map: Discord segment", segs.includes("All,Claimed,Unclaimed"), segs.join("|"));
  const more = panel.locator("details");
  ctx.check("map: More disclosure", (await more.count()) === 1 && text(await more.locator("summary").textContent()) === "More");
  await more.locator("summary").click();
  ctx.check("map: More holds date, city and zoom inputs", (await more.locator('input[type="date"]').count()) === 2 && (await more.locator("#city-filter-input").count()) === 1 && (await more.locator("#clustering-zoom-slider").count()) === 1);
  await page.locator('#node-filter .segmented button:has-text("Claimed")').first().click();
  ctx.check("map: Filters button shows active", text(await page.locator('button[aria-controls="node-filter"]').textContent()).includes("Filters active"));
  ctx.check("map: Clear filters shown", await panel.getByRole("button", { name: "Clear filters" }).isVisible());
  await panel.getByRole("button", { name: "Clear filters" }).click();
  await page.keyboard.press("Escape");

  ctx.check("map: + Add node is visible", await page.locator(".add-node").first().isVisible());
  ctx.check("map: no .float-action-btn", (await page.locator(".float-action-btn").count()) === 0);
  ctx.check("map: no .float-action-grid", (await page.locator(".float-action-grid").count()) === 0);

  const named = nodes[5];
  {
    await search.fill(named.adv_name);
    const hits = await page.locator(".search-results li").count();
    ctx.check("map: search shows a result", hits >= 1, String(hits));
  }
  ctx.check("map: no page errors", !page.errors.length, page.errors.join("; "));
  await page.close();

  const signed = await ctx.open("/", {
    setup: withNodes(async (p) => {
      await p.route("**/auth/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { id: "1", username: "tester" } }) }));
    }),
  });
  await signed.locator("#menu-toggle").click();
  const smenu = text(await signed.locator("#page-menu").textContent());
  ctx.check("map: signed in menu shows @tester", smenu.includes("@tester"), smenu);
  ctx.check("map: signed in menu shows Log out", smenu.includes("Log out"), smenu);
  ctx.check("map: signed in has no sign-in link", (await signed.locator('a[href="/auth/login"]').count()) === 0);
  await signed.close();

  for (const scheme of ["light", "dark"]) {
    const p = await ctx.open("/", { width: 390, height: 800, scheme, setup: withNodes() });
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    ctx.check(`map: no horizontal scroll at 390 (${scheme})`, w <= 390, String(w));
    await p.close();
  }

  // Dark mode: a node popup's wrapper and tip follow the theme, not Leaflet's white.
  const dark = await ctx.open(`/?node=${nodes[0].public_key}`, { scheme: "dark", setup: withNodes() });
  await dark.waitForSelector(".leaflet-popup-tip", { timeout: 10000 }).catch(() => {});
  const bg = await dark.evaluate(() => {
    const w = document.querySelector(".leaflet-popup-content-wrapper");
    const t = document.querySelector(".leaflet-popup-tip");
    return { wrapper: w && getComputedStyle(w).backgroundColor, tip: t && getComputedStyle(t).backgroundColor };
  });
  const notWhite = (c) => !!c && c !== "rgb(255, 255, 255)";
  ctx.check("map: dark popup wrapper and tip are not white", notWhite(bg.wrapper) && notWhite(bg.tip), JSON.stringify(bg));
  await dark.close();

  // ☰ stays on screen at 390; ☰ and Filters never stay open together.
  const phone = await ctx.open("/", { width: 390, height: 800, setup: withNodes() });
  await phone.locator("#menu-toggle").click();
  const rect = await phone.locator("#page-menu").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  });
  ctx.check("map: ☰ menu stays on screen at 390", rect.width > 0 && rect.left >= 0 && rect.right <= 390, JSON.stringify(rect));
  await phone.locator('button[aria-controls="node-filter"]').click();
  ctx.check("map: opening Filters closes ☰", !(await phone.locator("#page-menu").isVisible()) && (await phone.locator("#node-filter").isVisible()));
  await phone.locator("#menu-toggle").click();
  ctx.check("map: opening ☰ closes Filters", (await phone.locator("#page-menu").isVisible()) && !(await phone.locator("#node-filter").isVisible()));
  await phone.close();

  // Filters that match no node still read as active, with Clear filters on offer.
  const none = await ctx.open("/?source=app&claimed=claimed&nodes=2,3&city=Gent", { setup: withNodes() });
  await none.waitForSelector('button[aria-controls="node-filter"]', { timeout: 10000 });
  ctx.check("map: zero-match filters read Filters active", text(await none.locator('button[aria-controls="node-filter"]').textContent()).includes("Filters active"));
  await none.locator('button[aria-controls="node-filter"]').click();
  ctx.check("map: zero-match filters show Clear filters", await none.locator("#node-filter").getByRole("button", { name: "Clear filters" }).isVisible());
  await none.close();

  // The layers icon is inverted the same way for system dark and chosen dark.
  const invert = async (scheme, attr) => {
    const p = await ctx.open("/", { scheme, setup: withNodes(async (pg) => { if (attr) await pg.addInitScript((a) => localStorage.setItem("configurator.theme", a), attr); }) });
    await p.waitForSelector(".leaflet-control-layers-toggle", { timeout: 10000 });
    const f = await p.locator(".leaflet-control-layers-toggle").evaluate((el) => getComputedStyle(el).filter);
    await p.close();
    return f;
  };
  const sysDark = await invert("dark", null);
  const chosenDark = await invert("light", "dark");
  const sysLight = await invert("light", null);
  ctx.check("map: layers icon inverted in system dark and chosen dark, not in light", sysDark === chosenDark && sysDark.includes("invert") && !sysLight.includes("invert"), `${sysDark} | ${chosenDark} | ${sysLight}`);

  // Signed in on a phone, ☰ shows the user's node count under @user (the top-bar chip is hidden there).
  const me = (extra) => withNodes(async (p) => {
    await p.route("**/auth/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { id: "1", username: "tester" } }) }));
    if (extra) await extra(p);
  });
  const mine = await ctx.open("/", { width: 390, height: 800, setup: me() });
  await mine.locator("#menu-toggle").click();
  const mt = text(await mine.locator("#page-menu").textContent());
  ctx.check("map: phone ☰ shows My nodes 9 under @tester", /@tester\s*My nodes 9/.test(mt), mt);
  await mine.close();
  const wide = await ctx.open("/", { setup: me() });
  await wide.locator("#menu-toggle").click();
  ctx.check("map: desktop ☰ leaves My nodes to the top-bar chip", !(await wide.locator("#page-menu .menu-mynodes").isVisible()));
  await wide.close();

  // A ?node= deep link filters nothing, so Filters does not read as active.
  const deep = await ctx.open(`/?node=${nodes[0].public_key}`, { setup: withNodes() });
  await deep.waitForSelector('button[aria-controls="node-filter"]', { timeout: 10000 });
  const deepLabel = text(await deep.locator('button[aria-controls="node-filter"]').textContent());
  ctx.check("map: a ?node= deep link leaves Filters inactive", deepLabel === "Filters", deepLabel);
  await deep.close();
}
