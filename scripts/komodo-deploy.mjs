#!/usr/bin/env node
// Deploys a release through Komodo (run by .forgejo/workflows/release.yml):
//   1. wait until the GitHub mirror has the tag (Komodo's Repo clones GitHub);
//   2. pin Komodo's Repo to the tag's commit and set the Build's version;
//   3. run the procedure (Build image, then Deploy stack; the stack's pre-deploy backs up the
//      database and copies the data files) and wait for it;
//   4. check that the live site serves this version.
//
//   KOMODO_URL=… KOMODO_API_KEY=… KOMODO_API_SECRET=… KOMODO_REPO=… KOMODO_BUILD=… KOMODO_PROCEDURE=…
//     node scripts/komodo-deploy.mjs vX.Y.Z <commit>
import { execFileSync } from "node:child_process";
import { parseVersion } from "./release-lib.mjs";

const MIRROR = "https://github.com/radio-actief/RRY-Map-Bot";
const SITE = process.env.SITE_URL || "https://meshmap.radio-actief.be";

const [tag, commit] = process.argv.slice(2);
const version = parseVersion(tag);
if (!version || !/^[0-9a-f]{40}$/.test(commit || "")) {
  console.error("usage: komodo-deploy.mjs vX.Y.Z <40-char commit>");
  process.exit(2);
}
// Where and what to deploy come from the environment (the release workflow's secrets).
const NEEDED = ["KOMODO_URL", "KOMODO_API_KEY", "KOMODO_API_SECRET", "KOMODO_REPO", "KOMODO_BUILD", "KOMODO_PROCEDURE"];
const missing = NEEDED.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`missing settings: ${missing.join(", ")}`);
  process.exit(2);
}
const { KOMODO_URL, KOMODO_API_KEY, KOMODO_API_SECRET } = process.env;
const REPO = process.env.KOMODO_REPO;
const BUILD = process.env.KOMODO_BUILD;
const PROCEDURE = process.env.KOMODO_PROCEDURE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (msg) => console.log(`[deploy ${tag}] ${msg}`);

async function komodo(kind, type, params) {
  const res = await fetch(`${KOMODO_URL}/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": KOMODO_API_KEY, "X-Api-Secret": KOMODO_API_SECRET },
    body: JSON.stringify({ type, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Komodo ${type}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function waitForMirror() {
  for (let i = 0; i < 60; i++) {
    const out = execFileSync("git", ["ls-remote", MIRROR, `refs/tags/${tag}^{}`, `refs/tags/${tag}`], { encoding: "utf8" });
    const shas = out.split("\n").filter(Boolean).map((l) => l.split("\t")[0]);
    if (shas.includes(commit)) return say(`GitHub mirror has ${tag}`);
    await sleep(10_000);
  }
  throw new Error(`the GitHub mirror did not get ${tag} within 10 minutes`);
}

async function runProcedure() {
  const update = await komodo("execute", "RunProcedure", { procedure: PROCEDURE });
  const id = update._id?.$oid ?? update.id;
  say(`procedure "${PROCEDURE}" started`);
  for (let i = 0; i < 180; i++) {
    await sleep(10_000);
    const u = await komodo("read", "GetUpdate", { id });
    if (u.status !== "Complete") continue;
    for (const l of u.logs ?? []) console.log(`  ${l.success ? "ok  " : "FAIL"} ${l.stage}`);
    if (!u.success) {
      for (const l of u.logs ?? []) if (!l.success) console.log((l.stdout ?? "").slice(-2000) + (l.stderr ?? "").slice(-4000));
      throw new Error("the Komodo procedure failed");
    }
    return;
  }
  throw new Error("the Komodo procedure did not finish within 30 minutes");
}

/** The release the site says it runs (GET /api/v1/version, the ☰ menu's About box). */
async function servedVersion() {
  const res = await fetch(`${SITE}/api/v1/version`, { cache: "no-store" });
  return res.ok ? (await res.json()).version : null;
}

async function checkLive() {
  const want = version.join(".");
  for (let i = 0; i < 24; i++) {
    const health = await fetch(`${SITE}/api/v1/health`).then((r) => r.status).catch(() => 0);
    const served = await servedVersion().catch(() => null);
    if (health === 200 && served === want) return say(`${SITE} is healthy and serves ${want}`);
    await sleep(5_000);
  }
  throw new Error(`${SITE} does not serve ${want} after the deploy`);
}

try {
  await waitForMirror();
  await komodo("write", "UpdateRepo", { id: REPO, config: { commit } });
  const [major, minor, patch] = version;
  await komodo("write", "UpdateBuild", { id: BUILD, config: { version: { major, minor, patch } } });
  say(`Komodo Repo pinned to ${commit.slice(0, 7)}, Build version ${version.join(".")}`);
  await runProcedure();
  await checkLive();
} catch (err) {
  console.error(`[deploy ${tag}] ${err.message}`);
  process.exit(1);
}
