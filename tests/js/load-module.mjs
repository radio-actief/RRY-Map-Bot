// Load browser-style configurator scripts (`(function (App) {…})(window.ConfiguratorApp)`)
// into an isolated context and return the populated ConfiguratorApp object.
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";

const ROOT = new URL("../../", import.meta.url);

export function loadConfiguratorModules(...relPaths) {
  // Share typed arrays with the test realm so `instanceof Uint8Array` checks agree.
  const window = { ConfiguratorApp: {}, crypto: webcrypto, Uint8Array };
  window.self = window;
  window.window = window;
  const context = vm.createContext(window);
  for (const rel of relPaths) {
    const code = readFileSync(new URL(rel, ROOT), "utf8");
    vm.runInContext(code, context, { filename: rel });
  }
  return window;
}
