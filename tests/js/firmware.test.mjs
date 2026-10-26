import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfiguratorModules } from "./load-module.mjs";

const { firmware } = loadConfiguratorModules("src/configurator/firmware.js").ConfiguratorApp;

test("parses the ver reply of stock MeshCore", () => {
  const v = firmware.parseVersion("v1.17.1 (Build: 14 Aug 2026)");
  assert.deepEqual([v.major, v.minor, v.patch], [1, 17, 1]);
});

test("parses versions with a suffix or without the v", () => {
  const a = firmware.parseVersion("v1.16.0-abc123 (Build: 1 Jul 2026)");
  assert.deepEqual([a.major, a.minor, a.patch], [1, 16, 0]);
  const b = firmware.parseVersion("1.15");
  assert.deepEqual([b.major, b.minor, b.patch], [1, 15, 0]);
});

test("returns null when no version can be found", () => {
  assert.equal(firmware.parseVersion(""), null);
  assert.equal(firmware.parseVersion("Unknown command"), null);
  assert.equal(firmware.parseVersion(null), null);
});

test("region def needs 1.16 or newer", () => {
  assert.equal(firmware.supportsRegionDef(firmware.parseVersion("v1.15.9")), false);
  assert.equal(firmware.supportsRegionDef(firmware.parseVersion("v1.16.0")), true);
  assert.equal(firmware.supportsRegionDef(firmware.parseVersion("v2.0.0")), true);
  assert.equal(firmware.supportsRegionDef(firmware.parseVersion("v0.99.0")), false);
});
