import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfiguratorModules } from "./load-module.mjs";

const App = loadConfiguratorModules("src/configurator/settings.js").ConfiguratorApp;

test("an empty admin password field sends nothing, so the device keeps its password", () => {
  assert.equal(App.adminPasswordCliLine(""), null);
  assert.equal(App.adminPasswordCliLine("   "), null);
  assert.equal(App.adminPasswordCliLine(undefined), null);
});

test("a typed admin password is sent, trimmed", () => {
  assert.equal(App.adminPasswordCliLine("  s3cret "), "password s3cret");
});
