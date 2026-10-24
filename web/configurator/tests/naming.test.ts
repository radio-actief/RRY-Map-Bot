import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildName,
  buildPrefix,
  checkName,
  checkOwnerInfo,
  encodeOwnerInfo,
  prefixFormatFromLegacy,
  splitNameSuffixAndEmoji,
  trimUtf8ToMaxBytes,
  utf8Bytes,
} from "../src/core/naming";
import type { Place } from "../src/core/search";

const PLACES: Place[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "data/be-locode.json"), "utf8"),
);
const ronse = PLACES.find((p) => p.plaats === "Ronse")!;

describe("buildPrefix", () => {
  it("builds city, province, country and no prefix", () => {
    expect(buildPrefix("city", ronse, null)).toBe("BE-RON-");
    expect(buildPrefix("province", ronse, null)).toBe(
      "BE-" + ronse.province_code.replace(/^be-/i, "").toUpperCase() + "-",
    );
    expect(buildPrefix("province", null, "be-vov")).toBe("BE-VOV-");
    expect(buildPrefix("country", null, null)).toBe("BE-");
    expect(buildPrefix("none", ronse, null)).toBe("");
  });
  it("is empty when the format needs a place that is missing", () => {
    expect(buildPrefix("city", null, null)).toBe("");
    expect(buildPrefix("province", null, null)).toBe("");
  });
});

describe("names", () => {
  it("joins prefix, trimmed suffix and power emoji", () => {
    expect(buildName("BE-RON-", " Kluisberg ", "🌞")).toBe("BE-RON-Kluisberg🌞");
  });
  it("accepts a name that fits with a location", () => {
    const r = checkName("BE-RON-Kluisberg🌞", true);
    expect(r.bytes).toBe(20);
    expect(r.ok).toBe(true);
  });
  it("rejects 21 ASCII characters plus an emoji with a location", () => {
    const r = checkName("a".repeat(21) + "🌞", true);
    expect(r.bytes).toBe(25);
    expect(r.ok).toBe(false);
    expect(checkName("a".repeat(21) + "🌞", false).ok).toBe(true);
  });
  it("lists the characters the firmware rejects", () => {
    expect(checkName("a:b", false).badChars).toEqual([":"]);
    expect(checkName("a:b", false).ok).toBe(false);
    expect(checkName("[]\\:,?*", false).badChars).toEqual(["[", "]", "\\", ":", ",", "?", "*"]);
  });
  it("splits a trailing power emoji", () => {
    expect(splitNameSuffixAndEmoji("BE-RON-X🔋")).toEqual({ suffix: "BE-RON-X", power: "🔋" });
    expect(splitNameSuffixAndEmoji("plain")).toEqual({ suffix: "plain", power: "" });
  });
  it("trims on code point boundaries", () => {
    expect(trimUtf8ToMaxBytes("ab🌞", 5)).toBe("ab");
    expect(utf8Bytes(trimUtf8ToMaxBytes("éééé", 5))).toBe(4);
  });
  it("maps the legacy select values", () => {
    for (const v of ["city", "province", "country", "none"] as const) {
      expect(prefixFormatFromLegacy(v)).toBe(v);
    }
    expect(prefixFormatFromLegacy("")).toBe("city");
  });
});

describe("owner info", () => {
  it("encodes newlines as pipes", () => {
    expect(encodeOwnerInfo("a\nb")).toBe("a|b");
    expect(encodeOwnerInfo("a\r\nb")).toBe("a|b");
  });
  it("limits to 119 bytes of the encoded form", () => {
    expect(checkOwnerInfo("x".repeat(119)).ok).toBe(true);
    expect(checkOwnerInfo("x".repeat(120)).ok).toBe(false);
    const r = checkOwnerInfo("é".repeat(60));
    expect(r.bytes).toBe(120);
    expect(r.ok).toBe(false);
  });
});
