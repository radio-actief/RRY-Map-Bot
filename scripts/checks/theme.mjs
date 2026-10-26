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
}
