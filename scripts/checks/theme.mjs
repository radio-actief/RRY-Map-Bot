// The shared theme script: stored choice, bad values, and the ◐ cycle.
const body = `<!doctype html><html><head><script src="/src/shared/theme.js"></script></head>
<body><button data-theme-toggle>◐</button></body></html>`;

async function themePage(ctx, stored) {
  return ctx.open("/__theme-check", {
    setup: async (page) => {
      await page.route("**/__theme-check", (r) => r.fulfill({ contentType: "text/html", body }));
      await page.addInitScript((v) => {
        if (v === null) localStorage.removeItem("configurator.theme");
        else localStorage.setItem("configurator.theme", v);
      }, stored);
    },
  });
}

const attr = (page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));

export default async function (ctx) {
  let page = await themePage(ctx, "dark");
  ctx.check("theme: stored dark sets data-theme=dark", (await attr(page)) === "dark");
  await page.close();

  page = await themePage(ctx, "blue");
  ctx.check("theme: an unknown stored value falls back to system", (await attr(page)) === null && !page.errors.length, page.errors.join("; "));
  await page.close();

  page = await themePage(ctx, null);
  await page.click("[data-theme-toggle]");
  const stored = await page.evaluate(() => localStorage.getItem("configurator.theme"));
  ctx.check("theme: ◐ from system goes to light", stored === "light" && (await attr(page)) === "light");
  await page.click("[data-theme-toggle]");
  await page.click("[data-theme-toggle]");
  ctx.check("theme: ◐ cycles light → dark → system", (await attr(page)) === null);
  await page.close();

  // The ◐ label waits for the page language: with the Dutch messages arriving late, no
  // "Missing translation" warning, and the label ends up in Dutch.
  const warnings = [];
  page = await ctx.open("/stats?lang=nl", {
    setup: async (p) => {
      p.on("console", (m) => m.type() === "warning" && warnings.push(m.text()));
      await p.route("**/i18n/shared.nl.json", async (r) => {
        await new Promise((done) => setTimeout(done, 800));
        await r.continue();
      });
    },
  });
  await page.waitForFunction(() => window.BEmeshI18n && window.BEmeshI18n.ready, null, { timeout: 10000 });
  await page.evaluate(() => window.BEmeshI18n.ready);
  await page.waitForTimeout(100);
  const label = await page.getAttribute(".topbar [data-theme-toggle]", "aria-label");
  const missing = warnings.filter((w) => w.includes("Missing translation") && /theme/.test(w));
  ctx.check("theme: the ◐ label waits for slow Dutch messages, without a missing-translation warning", !missing.length && /^Thema/.test(label || ""), `${label} | ${missing.join("; ")}`);
  await page.close();
}
