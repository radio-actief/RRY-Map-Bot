#!/usr/bin/env node
// Releases: one version (package.json), notes in CHANGELOG.md, a vX.Y.Z tag on main.
//
//   npm run release:prepare -- <patch|minor|major|X.Y.Z>   on dev: bump + draft notes, nothing committed
//   npm run release:publish [-- --dry-run]                 commit, merge dev into main, tag, push
//   node scripts/release.mjs verify vX.Y.Z                 (CI) the tag is on main and matches package.json
//   node scripts/release.mjs notes X.Y.Z                   (CI) print that version's notes
//
// Pushing the tag starts .forgejo/workflows/release.yml, which tests, publishes the release page
// and deploys through Komodo. See DEPLOYMENT.md.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addSection, compareVersions, nextVersion, notesFromSubjects, parseVersion, sectionFor } from "./release-lib.mjs";

const REMOTE = process.env.RELEASE_REMOTE || "origin";
const FILES = ["package.json", "package-lock.json", "CHANGELOG.md"];

const git = (...args) => execFileSync("git", ["-c", "safe.directory=*", ...args], { encoding: "utf8" }).trim();
/** git, quietly: null (and no output) when it fails. */
const tryGit = (...args) => {
  try {
    return execFileSync("git", ["-c", "safe.directory=*", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};
const fail = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const version = () => readJson("package.json").version;
const today = () => new Date().toISOString().slice(0, 10);

/** The newest vX.Y.Z tag, or null. */
function lastTag() {
  const tags = (tryGit("tag", "--list", "v*") || "").split("\n").filter((t) => parseVersion(t));
  return tags.sort((a, b) => compareVersions(b, a))[0] ?? null;
}

function setVersion(v) {
  const pkg = readJson("package.json");
  pkg.version = v;
  writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  const lock = readJson("package-lock.json");
  lock.version = v;
  if (lock.packages?.[""]) lock.packages[""].version = v;
  writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
}

function requireBranch(name) {
  const branch = git("branch", "--show-current");
  if (branch !== name) fail(`run this on ${name} (you are on ${branch || "a detached HEAD"})`);
}

/** Tracked files with changes, staged or not. */
function changedFiles() {
  return git("diff", "--name-only", "HEAD").split("\n").filter(Boolean);
}

function prepare(wanted) {
  if (!wanted) fail("say which release: patch, minor, major or X.Y.Z");
  requireBranch("dev");
  if (changedFiles().length) fail("commit or stash your changes first");
  git("fetch", "--quiet", "--tags", REMOTE);
  if (tryGit("rev-list", "--count", `HEAD..${REMOTE}/dev`) !== "0") fail(`dev is behind ${REMOTE}/dev: pull first`);
  const next = nextVersion(version(), wanted);
  const since = lastTag();
  const range = since ? `${since}..HEAD` : "HEAD";
  const subjects = git("log", "--no-merges", "--format=%s", range).split("\n").filter(Boolean);
  const notes = notesFromSubjects(subjects) || "- Small changes.";
  setVersion(next);
  let changelog = "";
  try {
    changelog = readFileSync("CHANGELOG.md", "utf8");
  } catch {
    /* first release with notes */
  }
  writeFileSync("CHANGELOG.md", addSection(changelog, next, today(), notes));
  console.log(`Prepared ${next} (${subjects.length} commits since ${since ?? "the start"}).`);
  console.log("Edit the notes in CHANGELOG.md if you like (they are what users read), then:");
  console.log("  npm run release:publish");
}

function publish(dryRun) {
  requireBranch("dev");
  const v = version();
  const tag = `v${v}`;
  if (!parseVersion(v)) fail(`package.json version ${v} is not X.Y.Z`);
  const notes = sectionFor(readFileSync("CHANGELOG.md", "utf8"), v);
  if (!notes) fail(`CHANGELOG.md has no section for ${v}: run release:prepare first`);
  git("fetch", "--quiet", "--tags", REMOTE);
  if (tryGit("rev-parse", "--verify", "--quiet", `refs/tags/${tag}`)) fail(`${tag} already exists`);
  const last = lastTag();
  if (last && compareVersions(v, last) <= 0) fail(`${v} is not above the last release ${last}`);
  const stray = changedFiles().filter((f) => !FILES.includes(f));
  if (stray.length) fail(`uncommitted changes outside the release files: ${stray.join(", ")}`);
  if (tryGit("rev-list", "--count", `HEAD..${REMOTE}/dev`) !== "0") fail(`dev is behind ${REMOTE}/dev: pull first`);

  const steps = [];
  const run = (label, ...args) => {
    steps.push(label);
    if (dryRun) console.log(`[dry run] ${label}`);
    else git(...args);
  };
  if (changedFiles().length) run(`commit "chore(release): ${v}" on dev`, "commit", "--quiet", "-m", `chore(release): ${v}`, "--", ...FILES);
  run("switch to main", "switch", "--quiet", "main");
  if (!dryRun) {
    if (tryGit("rev-list", "--count", `main..${REMOTE}/main`) !== "0") {
      git("switch", "--quiet", "dev");
      fail(`main is behind ${REMOTE}/main: pull main first`);
    }
    if (tryGit("merge", "--quiet", "--ff-only", "dev") === null) {
      git("merge", "--quiet", "--no-ff", "-m", `Merge dev into main for ${v}`, "dev");
    }
  } else console.log("[dry run] merge dev into main (fast-forward when possible)");
  const msgDir = mkdtempSync(join(tmpdir(), "release-"));
  const msgFile = join(msgDir, "TAG_MESSAGE");
  writeFileSync(msgFile, `${v}\n\n${notes}\n`);
  run(`tag ${tag} on main, with the notes`, "tag", "-a", tag, "-F", msgFile);
  run(`push dev, main and ${tag} to ${REMOTE}`, "push", "--quiet", "--atomic", REMOTE, "dev", "main", tag);
  run("switch back to dev", "switch", "--quiet", "dev");
  run("bring main's merge back into dev", "merge", "--quiet", "--ff-only", "main");
  run(`push dev to ${REMOTE}`, "push", "--quiet", REMOTE, "dev");
  if (!dryRun) console.log(`Released ${tag}. The release workflow on Forgejo now tests and deploys it.`);
}

function verify(tag) {
  const v = String(tag || "").replace(/^v/, "");
  if (!parseVersion(v) || tag !== `v${v}`) fail(`${tag} is not a vX.Y.Z tag`);
  if (!tryGit("rev-parse", "--verify", "--quiet", `refs/tags/${tag}`)) fail(`there is no tag ${tag}`);
  const pkg = JSON.parse(git("show", `${tag}:package.json`));
  if (pkg.version !== v) fail(`${tag} carries package.json version ${pkg.version}`);
  if (!sectionFor(git("show", `${tag}:CHANGELOG.md`), v)) fail(`CHANGELOG.md at ${tag} has no section for ${v}`);
  const main = tryGit("rev-parse", "--verify", "--quiet", `${REMOTE}/main`) ?? tryGit("rev-parse", "--verify", "--quiet", "main");
  if (!main) fail("main is not available to check against");
  if (tryGit("merge-base", "--is-ancestor", `${tag}^{commit}`, main) === null) fail(`${tag} is not on main`);
  console.log(`${tag} is on main and matches package.json ${v}.`);
}

function notes(v) {
  const n = sectionFor(readFileSync("CHANGELOG.md", "utf8"), String(v).replace(/^v/, ""));
  if (!n) fail(`CHANGELOG.md has no section for ${v}`);
  process.stdout.write(n + "\n");
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "prepare") prepare(arg);
else if (cmd === "publish") publish(process.argv.includes("--dry-run"));
else if (cmd === "verify") verify(arg);
else if (cmd === "notes") notes(arg);
else fail("usage: release.mjs prepare <patch|minor|major|X.Y.Z> | publish [--dry-run] | verify vX.Y.Z | notes X.Y.Z");
