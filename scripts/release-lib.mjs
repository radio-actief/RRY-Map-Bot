// Pure helpers for scripts/release.mjs and the release workflow: versions, release notes from
// commit titles, and the CHANGELOG.md sections they go in. No git, no files: see release.mjs.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** "1.2.3" → [1, 2, 3]; null when it is not a plain X.Y.Z version. */
export function parseVersion(v) {
  const m = SEMVER.exec(String(v ?? "").trim().replace(/^v/, ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** The next version: "patch", "minor" or "major" from `current`, or an explicit X.Y.Z above it. */
export function nextVersion(current, wanted) {
  const cur = parseVersion(current);
  if (!cur) throw new Error(`current version ${current} is not X.Y.Z`);
  const [ma, mi, pa] = cur;
  if (wanted === "patch") return `${ma}.${mi}.${pa + 1}`;
  if (wanted === "minor") return `${ma}.${mi + 1}.0`;
  if (wanted === "major") return `${ma + 1}.0.0`;
  const next = parseVersion(wanted);
  if (!next) throw new Error(`${wanted} is not patch, minor, major or X.Y.Z`);
  if (compareVersions(next.join("."), current) <= 0) throw new Error(`${wanted} is not above ${current}`);
  return next.join(".");
}

/** <0, 0 or >0, like a sort comparator. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

const GROUPS = [
  ["feat", "New"],
  ["fix", "Fixed"],
  ["other", "Other"],
];

/**
 * Release notes from commit titles (newest first, as `git log` gives them), grouped as New, Fixed
 * and Other. The conventional-commit type and scope are dropped; release commits and merges are left out.
 */
export function notesFromSubjects(subjects) {
  const groups = { feat: [], fix: [], other: [] };
  for (const raw of subjects) {
    const s = raw.trim();
    if (!s || /^Merge /.test(s) || /^chore\(release\)/.test(s)) continue;
    const m = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(s);
    const type = m ? m[1] : "other";
    const text = (m ? m[2] : s).replace(/^./, (c) => c.toUpperCase());
    groups[type === "feat" || type === "fix" ? type : "other"].push(text);
  }
  return GROUPS.filter(([k]) => groups[k].length)
    .map(([k, title]) => `### ${title}\n\n${groups[k].map((t) => `- ${t}`).join("\n")}`)
    .join("\n\n");
}

const HEADER = "# Changelog\n\nWhat changed in each release of the #BEmesh map, bot and configurator.\n";

/** CHANGELOG.md with a `## X.Y.Z (date)` section added on top (or replacing that version's section). */
export function addSection(changelog, version, date, notes) {
  const body = (changelog || "").trim() ? changelog : HEADER;
  const without = removeSection(body, version);
  const section = `## ${version} (${date})\n\n${notes.trim()}\n`;
  const first = without.search(/^## /m);
  if (first < 0) return `${without.trimEnd()}\n\n${section}`;
  return `${without.slice(0, first)}${section}\n${without.slice(first)}`;
}

/** The notes of one version's section (without its heading); null when CHANGELOG.md has none. */
export function sectionFor(changelog, version) {
  const m = new RegExp(`^## ${escape(version)} \\([^)]*\\)\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(changelog || "");
  return m ? m[1].trim() : null;
}

function removeSection(changelog, version) {
  return changelog.replace(new RegExp(`^## ${escape(version)} \\([^)]*\\)\\n[\\s\\S]*?(?=^## |(?![\\s\\S]))`, "m"), "");
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
