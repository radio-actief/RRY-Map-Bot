// Browser check for the map, stats and region map pages against a running server.
// Usage: node scripts/check-tool-pages.mjs http://127.0.0.1:4789 [check-name ...]
// Each file in scripts/checks/ exports `default async function (ctx)`; CHROME may point at a Chromium binary.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const base = (process.argv[2] || "http://127.0.0.1:4789").replace(/\/$/, "");
const only = process.argv.slice(3);
const dir = join(dirname(fileURLToPath(import.meta.url)), "checks");
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;

const ctx = {
  base,
  browser,
  /**
   * A new page at the given size, colour scheme and browser language (English unless asked, so the
   * text checks read English); page errors and console errors count as failures.
   */
  async open(path, { width = 1440, height = 900, scheme = "light", locale = "en-US", setup } = {}) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme, locale });
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
    if (setup) await setup(page);
    await page.goto(base + path, { waitUntil: "networkidle" });
    return page;
  },
  /** Records one result line. */
  check(name, ok, detail = "") {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  },
};

for (const file of readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort()) {
  if (only.length && !only.includes(file.replace(/\.mjs$/, ""))) continue;
  try {
    await (await import(pathToFileURL(join(dir, file)).href)).default(ctx);
  } catch (e) {
    ctx.check(`${file} ran`, false, e.message.split("\n")[0]);
  }
}
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
