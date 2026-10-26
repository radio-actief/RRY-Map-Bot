// Serves the stats page's API calls from the JSON files beside this one (taken from the public site, trimmed).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(dir, name), "utf8");

export async function mockStats(page, nodeChanges = "[]") {
  const bodies = {
    "/api/v1/stats": read("stats.json"),
    "/api/v1/sync-history": read("sync-history.json"),
    "/api/v1/node-changes": nodeChanges,
  };
  for (const [path, body] of Object.entries(bodies)) {
    await page.route(`**${path}*`, (route) => route.fulfill({ contentType: "application/json", body }));
  }
}
