import { describe, expect, it } from "vitest";
import {
  BEMESH_PRESET_TITLE,
  FIRMWARE_DEFAULT_RADIO,
  RADIO_PRESETS,
  presetForRadio,
} from "../src/core/presets";

describe("radio presets", () => {
  it("holds the 26 official presets as numbers", () => {
    expect(RADIO_PRESETS).toHaveLength(26);
    expect(RADIO_PRESETS.map((p) => p.title)).toContain("Netherlands (Limburg)");
    for (const p of RADIO_PRESETS) {
      expect([p.freq, p.sf, p.bw, p.cr].every((n) => typeof n === "number")).toBe(true);
    }
  });

  it("finds the #BEmesh preset from its radio parameters", () => {
    expect(BEMESH_PRESET_TITLE).toBe("EU/UK (Narrow)");
    expect(presetForRadio({ freq: 869.618, sf: 8, bw: 62.5, cr: 8 })?.title).toBe("EU/UK (Narrow)");
  });

  it("returns null when nothing matches", () => {
    expect(presetForRadio({ freq: 869.618, sf: 8, bw: 62.5, cr: 5 })).toBeNull();
  });

  it("keeps the firmware default radio", () => {
    expect(FIRMWARE_DEFAULT_RADIO).toEqual({ freq: 869.618, bw: 62.5, sf: 8, cr: 5 });
  });
});

import { checkRadioValue, parseRadioField } from "../src/core/presets";
import { planErrors, defaultPlan } from "../src/core/plan";

describe("radio field limits", () => {
  it("accepts the old page's ranges and rounds bandwidth to 3 decimals", () => {
    expect(parseRadioField("freq", "150")).toBe(150);
    expect(parseRadioField("freq", "2500.1")).toBeNull();
    expect(parseRadioField("sf", "5")).toBe(5);
    expect(parseRadioField("sf", "12.5")).toBeNull();
    expect(parseRadioField("bw", "7")).toBe(7);
    expect(parseRadioField("bw", "62.12345")).toBe(62.123);
    expect(parseRadioField("cr", "9")).toBeNull();
    expect(parseRadioField("cr", "")).toBeNull();
    expect(checkRadioValue("cr", 8)).toBe(8);
  });

  it("planErrors reports raw invalid radio text and out-of-range radio values", () => {
    const base = defaultPlan();
    expect(planErrors(base).some((e) => e.key === "radio")).toBe(false);
    expect(planErrors({ ...base, radioText: { sf: "13" } }).some((e) => e.key === "radio")).toBe(true);
    expect(planErrors({ ...base, radio: { ...base.radio, sf: 4 } }).some((e) => e.key === "radio")).toBe(true);
  });
});
