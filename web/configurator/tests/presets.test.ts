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
