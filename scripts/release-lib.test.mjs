// node --test scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { addSection, compareVersions, nextVersion, notesFromSubjects, parseVersion, sectionFor } from "./release-lib.mjs";

test("versions: parse, compare and bump", () => {
  assert.deepEqual(parseVersion("v1.2.3"), [1, 2, 3]);
  assert.equal(parseVersion("1.2"), null);
  assert.equal(nextVersion("1.0.1", "patch"), "1.0.2");
  assert.equal(nextVersion("1.0.1", "minor"), "1.1.0");
  assert.equal(nextVersion("1.0.1", "major"), "2.0.0");
  assert.equal(nextVersion("1.0.1", "1.0.5"), "1.0.5");
  assert.throws(() => nextVersion("1.0.1", "1.0.1"), /not above/);
  assert.throws(() => nextVersion("1.0.1", "soon"), /not patch/);
  assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
});

test("notes: grouped New, Fixed, Other; scopes, merges and release commits dropped", () => {
  const notes = notesFromSubjects([
    "chore(release): 1.0.1",
    "fix(RRY-Map-Bot): the ☰ menu opens over the region map on phones",
    "Merge branch 'x' into dev",
    "feat(RRY-Map-Bot): a Read lists the repeaters the device hears",
    "docs: release process",
    "tidy up",
  ]);
  assert.equal(
    notes,
    "### New\n\n- A Read lists the repeaters the device hears\n\n" +
      "### Fixed\n\n- The ☰ menu opens over the region map on phones\n\n" +
      "### Other\n\n- Release process\n- Tidy up",
  );
});

test("changelog: a new section goes on top, the same version is replaced, a section reads back", () => {
  let log = addSection("", "1.0.0", "2026-10-28", "First.");
  assert.match(log, /^# Changelog\n/);
  log = addSection(log, "1.0.1", "2026-11-02", "### Fixed\n\n- B");
  assert.ok(log.indexOf("## 1.0.1") < log.indexOf("## 1.0.0"));
  log = addSection(log, "1.0.1", "2026-11-02", "### Fixed\n\n- C");
  assert.equal(log.match(/## 1\.0\.1/g).length, 1);
  assert.equal(sectionFor(log, "1.0.1"), "### Fixed\n\n- C");
  assert.equal(sectionFor(log, "1.0.0"), "First.");
  assert.equal(sectionFor(log, "9.9.9"), null);
});
