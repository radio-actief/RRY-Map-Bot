// Lists the Dutch and French message keys that are still missing (those texts fall back to English).
// Usage: npm run i18n:missing            (one line per missing key, then a count per language)
//        npm run i18n:missing -- --json  (a JSON object: { "<file>": ["key", ...] })
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHARED = join(root, "src/shared/i18n");
const SCOPES = {
  shared: (l) => join(SHARED, `shared.${l}.json`),
  map: (l) => join(SHARED, `map.${l}.json`),
  stats: (l) => join(SHARED, `stats.${l}.json`),
  "region-map": (l) => join(SHARED, `region-map.${l}.json`),
  configurator: (l) => join(root, `web/configurator/src/i18n/${l}.json`),
};
const LOCALES = { nl: "nl-BE", fr: "fr-FR" };
const read = (f) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
};
const pluralBase = (k) => /^(.*)_(zero|one|two|few|many|other)$/.exec(k)?.[1] ?? null;

const missing = {};
const counts = { nl: 0, fr: 0 };
for (const [scope, file] of Object.entries(SCOPES)) {
  const en = read(file("en"));
  for (const lang of ["nl", "fr"]) {
    const dict = read(file(lang));
    const forms = new Intl.PluralRules(LOCALES[lang]).resolvedOptions().pluralCategories;
    const want = new Set();
    for (const key of Object.keys(en)) {
      const base = pluralBase(key);
      if (base) forms.forEach((f) => want.add(`${base}_${f}`));
      else want.add(key);
    }
    const gaps = [...want].filter((k) => !(k in dict));
    const name = relative(root, file(lang));
    if (gaps.length) missing[name] = gaps;
    counts[lang] += gaps.length;
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(missing, null, 2));
} else {
  for (const [file, keys] of Object.entries(missing)) for (const k of keys) console.log(`${file}\t${k}`);
  console.log(`missing: nl ${counts.nl}, fr ${counts.fr}`);
}
