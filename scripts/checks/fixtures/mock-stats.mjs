// Serves the stats page's API calls from the JSON files beside this one (taken from the public site,
// trimmed). The change history is the server's own replay (backend/stats_history.py) of the given
// change list.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, "..", "..", "..");
const read = (name) => readFileSync(join(dir, name), "utf8");

const REPLAY = "import json, sys; sys.path.insert(0, sys.argv[1]); from backend.stats_history import build_stats_history; print(json.dumps(build_stats_history(json.load(sys.stdin))))";
const replayed = new Map();

/** GET /api/v1/stats-history's answer for a change list (JSON text), as the server builds it. */
function history(nodeChanges) {
  if (!replayed.has(nodeChanges)) {
    replayed.set(nodeChanges, execFileSync(process.env.PYTHON || "python3", ["-c", REPLAY, root], { input: nodeChanges, encoding: "utf8" }));
  }
  return replayed.get(nodeChanges);
}

export async function mockStats(page, nodeChanges = "[]") {
  const bodies = {
    "/api/v1/stats": read("stats.json"),
    "/api/v1/sync-history": read("sync-history.json"),
    "/api/v1/node-changes": nodeChanges,
    "/api/v1/stats-history": history(nodeChanges),
  };
  for (const [path, body] of Object.entries(bodies)) {
    await page.route(`**${path}*`, (route) => route.fulfill({ contentType: "application/json", body }));
  }
}
