import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import links from "../../../src/shared/bemesh-links.json";

/** Every message file of the site: one scope per page plus the shared top bar, menu and place names. */
const LANGS = ["en", "nl", "fr"] as const;
const LOCALES = { en: "en-GB", nl: "nl-BE", fr: "fr-FR" };
const SHARED = resolve(__dirname, "../../../src/shared/i18n");
const SCOPES: Record<string, (lang: string) => string> = {
  shared: (l) => `${SHARED}/shared.${l}.json`,
  map: (l) => `${SHARED}/map.${l}.json`,
  stats: (l) => `${SHARED}/stats.${l}.json`,
  "region-map": (l) => `${SHARED}/region-map.${l}.json`,
  configurator: (l) => resolve(__dirname, `../src/i18n/${l}.json`),
};
const read = (file: string): Record<string, string> => JSON.parse(readFileSync(file, "utf8"));
const CATEGORIES = ["zero", "one", "two", "few", "many", "other"];
const pluralBase = (key: string) => {
  const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(key);
  return m ? m[1] : null;
};
const placeholders = (s: string | undefined) => [...new Set([...(s ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

/** Keys without their plural suffix, and the plural forms each base has. */
function shape(dict: Record<string, string>) {
  const plain = new Set<string>();
  const plurals = new Map<string, Set<string>>();
  for (const key of Object.keys(dict)) {
    const base = pluralBase(key);
    if (base) {
      if (!plurals.has(base)) plurals.set(base, new Set());
      plurals.get(base)!.add(key.slice(base.length + 1));
    } else plain.add(key);
  }
  return { plain, plurals };
}

describe.each(Object.keys(SCOPES))("messages: %s", (scope) => {
  const files = Object.fromEntries(LANGS.map((l) => [l, read(SCOPES[scope](l))])) as Record<(typeof LANGS)[number], Record<string, string>>;
  const en = shape(files.en);

  // Dutch and French may still miss keys (they fall back to English; `npm run i18n:missing` lists
  // them), but what they hold must match English.
  it.each(["nl", "fr"] as const)("%s has no keys English lacks", (lang) => {
    const other = shape(files[lang]);
    expect([...other.plain].filter((k) => !en.plain.has(k))).toEqual([]);
    expect([...other.plurals.keys()].filter((k) => !en.plurals.has(k))).toEqual([]);
  });

  it.each(LANGS)("%s has exactly the plural forms its language uses", (lang) => {
    const want = new Intl.PluralRules(LOCALES[lang]).resolvedOptions().pluralCategories.slice().sort();
    for (const [base, forms] of shape(files[lang]).plurals) {
      expect([base, [...forms].sort()]).toEqual([base, want]);
      for (const f of forms) expect(CATEGORIES).toContain(f);
    }
  });

  it.each(["nl", "fr"] as const)("%s keeps each key's {placeholders}", (lang) => {
    for (const [key, text] of Object.entries(files[lang])) {
      const base = pluralBase(key);
      const ref = base ? files.en[`${base}_other`] : files.en[key];
      expect([key, placeholders(text)]).toEqual([key, placeholders(ref)]);
    }
  });

  it.each(LANGS)("%s has no empty text except where English is empty", (lang) => {
    for (const [key, text] of Object.entries(files[lang])) {
      if (files.en[key] === "") continue;
      expect([key, text.trim().length > 0]).toEqual([key, true]);
    }
  });
});

describe("shared keys", () => {
  it("are defined once: the configurator does not repeat a shared key", () => {
    const shared = read(SCOPES.shared("en"));
    const own = read(SCOPES.configurator("en"));
    expect(Object.keys(own).filter((k) => k in shared)).toEqual([]);
  });

  it("cover every link in bemesh-links.json", () => {
    const shared = read(SCOPES.shared("en"));
    for (const l of links) {
      expect(shared[l.key]).toBeTruthy();
      expect(shared[`${l.key}.title`]).toBeTruthy();
    }
  });
});

describe("English", () => {
  /** Keys the code names literally: t("…"), tr("…"), data-i18n="…" and data-i18n-attr="attr:…". */
  function usedKeys(file: string): string[] {
    const src = readFileSync(file, "utf8");
    const keys = [...src.matchAll(/\b(?:t|tr)\(\s*["']([\w.-]+)["']/g)].map((m) => m[1]);
    keys.push(...[...src.matchAll(/data-i18n(?:-html)?="([\w.-]+)"/g)].map((m) => m[1]));
    for (const m of src.matchAll(/data-i18n-attr="([^"]+)"/g)) keys.push(...m[1].split(";").map((p) => p.split(":")[1].trim()));
    return keys.filter((k) => k.includes(".") && !k.endsWith("."));
  }
  const all = (dir: string, ext: RegExp): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? all(`${dir}/${e.name}`, ext) : ext.test(e.name) ? [`${dir}/${e.name}`] : [],
    );
  const ROOT = resolve(__dirname, "../../..");
  const has = (dict: Record<string, string>, key: string) => key in dict || `${key}_other` in dict;

  it("has every key the tool pages use", () => {
    const en = { ...read(SCOPES.shared("en")), ...read(SCOPES.map("en")), ...read(SCOPES.stats("en")), ...read(SCOPES["region-map"]("en")) };
    const files = ["index.html", "stats.html", "region-map.html", "src/map.js", "src/stats.js", "src/region-map.js", "src/shared/topbar.js"];
    const missing = files.flatMap((f) => usedKeys(`${ROOT}/${f}`).filter((k) => !has(en, k)).map((k) => `${f}: ${k}`));
    expect(missing).toEqual([]);
  });

  it("has every key the configurator uses", () => {
    const en = { ...read(SCOPES.shared("en")), ...read(SCOPES.configurator("en")) };
    const missing = all(resolve(__dirname, "../src"), /\.tsx?$/).flatMap((f) =>
      usedKeys(f)
        .filter((k) => !has(en, k))
        .map((k) => `${f}: ${k}`),
    );
    expect(missing).toEqual([]);
  });
});
