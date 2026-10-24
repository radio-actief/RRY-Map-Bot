import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rankPlaces, type Place } from "../src/core/search";

const PLACES: Place[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "data/be-locode.json"), "utf8"),
);

const names = (query: string) => rankPlaces(PLACES, query).map((c) => c.plaats);

describe("rankPlaces", () => {
  it("ranks an exact place name before an old-village-name match", () => {
    // Lievegem matches through its deelgemeente RONSELE.
    const result = names("Ronse");
    expect(result[0]).toBe("Ronse");
    expect(result).toContain("Lievegem");
  });

  it("ignores case and accents", () => {
    expect(names("ronse")[0]).toBe("Ronse");
    expect(names("LIÈGE")[0]).toBe(names("liege")[0]);
  });

  it("ranks a name starting with the query above one merely containing it", () => {
    const result = names("Gent");
    expect(result[0]).toBe("Gent");
    const starts = result.findIndex((n) => n.toLowerCase().startsWith("gent") && n !== "Gent");
    const contains = result.findIndex((n) => !n.toLowerCase().startsWith("gent"));
    if (starts !== -1 && contains !== -1) expect(starts).toBeLessThan(contains);
  });

  it("treats the city code itself as an exact match", () => {
    expect(names("beron")[0]).toBe("Ronse");
  });

  it("keeps the data order within the same rank", () => {
    const rows = [
      { plaats: "Bxa", gemeente: "Bxa", city_code: "bea" },
      { plaats: "Axb", gemeente: "Axb", city_code: "beb" },
    ] as Place[];
    expect(rankPlaces(rows, "x").map((c) => c.plaats)).toEqual(["Bxa", "Axb"]);
  });

  it("returns nothing for an empty query", () => {
    expect(rankPlaces(PLACES, "")).toEqual([]);
  });
});
