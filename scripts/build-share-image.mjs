// Renders the #BEmesh share card img/share/bemesh-card.svg to img/share/bemesh-card.png (1200×630,
// what og:image and twitter:image name), with the site's own fonts, in a headless Chromium.
// Usage: node scripts/build-share-image.mjs   (CHROME may point at a Chromium binary)
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG = "img/share/bemesh-card.svg";
const PNG = join(root, "img/share/bemesh-card.png");
const TYPES = { ".svg": "image/svg+xml", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png" };

// The card's files (its fonts and the logo) from the repository, on this machine only.
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[/\\]+/, "");
  if (path.startsWith("..") || !TYPES[extname(path)]) return res.writeHead(404).end();
  try {
    const body = readFileSync(join(root, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/${SVG}`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const want = ['800 132px "Orbitron"', '700 50px "Figtree"', '500 28px "Figtree"'];
    await Promise.all(want.map((f) => document.fonts.load(f, "#BEmesh België")));
    if (!want.every((f) => document.fonts.check(f, "#BEmesh"))) throw new Error("fonts did not load");
  });
  writeFileSync(PNG, await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1200, height: 630 } }));
  console.log(`wrote ${PNG}`);
} finally {
  await browser.close();
  server.close();
}
