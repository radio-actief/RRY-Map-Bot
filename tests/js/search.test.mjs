import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfiguratorModules } from "./load-module.mjs";

const { search } = loadConfiguratorModules("src/configurator/search.js").ConfiguratorApp;
const CITIES = JSON.parse(
  readFileSync(new URL("../../data/be-locode.json", import.meta.url), "utf8"),
);

function names(query) {
  return search.rankPlaces(CITIES, query).map((c) => c.plaats);
}

test("an exact place name comes before an old-village-name match", () => {
  // Lievegem matches through its deelgemeente RONSELE.
  const result = names("Ronse");
  assert.equal(result[0], "Ronse");
  assert.ok(result.includes("Lievegem"));
});

test("matching ignores case and accents", () => {
  assert.equal(names("ronse")[0], "Ronse");
  assert.equal(names("LIÈGE")[0], names("liege")[0]);
});

test("a name starting with the query ranks above one merely containing it", () => {
  const result = names("Gent");
  assert.equal(result[0], "Gent");
  const starts = result.findIndex((n) => n.toLowerCase().startsWith("gent") && n !== "Gent");
  const contains = result.findIndex((n) => !n.toLowerCase().startsWith("gent"));
  if (starts !== -1 && contains !== -1) assert.ok(starts < contains);
});

test("the city code itself is an exact match", () => {
  assert.equal(names("beron")[0], "Ronse");
});

test("keeps the data order within the same rank", () => {
  const result = search.rankPlaces(
    [
      { plaats: "Bxa", gemeente: "Bxa", city_code: "bea" },
      { plaats: "Axb", gemeente: "Axb", city_code: "beb" },
    ],
    "x",
  );
  assert.deepEqual(Array.from(result, (c) => c.plaats), ["Bxa", "Axb"]);
});
