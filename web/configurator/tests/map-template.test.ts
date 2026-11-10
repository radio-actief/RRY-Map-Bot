import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS build script
import { buildMapRender } from "../../../scripts/build-map-template.mjs";

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

describe("the map page's precompiled template", () => {
  it("is up to date with index.html (npm run build:map)", () => {
    expect(read("src/map-app.render.js")).toBe(buildMapRender(read("index.html")));
  });

  it("needs no eval in the browser and imports the vendored Vue", () => {
    const code = read("src/map-app.render.js");
    expect(code).toMatch(/^import \{[^}]+\} from "\.\.\/lib\/vue\.esm-browser\.prod\.js"/m);
    expect(code).toMatch(/export function render\(_ctx, _cache\)/);
    expect(code).not.toMatch(/new Function|eval\(/);
    expect(read("src/map.js")).toMatch(/import \{ render \} from "\.\/map-app\.render\.js"/);
  });

  it("translates the page's static text when it renders, as i18n.js did in the page", () => {
    const code = buildMapRender(`<div id="app" v-cloak><span data-i18n="map.wordmark">mesh map</span><input placeholder="Search" data-i18n-attr="placeholder:map.search; aria-label:map.search" /></div>`);
    expect(code).toContain('_ctx.t(\'map.wordmark\')');
    expect(code).toContain('placeholder: _ctx.t(\'map.search\')');
    expect(code).toContain('"aria-label": _ctx.t(\'map.search\')');
    expect(code).not.toContain("mesh map");
  });
});
