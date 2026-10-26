import { describe, expect, it } from "vitest";
import {
  allowanceOf,
  blockChanges,
  blockKeys,
  BLOCKS,
  isBlockRecommended,
  recommendedFor,
  recommendedForAll,
  undoBlock,
} from "../src/core/blocks";
import { defaultPlan, newPlan, type Plan } from "../src/core/plan";
import { FLOOD_ALLOWANCE } from "../src/core/settings";
import { SITE_PROFILES, withTiming } from "../src/core/site";

const withSettings = (plan: Plan, s: Plan["settings"]): Plan => ({ ...plan, settings: { ...plan.settings, ...s } });

describe("a new plan's hop allowance", () => {
  it("starts on Average, so a level is selected; the default plan keeps the old page's 12/8", () => {
    expect(allowanceOf(newPlan())).toBe("average");
    expect(isBlockRecommended(newPlan(), "advertising")).toBe(true);
    const d = defaultPlan().settings;
    expect([d.floodMaxUnscoped, d.floodMaxAdvert]).toEqual([12, 8]);
    expect(allowanceOf(defaultPlan())).toBeNull();
  });
});

describe("blocks", () => {
  it("lists the four blocks in order", () => {
    expect(BLOCKS).toEqual(["radio", "advertising", "repeating", "advanced"]);
    expect(blockKeys("advertising")).toEqual(["floodAdvertHours", "advertIntervalMinutes", "floodMaxUnscoped", "floodMaxAdvert"]);
    expect(blockKeys("advanced")).toEqual([
      "pathHashMode", "txdelay", "directTxdelay", "rxdelay", "radioRxgain", "intThresh", "agcResetInterval", "multiAcks",
    ]);
  });

  it("FLOOD_ALLOWANCE has tight first", () => {
    expect(Object.keys(FLOOD_ALLOWANCE)).toEqual(["tight", "minimal", "average", "extended", "full"]);
  });

  it("advertising recommends 47 and always the average hop allowance", () => {
    const r = recommendedFor(withSettings(defaultPlan(), { floodAdvertHours: 12 }), "advertising");
    expect(r.settings.floodAdvertHours).toBe(47);
    expect([r.settings.floodMaxUnscoped, r.settings.floodMaxAdvert]).toEqual([8, 12]);
    for (const [u, a] of [[2, 3], [64, 64], [16, 24]]) {
      const other = recommendedFor(withSettings(defaultPlan(), { floodMaxUnscoped: u, floodMaxAdvert: a }), "advertising");
      expect(allowanceOf(other)).toBe("average");
    }
  });

  it("radio leaves txPower and other blocks alone", () => {
    const plan = withSettings(defaultPlan(), { txPower: 20, floodAdvertHours: 12, dutycycle: "50" });
    const r = recommendedFor({ ...plan, radio: { ...plan.radio, freq: 869 }, radioText: { sf: "x" }, radioCustom: true }, "radio");
    expect(r.settings.txPower).toBe(20);
    expect(r.settings.floodAdvertHours).toBe(12);
    expect(r.settings.dutycycle).toBe("10");
    expect(r.radio).toEqual(defaultPlan().radio);
    expect(r.radioText).toBeUndefined();
    expect(r.radioCustom).toBeUndefined();
  });

  it("advanced keeps a known profile and falls back to Suburban", () => {
    const hill = recommendedFor(withTiming(newPlan(), SITE_PROFILES.hilltop), "advanced");
    expect([hill.settings.txdelay, hill.settings.directTxdelay, hill.settings.rxdelay]).toEqual([2, 2, 3]);
    const odd = recommendedFor(withTiming(newPlan(), { txdelay: 0.6, directTxdelay: 0.2, rxdelay: 0 }), "advanced");
    expect([odd.settings.txdelay, odd.settings.directTxdelay, odd.settings.rxdelay]).toEqual([0.8, 0.4, 3]);
    expect(odd.settings.pathHashMode).toBe("1");
    expect(odd.settings.multiAcks).toBe("0");
  });

  it("repeating recommends on / 64 / minimal", () => {
    const r = recommendedFor(withSettings(defaultPlan(), { repeat: "off", floodMax: 10, loopDetect: "strict" }), "repeating");
    expect([r.settings.repeat, r.settings.floodMax, r.settings.loopDetect]).toEqual(["on", 64, "minimal"]);
  });

  it("recommendedForAll leaves passwords and owner info", () => {
    const plan = withSettings(defaultPlan(), { adminPassword: "a", guestPassword: "g", ownerInfo: "o" });
    const r = recommendedForAll(plan);
    expect([r.settings.adminPassword, r.settings.guestPassword, r.settings.ownerInfo]).toEqual(["a", "g", "o"]);
  });

  it("everything is recommended after recommendedForAll", () => {
    const all = recommendedForAll(defaultPlan());
    for (const b of BLOCKS) expect(isBlockRecommended(all, b)).toBe(true);
    expect(isBlockRecommended(withSettings(all, { loopDetect: "strict" }), "repeating")).toBe(false);
  });

  it("radio is not recommended with another freq, radioText or the custom flag", () => {
    const plan = defaultPlan();
    expect(isBlockRecommended(plan, "radio")).toBe(true);
    expect(isBlockRecommended({ ...plan, radio: { ...plan.radio, freq: 869 } }, "radio")).toBe(false);
    expect(isBlockRecommended({ ...plan, radioText: { sf: "x" } }, "radio")).toBe(false);
    expect(isBlockRecommended({ ...plan, radioCustom: true }, "radio")).toBe(false);
  });

  it("counts a radio change when only radioText is set", () => {
    const start = defaultPlan();
    expect(blockChanges({ ...start, radioText: { sf: "x" } }, start, "radio")).toBe(1);
  });

  it("counts changes against start and undo restores it", () => {
    const start = withSettings(defaultPlan(), { loopDetect: "minimal", floodMax: 32 });
    const plan = withSettings(start, { loopDetect: "strict", floodMax: 64 });
    expect(blockChanges(plan, start, "repeating")).toBe(2);
    const undone = undoBlock(plan, start, "repeating");
    expect(undone.settings.floodMax).toBe(32);
    expect(blockChanges(undone, start, "repeating")).toBe(0);
  });

  it("never counts the admin password", () => {
    const start = defaultPlan();
    for (const b of BLOCKS) expect(blockChanges(withSettings(start, { adminPassword: "x" }), start, b)).toBe(0);
  });

  it("deletes keys absent in start on undo", () => {
    const start = defaultPlan();
    delete start.settings.txPower;
    const r = undoBlock(withSettings(start, { txPower: 20 }), start, "radio");
    expect("txPower" in r.settings).toBe(false);
  });

  it("radio undo restores the radio and clears radioText", () => {
    const start = defaultPlan();
    const plan: Plan = { ...start, radio: { ...start.radio, freq: 869 }, radioText: { sf: "x" }, radioCustom: true };
    expect(blockChanges(plan, start, "radio")).toBe(1);
    const r = undoBlock(plan, start, "radio");
    expect(r.radio).toEqual(start.radio);
    expect(r.radioText).toBeUndefined();
    expect(r.radioCustom).toBeUndefined();
    expect(blockChanges(r, start, "radio")).toBe(0);
  });
});
