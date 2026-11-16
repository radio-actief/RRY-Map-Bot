import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore plain JS module of the map page
import * as cov from "../../../src/coverage/coverage.js";
// @ts-ignore plain JS module of the map page
import { antennaPatternGain, getSensitivity, FADE_MARGIN_DB, RECEIVER } from "../../../src/coverage/coverage-model.js";
// @ts-ignore plain JS module of the map page
import { getClearance, getProfileLines } from "../../../src/coverage/profile-chart.js";
// @ts-ignore plain JS module of the map page
import { addProfileEnd, closeProfile, createProfileState, sameEnds, setProfileStart, swapProfileEnds } from "../../../src/coverage/profile.js";
// @ts-ignore plain JS module of the map page
import { planningActionsHtml } from "../../../src/popup-safe.js";

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const KEY = "ab".repeat(32);
const t = (k: string) => ({ "map.plan.showCoverage": "Show coverage", "map.plan.profileFrom": "Profile from here", "map.plan.profileTo": "Profile to here" })[k] ?? k;

describe("coverage link budget", () => {
  it("has the LoRa sensitivity of the #BEmesh preset (SF8, 62.5 kHz) and the 10 dB margin", () => {
    expect(getSensitivity({ bw: 62.5, sf: 8 })).toBeCloseTo(-130.04, 2);
    expect(getSensitivity({ bw: 250, sf: 11 })).toBeCloseTo(-131.52, 2);
    expect(FADE_MARGIN_DB).toBe(10);
    expect(RECEIVER).toEqual({ height: 2, gain: 2 });
  });

  it("rates links in bars by their margin over the fade margin", () => {
    expect([-1, 0, 9.9, 10, 19.9, 20, 45].map(cov.getLinkBars)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it("gives a directional antenna its gain in front and less behind it", () => {
    expect(antennaPatternGain({ antennaType: "omni", beamWidth: 60, direction: 0 }, 180)).toBe(0);
    expect(antennaPatternGain({ antennaType: "yagi", beamWidth: 60, direction: 90 }, 90)).toBeCloseTo(0, 9);
    expect(antennaPatternGain({ antennaType: "yagi", beamWidth: 60, direction: 90 }, 120)).toBeCloseTo(-3, 5);
    expect(antennaPatternGain({ antennaType: "yagi", beamWidth: 60, direction: 90 }, 270)).toBe(-15);
    expect(antennaPatternGain({ antennaType: "panel", beamWidth: 60, direction: 0 }, 180)).toBe(-25);
  });
});

describe("coverage settings", () => {
  it("start at 868 MHz with the #BEmesh radio, 22 dBm, 2 dBi, 10 m and 40 km", () => {
    expect(cov.DEFAULT_SETTINGS).toMatchObject({ frequency: 868, txPower: 22, antennaGain: 2, antennaHeight: 10, distanceKm: 40, antennaType: "omni" });
    expect(cov.getCoverageRadio({}, cov.DEFAULT_SETTINGS)).toEqual({ freq: 869.618, bw: 62.5, sf: 8 });
    expect(cov.BEMESH_PRESET_NAME).toBe("EU/UK (Narrow)");
  });

  it("use the node's own radio params in the band, else the band's start values", () => {
    const node = { params: { freq: "869.525", bw: "250", sf: "11", cr: "5" } };
    expect(cov.getCoverageRadio(node, cov.DEFAULT_SETTINGS)).toEqual({ freq: 869.525, bw: 250, sf: 11 });
    expect(cov.getCoverageRadio(node, { ...cov.DEFAULT_SETTINGS, frequency: 433 })).toEqual({ freq: 433.65, bw: 250, sf: 11 });
    expect(cov.getCoverageRadio({ params: { freq: 869.618, bw: 62.5, sf: 99 } }, cov.DEFAULT_SETTINGS)).toEqual({ freq: 869.618, bw: 62.5, sf: 8 });
  });

  it("go into a URL and come back the same", () => {
    const settings = { ...cov.DEFAULT_SETTINGS, frequency: 433, txPower: 27, antennaGain: 5.5, antennaHeight: 30, distanceKm: 120, clutter: false, ridgeRounding: 0.5, nodeDisplay: "all", antennaType: "yagi", beamWidth: 45, direction: 270 };
    const text = cov.encodeCoverageSettings(settings);
    expect(text).toBe("433,27,5.5,30,120,0,0.5,a,y,45,270");
    expect(cov.applyCoverageSettings(text, { ...cov.DEFAULT_SETTINGS })).toEqual(settings);
  });

  it("from a URL keep only allowed values, and read the older eight-value links", () => {
    const s = cov.applyCoverageSettings("915,99,5,10,40,1,0.3,x,z,7,400", { ...cov.DEFAULT_SETTINGS });
    expect(s).toEqual({ ...cov.DEFAULT_SETTINGS, antennaGain: 5 });
    expect(cov.applyCoverageSettings("868,30,8,20,250,1,1,r", { ...cov.DEFAULT_SETTINGS })).toMatchObject({ txPower: 30, antennaGain: 8, antennaHeight: 20, distanceKm: 250, ridgeRounding: 1 });
    expect(cov.applyCoverageSettings("<b>,,,", { ...cov.DEFAULT_SETTINGS })).toEqual(cov.DEFAULT_SETTINGS);
  });

  it("from storage keep only known keys with allowed values", () => {
    expect(cov.sanitizeSettings('{"txPower":30,"evil":1,"frequency":915,"direction":12.5}')).toEqual({ ...cov.DEFAULT_SETTINGS, txPower: 30 });
    expect(cov.sanitizeSettings("not json")).toEqual(cov.DEFAULT_SETTINGS);
    expect(cov.sanitizeSettings(null)).toEqual(cov.DEFAULT_SETTINGS);
  });

  it("pick the radio of the repeaters around a picked point", () => {
    const rep = (lat: number, params: object) => ({ lat, lon: 3.7, type: 2, params });
    const narrow = { freq: 869.618, bw: 62.5, sf: 8 };
    const nodes = [rep(51.05, narrow), rep(51.06, narrow), rep(51.07, { freq: 869.525, bw: 250, sf: 11 }), rep(53, { freq: 869.525, bw: 250, sf: 11 })];
    expect(cov.getLocalRadioParams(51.05, 3.7, nodes, cov.DEFAULT_SETTINGS)).toEqual(narrow);
    expect(cov.getLocalRadioParams(45, 3.7, nodes, cov.DEFAULT_SETTINGS)).toBeNull();
  });
});

describe("coverage and profile in the URL", () => {
  it("writes a node as its key and a point as lat,lon, and reads them back", () => {
    expect(cov.encodeSite({ publicKey: KEY })).toBe(KEY);
    expect(cov.encodeSite({ lat: 51.054321234, lon: 3.71234567 })).toBe("51.05432,3.71235");
    expect(cov.decodeSite(KEY.toUpperCase())).toEqual({ publicKey: KEY });
    expect(cov.decodeSite("51.05432,3.71235")).toEqual({ lat: 51.05432, lon: 3.71235 });
    for (const bad of ["", "abc", "91,3", "51,181", "51", "51,3,4", ",3", "<script>", undefined]) expect(cov.decodeSite(bad)).toBeNull();
  });

  it("reads antenna heights of the profile ends within the slider's range", () => {
    expect(cov.decodeHeights("12,2")).toEqual([12, 2]);
    expect(cov.decodeHeights("301,x")).toEqual([null, null]);
    expect(cov.decodeHeights(undefined)).toEqual([null, null]);
  });

  it("turns the image corners into Leaflet bounds", () => {
    const corners = [[3, 52], [5, 52], [5, 50], [3, 50]];
    expect(cov.cornersToLatLngBounds(corners)).toEqual([[50, 3], [52, 5]]);
    const [[w, s], [e, n]] = cov.getCoverageBounds(4, 51, 40);
    expect(n - 51).toBeCloseTo(0.3597, 3);
    expect(51 - s).toBeCloseTo(0.3597, 3);
    expect(e - 4).toBeGreaterThan(n - 51);
    expect(4 - w).toBeCloseTo(e - 4, 9);
  });
});

describe("profile", () => {
  const flat = (n: number, hill = 0) => {
    const elevations = new Float32Array(n + 1).fill(10);
    if (hill) elevations[n >> 1] = hill;
    return { elevations, trees: new Float32Array(n + 1), buildings: new Float32Array(n + 1), buildingsEstimated: new Uint8Array(n + 1), stepLength: 100, distance: n * 100, wavelength: 299.792458 / 869.618, refractionK: 4 / 3 };
  };

  it("draws the line of sight from mast top to mast top, with the Fresnel zone around it", () => {
    const samples = getProfileLines(flat(100), 30, 10);
    expect(samples).toHaveLength(101);
    expect(samples[0].los).toBe(40);
    expect(samples[100].los).toBe(20);
    expect(samples[0].fresnel).toBe(0);
    expect(samples[50].fresnel).toBeCloseTo(Math.sqrt((299.792458 / 869.618) * 5000 * 5000 / 10000), 6);
  });

  it("says whether the path is clear, partly obstructed or blocked, and where it is tightest", () => {
    expect(getClearance(getProfileLines(flat(100), 30, 30)).status).toBe("clear");
    const blocked = getClearance(getProfileLines(flat(100, 80), 30, 30));
    expect(blocked.status).toBe("blocked");
    expect(blocked.index).toBe(50);
    expect(getClearance(getProfileLines(flat(100, 33), 30, 30)).status).toBe("fresnel");
  });

  it("adds the start first, then the end; swaps both ends and their heights", () => {
    const p = createProfileState();
    addProfileEnd(p, { publicKey: KEY });
    expect(p.a).toEqual({ publicKey: KEY });
    addProfileEnd(p, { lat: 51, lon: 3 });
    expect(p.b).toEqual({ lat: 51, lon: 3 });
    p.heightA = 20;
    swapProfileEnds(p);
    expect([p.a, p.b, p.heightA, p.heightB]).toEqual([{ lat: 51, lon: 3 }, { publicKey: KEY }, 10, 20]);
    setProfileStart(p, { lat: 50, lon: 4 });
    expect(p.a).toEqual({ lat: 50, lon: 4 });
    expect(sameEnds({ lat: 1, lon: 2 }, { lat: 1, lon: 2 })).toBe(true);
    expect(sameEnds({ publicKey: KEY }, { lat: 1, lon: 2 })).toBe(false);
    closeProfile(p);
    expect([p.a, p.b]).toEqual([null, null]);
  });
});

describe("the popup's coverage and profile actions", () => {
  const actions = (html: string) => Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("[data-plan-action]")).map((b) => [b.getAttribute("data-plan-action"), b.getAttribute("data-public-key"), b.textContent]);

  it("offer coverage for repeaters and a profile from any node", () => {
    expect(actions(planningActionsHtml({ public_key: KEY.toUpperCase(), type: 2 }, null, t))).toEqual([
      ["coverage", KEY, "Show coverage"],
      ["profile-from", KEY, "Profile from here"],
    ]);
    expect(actions(planningActionsHtml({ public_key: KEY, type: 1 }, { a: null, b: null }, t))).toEqual([["profile-from", KEY, "Profile from here"]]);
  });

  it("offer the profile's end once it has a start, but not on the start itself", () => {
    const other = "cd".repeat(32);
    expect(actions(planningActionsHtml({ public_key: other, type: 1 }, { a: { publicKey: KEY }, b: null }, t))).toEqual([["profile-to", other, "Profile to here"]]);
    expect(actions(planningActionsHtml({ public_key: KEY, type: 1 }, { a: { publicKey: KEY }, b: null }, t))).toEqual([]);
    expect(actions(planningActionsHtml({ public_key: KEY, type: 1 }, { a: { lat: 1, lon: 2 }, b: null }, t))).toEqual([["profile-to", KEY, "Profile to here"]]);
  });

  it("carry only a full hex key and escape their texts", () => {
    for (const bad of ['ab" onclick="x', "abcd", "", null, `${KEY}"><img src=x>`]) {
      expect(planningActionsHtml({ public_key: bad, type: 2 }, null, t)).toBe("");
    }
    const html = planningActionsHtml({ public_key: KEY, type: 2 }, null, () => '<img src=x onerror="y">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&#60;img");
  });
});

describe("the coverage tools' texts", () => {
  it("never break a range or a value from its unit across lines, in any language", () => {
    for (const lang of ["en", "nl", "fr"]) {
      const texts = Object.values(JSON.parse(read(`src/shared/i18n/coverage.${lang}.json`))) as string[];
      for (const text of texts) {
        expect(text, `${lang}: ${text}`).not.toMatch(/(\d|\}) (dB|m|km|kHz|MHz)\b/);
        expect(text, `${lang}: ${text}`).not.toMatch(/\d–\d/);
      }
    }
  });
});

describe("the map page loads the coverage tools only when they are used", () => {
  const mapJs = read("src/map.js");

  it("imports nothing of src/coverage up front", () => {
    expect(mapJs).not.toMatch(/^\s*import\s[^;]*["']\.\/coverage\//m);
    expect(mapJs).not.toMatch(/^\s*import\s+["']\.\/coverage\//m);
    expect(mapJs).toMatch(/import\(\s*["']\.\/coverage\/planning\.js["']\s*\)/);
  });

  it("starts the model as a module worker from its own file", () => {
    expect(read("src/coverage/coverage.js")).toContain("new Worker(new URL('./coverage-worker.js', import.meta.url), { type: 'module' })");
  });

  it("credits the original in every adapted file and keeps its licence", () => {
    for (const f of ["coverage.js", "coverage-model.js", "coverage-worker.js", "mvt.js", "profile.js", "profile-chart.js", "planning.js"]) {
      expect(read(`src/coverage/${f}`), f).toContain("Adapted from map.meshcore.io (https://github.com/meshcore-dev/map.meshcore.io), MIT License,\n// Copyright (c) 2025 Rastislav Vysoky");
    }
    expect(read("src/coverage/LICENSE")).toMatch(/MIT License[\s\S]*Copyright \(c\) 2025 Rastislav Vysoky/);
  });

  it("fetches terrain and land cover from Mapterhorn and OpenFreeMap only", () => {
    const model = read("src/coverage/coverage-model.js");
    const hosts = new Set([...model.matchAll(/'https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]));
    expect([...hosts].sort()).toEqual(["tiles.mapterhorn.com", "tiles.openfreemap.org"]);
  });
});
