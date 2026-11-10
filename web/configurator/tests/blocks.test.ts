import { describe, expect, it } from "vitest";
import {
  allowanceOf,
  floodAdvertHoursFor,
  blockChanges,
  blockKeys,
  BLOCKS,
  isBlockRecommended,
  recommendedFor,
  setFloodMaxFollow,
  withAllowance,
  recommendedForAll,
  undoBlock,
} from "../src/core/blocks";
import { defaultPlan, newPlan, type Plan } from "../src/core/plan";
import { FLOOD_ALLOWANCE } from "../src/core/settings";
import { SITE_PROFILES, withTiming } from "../src/core/site";

const withSettings = (plan: Plan, s: Plan["settings"]): Plan => ({ ...plan, settings: { ...plan.settings, ...s } });

/** A public key whose first 4 bytes are `head` (8 hex digits). */
const keyOf = (head: string) => head + "0".repeat(56);
/** Keys that pick 35, 47 and 59 h: their first 4 bytes mod 25 are 0, 12 and 24. */
const KEY_35 = keyOf("00000000");
const KEY_47 = keyOf("0000000c");
const KEY_59 = keyOf("00000018");

describe("the flood advert interval", () => {
  it("is 35 h plus the key's first 4 bytes (unsigned) mod 25, so the mesh's flood adverts do not all come at once", () => {
    expect(floodAdvertHoursFor(KEY_35)).toBe(35);
    expect(floodAdvertHoursFor(KEY_47)).toBe(47);
    expect(floodAdvertHoursFor(KEY_59)).toBe(59);
    expect(floodAdvertHoursFor(keyOf("00000019"))).toBe(35);
    // 0xffffffff = 4294967295, mod 25 = 20; 0x7bab0000 = 2074804224, mod 25 = 24.
    expect(floodAdvertHoursFor(keyOf("ffffffff"))).toBe(55);
    expect(floodAdvertHoursFor(keyOf("FFFFFFFF"))).toBe(55);
    expect(floodAdvertHoursFor(keyOf("7bab0000"))).toBe(59);
  });

  it("is 47 h while the key is not known", () => {
    expect(floodAdvertHoursFor(undefined)).toBe(47);
    expect(floodAdvertHoursFor("zz")).toBe(47);
    expect(floodAdvertHoursFor("7bab00")).toBe(47);
  });

  it("the advertising recommendation follows the plan's node key", () => {
    expect(recommendedFor({ ...defaultPlan(), nodeKey: KEY_47 }, "advertising").settings.floodAdvertHours).toBe(47);
    expect(recommendedFor({ ...defaultPlan(), nodeKey: KEY_59 }, "advertising").settings.floodAdvertHours).toBe(59);
  });

  it("treats 47, the firmware's own default, as not chosen yet: a new repeater gets its key's pick", () => {
    const plan = withSettings({ ...defaultPlan(), nodeKey: KEY_35 }, { floodAdvertHours: 47 });
    expect(recommendedFor(plan, "advertising").settings.floodAdvertHours).toBe(35);
  });

  it("keeps a repeater's own value from 35 to 59: it is already on the recommendation", () => {
    for (const h of [35, 40, 46, 48, 56, 59]) {
      const plan = withSettings({ ...defaultPlan(), nodeKey: KEY_35 }, { floodAdvertHours: h });
      expect(recommendedFor(plan, "advertising").settings.floodAdvertHours).toBe(h);
    }
  });

  it("replaces a value outside 35-59 with the one the key picks", () => {
    for (const h of [0, 12, 34, 60, 168]) {
      const plan = withSettings({ ...defaultPlan(), nodeKey: KEY_47 }, { floodAdvertHours: h });
      expect(recommendedFor(plan, "advertising").settings.floodAdvertHours).toBe(47);
    }
  });
});

describe("gain control", () => {
  it("advanced recommends an AGC reset every 4 seconds", () => {
    expect(recommendedFor(defaultPlan(), "advanced").settings.agcResetInterval).toBe(4);
  });

  it("the recommendation never touches radio.fem.rxgain", () => {
    expect("radioFemRxgain" in recommendedFor(defaultPlan(), "advanced").settings).toBe(false);
    const off = withSettings(defaultPlan(), { radioFemRxgain: "off" });
    expect(recommendedFor(off, "advanced").settings.radioFemRxgain).toBe("off");
  });

  it("a new plan starts on the AGC reset of 4", () => {
    expect(newPlan().settings.agcResetInterval).toBe(4);
    expect(isBlockRecommended(newPlan(), "advanced")).toBe(true);
  });
});

describe("a new plan's hop allowance", () => {
  it("starts on Minimal, the #BEmesh hops, so a level is selected; the default plan keeps the old page's 12/8", () => {
    expect(allowanceOf(newPlan())).toBe("minimal");
    expect(newPlan().settings.floodMax).toBe(10);
    expect(isBlockRecommended(newPlan(), "advertising")).toBe(true);
    const d = defaultPlan().settings;
    expect([d.floodMaxUnscoped, d.floodMaxAdvert]).toEqual([12, 8]);
    expect(allowanceOf(defaultPlan())).toBeNull();
  });

  it("a new plan follows the preset with max flood hops 10; the default plan keeps 64 without following", () => {
    expect([newPlan().floodMaxFollow, newPlan().settings.floodMax]).toEqual([true, 10]);
    expect([defaultPlan().floodMaxFollow, defaultPlan().settings.floodMax]).toEqual([undefined, 64]);
  });
});

describe("blocks", () => {
  it("lists the five blocks in order", () => {
    expect(BLOCKS).toEqual(["radio", "advertising", "repeating", "timing", "advanced"]);
    expect(blockKeys("advertising")).toEqual([
      "floodAdvertHours", "advertIntervalMinutes", "floodMaxUnscoped", "floodMaxAdvert", "floodMax",
    ]);
    expect(blockKeys("repeating")).toEqual(["repeat", "loopDetect"]);
    expect(blockKeys("timing")).toEqual(["txdelay", "directTxdelay", "rxdelay"]);
    expect(blockKeys("advanced")).toEqual(["pathHashMode", "radioRxgain", "radioFemRxgain", "intThresh", "agcResetInterval", "multiAcks"]);
  });

  it("FLOOD_ALLOWANCE has tight first", () => {
    expect(Object.keys(FLOOD_ALLOWANCE)).toEqual(["tight", "minimal", "average", "extended", "full"]);
  });

  it("advertising recommends 47 and always the Minimal hops: 4 unscoped, 6 for adverts, 10 at most", () => {
    const r = recommendedFor(withSettings(defaultPlan(), { floodAdvertHours: 12 }), "advertising");
    expect(r.settings.floodAdvertHours).toBe(47);
    expect([r.settings.floodMaxUnscoped, r.settings.floodMaxAdvert, r.settings.floodMax]).toEqual([4, 6, 10]);
    for (const [u, a] of [[2, 3], [64, 64], [16, 24], [8, 12]]) {
      const other = recommendedFor(withSettings(defaultPlan(), { floodMaxUnscoped: u, floodMaxAdvert: a }), "advertising");
      expect(allowanceOf(other)).toBe("minimal");
    }
  });

  it("a repeater on the old Average hops (8/12/18) differs from #BEmesh, so its owner is asked to lower them", () => {
    const old = withSettings({ ...newPlan(), nodeKey: KEY_47 }, { floodAdvertHours: 47, floodMaxUnscoped: 8, floodMaxAdvert: 12, floodMax: 18 });
    expect(isBlockRecommended(old, "advertising")).toBe(false);
    expect(isBlockRecommended(recommendedFor(old, "advertising"), "advertising")).toBe(true);
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

  it("timing recommends Suburban with RX delay 0, from any site", () => {
    const hill = recommendedFor(withTiming(newPlan(), { ...SITE_PROFILES.hilltop, rxdelay: 3 }), "timing");
    expect([hill.settings.txdelay, hill.settings.directTxdelay, hill.settings.rxdelay]).toEqual([0.8, 0.4, 0]);
    expect(isBlockRecommended(withTiming(newPlan(), SITE_PROFILES.hilltop), "timing")).toBe(false);
    const odd = recommendedFor(withTiming(newPlan(), { txdelay: 0.6, directTxdelay: 0.2, rxdelay: 0 }), "timing");
    expect([odd.settings.txdelay, odd.settings.directTxdelay, odd.settings.rxdelay]).toEqual([0.8, 0.4, 0]);
  });

  it("advanced recommends its own settings and leaves the timing alone", () => {
    const plan = withSettings(withTiming(newPlan(), { txdelay: 0.6, directTxdelay: 0.2, rxdelay: 0 }), { pathHashMode: "0", multiAcks: "1" });
    const r = recommendedFor(plan, "advanced");
    expect([r.settings.pathHashMode, r.settings.multiAcks]).toEqual(["1", "0"]);
    expect([r.settings.txdelay, r.settings.directTxdelay, r.settings.rxdelay]).toEqual([0.6, 0.2, 0]);
  });

  it("repeating recommends on / minimal; max flood hops follows the Minimal preset in advertising", () => {
    const plan = withSettings(defaultPlan(), { repeat: "off", floodMax: 10, loopDetect: "strict" });
    const r = recommendedFor(plan, "repeating");
    expect([r.settings.repeat, r.settings.floodMax, r.settings.loopDetect]).toEqual(["on", 10, "minimal"]);
    const a = recommendedFor(plan, "advertising");
    expect(a.settings.floodMax).toBe(10);
    expect(a.floodMaxFollow).toBe(true);
  });

  it("a hop preset sets max flood hops only while it follows the preset", () => {
    const off = withAllowance({ ...defaultPlan(), floodMaxFollow: false }, "tight");
    expect([off.settings.floodMaxUnscoped, off.settings.floodMaxAdvert, off.settings.floodMax]).toEqual([2, 3, 64]);
    const on = withAllowance({ ...defaultPlan(), floodMaxFollow: true }, "extended");
    expect([on.settings.floodMaxUnscoped, on.settings.floodMaxAdvert, on.settings.floodMax]).toEqual([16, 24, 32]);
  });

  it("turning follow on takes the preset's max flood hops; off keeps the value; no preset keeps it too", () => {
    const plan = withSettings(defaultPlan(), { floodMaxUnscoped: 4, floodMaxAdvert: 6, floodMax: 40 });
    const on = setFloodMaxFollow(plan, true);
    expect([on.floodMaxFollow, on.settings.floodMax]).toEqual([true, 10]);
    const off = setFloodMaxFollow(on, false);
    expect([off.floodMaxFollow, off.settings.floodMax]).toEqual([false, 10]);
    const odd = setFloodMaxFollow(withSettings(plan, { floodMaxUnscoped: 5 }), true);
    expect([odd.floodMaxFollow, odd.settings.floodMax]).toEqual([true, 40]);
  });

  it("advertising undo puts back the follow switch too", () => {
    const start = { ...defaultPlan(), floodMaxFollow: false };
    const undone = undoBlock(recommendedFor(start, "advertising"), start, "advertising");
    expect(undone.floodMaxFollow).toBe(false);
    expect(undone.settings.floodMax).toBe(64);
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
    const start = withSettings(defaultPlan(), { loopDetect: "minimal", repeat: "on" });
    const plan = withSettings(start, { loopDetect: "strict", repeat: "off" });
    expect(blockChanges(plan, start, "repeating")).toBe(2);
    const undone = undoBlock(plan, start, "repeating");
    expect(undone.settings.repeat).toBe("on");
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
