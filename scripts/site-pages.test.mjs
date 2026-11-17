// The build of the map, stats and region map pages (web/site): how their classic scripts, messages
// and stylesheets are put together. Run with: node --test scripts/*.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { classicGroups, joinClassic, pageMessages } from "../web/site/site-pages.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const PAGES = { "index.html": "map", "stats.html": "stats", "region-map.html": "region-map" };

test("neighbouring classic scripts of the site form one run; modules and other sites' scripts don't join", () => {
  const html = `<head><script src="./a.js" data-x="1"></script>
    <script src="./b.js"></script><title>t</title></head>
    <body><p>text</p><script src="https://cdn.example/x.js"></script>
    <script src="./c.js"></script>
    <script src="/d.js"></script>
    <script type="module" src="./m.js"></script><script src="./e.js"></script></body>`;
  const groups = classicGroups(html).map((g) => g.scripts.map((s) => s.file));
  assert.deepEqual(groups, [["a.js", "b.js"], ["c.js", "d.js"], ["e.js"]]);
  assert.deepEqual(classicGroups(html)[0].scripts[0].attrs, { "data-x": "1" });
});

test("each page has its scripts in two runs: language and theme in <head>, the rest at the end", () => {
  for (const [page, name] of Object.entries(PAGES)) {
    const html = read(page);
    const groups = classicGroups(html);
    assert.equal(groups.length, 2, page);
    assert.ok(groups[0].end < html.indexOf("</head>"), page);
    assert.deepEqual(groups[0].scripts.slice(0, 2).map((s) => s.file), ["src/shared/i18n.js", "src/shared/theme.js"], page);
    assert.equal(groups[0].scripts[0].attrs["data-i18n-page"], name, page);
    assert.ok(groups[1].start > html.indexOf("<body"), page);
  }
});

test("every classic script of the pages can be joined: one call each, no declarations at the top", () => {
  for (const page of Object.keys(PAGES)) {
    for (const group of classicGroups(read(page))) {
      const code = joinClassic(group.scripts.map(({ file }) => ({ file, code: read(file) })));
      assert.ok(code.length > 100, page);
      // no syntax newer than the files themselves use
      assert.doesNotMatch(code, /\?\?|\?\.[a-zA-Z_$[(]/, page);
    }
  }
});

test("joined scripts run in order, and one that throws doesn't stop the next", async () => {
  const code = joinClassic([
    { file: "a.js", code: "(function () { window.order.push('a'); })();" },
    { file: "b.js", code: "(function () { throw new Error('b broke'); })();" },
    { file: "c.js", code: "window.order.push('c');" },
  ]);
  const thrown = [];
  const window = { order: [] };
  vm.runInNewContext(code, { window, setTimeout: (fn) => { try { fn(); } catch (e) { thrown.push(e.message); } } });
  assert.deepEqual(window.order, ["a", "c"]);
  assert.deepEqual(thrown, ["b broke"]);
});

test("a script with a declaration at the top is refused: joined, it would no longer be global", () => {
  assert.throws(() => joinClassic([{ file: "x.js", code: "var shared = 1;" }]), /x\.js.*VariableDeclaration/);
  assert.throws(() => joinClassic([{ file: "y.js", code: "function helper() {}" }]), /y\.js.*FunctionDeclaration/);
});

test("a page's messages are the shared ones and its own, per language, with no key in both", () => {
  for (const name of Object.values(PAGES)) {
    const built = pageMessages(root, name);
    assert.deepEqual(Object.keys(built), ["en", "fr", "nl"]);
    for (const [lang, json] of Object.entries(built)) {
      const shared = JSON.parse(read(`src/shared/i18n/shared.${lang}.json`));
      const own = JSON.parse(read(`src/shared/i18n/${name}.${lang}.json`));
      assert.deepEqual(JSON.parse(json), { ...shared, ...own });
      assert.equal(Object.keys(JSON.parse(json)).length, Object.keys(shared).length + Object.keys(own).length);
    }
  }
});

/** src/shared/i18n.js run as a page's <head> script, with what it fetched. */
async function runI18n(attrs, lang = "nl") {
  const fetched = [];
  const listeners = {};
  const script = { src: "https://site.example/src/shared/i18n.js", getAttribute: (k) => attrs[k] ?? null };
  const document = {
    currentScript: script,
    readyState: "complete",
    cookie: "",
    documentElement: { lang: "", classList: { add() {}, remove() {} } },
    head: { appendChild() {} },
    createElement: () => ({}),
    querySelectorAll: () => [],
    addEventListener: (type, fn) => (listeners[type] = fn),
  };
  const window = {
    document,
    location: { href: `https://site.example/?lang=${lang}`, search: `?lang=${lang}` },
    navigator: { languages: ["en"] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: (url) => (fetched.push(String(url)), Promise.resolve({ ok: true, json: () => Promise.resolve({ ["k." + fetched.length]: String(url) }) })),
    setTimeout, URL, URLSearchParams, Intl, Promise, JSON, Object,
  };
  window.window = window;
  vm.runInNewContext(read("src/shared/i18n.js"), Object.assign(window, { fetch: window.fetch }));
  await window.BEmeshI18n.ready;
  return fetched;
}

test("a page as it is asks for the shared and its own messages; a built page for its one file per language", async () => {
  assert.deepEqual(await runI18n({ "data-i18n-page": "map" }), [
    "https://site.example/src/shared/i18n/shared.en.json",
    "https://site.example/src/shared/i18n/map.en.json",
    "https://site.example/src/shared/i18n/shared.nl.json",
    "https://site.example/src/shared/i18n/map.nl.json",
  ]);
  const files = JSON.stringify({ en: "/assets/map.en-1.json", nl: "/assets/map.nl-2.json", fr: "/assets/map.fr-3.json" });
  assert.deepEqual(await runI18n({ "data-i18n-page": "map", "data-i18n-files": files }), ["/assets/map.en-1.json", "/assets/map.nl-2.json"]);
  assert.deepEqual(await runI18n({ "data-i18n-page": "map", "data-i18n-files": files }, "en"), ["/assets/map.en-1.json"]);
  // a list that can't be read: the files one by one, as without it
  assert.equal((await runI18n({ "data-i18n-page": "map", "data-i18n-files": "{oops" })).length, 4);
});
