import { describe, expect, it } from "vitest";
import en from "../src/i18n/en.json";
import { recommendedForAll } from "../src/core/blocks";
import { defaultPlan } from "../src/core/plan";
import { presetForRadio } from "../src/core/presets";
import * as settings from "../src/core/settings";
import { FLOOD_ALLOWANCE, FLOOD_MAX, SETTINGS, adminPasswordCliLine, hopLevel, validateSetting } from "../src/core/settings";

const err = (key: Parameters<typeof validateSetting>[0], raw: string) => {
  const r = validateSetting(key, raw);
  return r.ok ? null : r.errorKey;
};

describe("hop presets", () => {
  it("gives each level its max flood hops", () => {
    expect(FLOOD_MAX).toEqual({ tight: 5, minimal: 10, average: 18, extended: 32, full: 64 });
    expect(Object.keys(FLOOD_MAX)).toEqual(Object.keys(FLOOD_ALLOWANCE));
  });

  it("names the level of a hop pair, numerically, or null", () => {
    expect(hopLevel(8, 12)).toBe("average");
    expect(hopLevel("16", "24.0")).toBe("extended");
    expect(hopLevel(8, 8)).toBeNull();
    expect(hopLevel("", 12)).toBeNull();
  });
});

describe("validateSetting", () => {
  it("rounds the zero-hop advert interval to an even number", () => {
    expect(validateSetting("advertIntervalMinutes", "61")).toEqual({ ok: true, value: 62 });
    expect(validateSetting("advertIntervalMinutes", "0")).toEqual({ ok: true, value: 0 });
    expect(err("advertIntervalMinutes", "30")).toBe("range");
    expect(err("advertIntervalMinutes", "241")).toBe("range");
  });

  it("limits the flood advert interval to 3-168 hours or 0", () => {
    expect(err("floodAdvertHours", "2")).toBe("range");
    expect(validateSetting("floodAdvertHours", "3")).toEqual({ ok: true, value: 3 });
    expect(validateSetting("floodAdvertHours", "0")).toEqual({ ok: true, value: 0 });
    expect(err("floodAdvertHours", "169")).toBe("range");
  });

  it("rounds the AGC reset interval down to a multiple of 4", () => {
    expect(validateSetting("agcResetInterval", "10")).toEqual({ ok: true, value: 8 });
    expect(validateSetting("agcResetInterval", "255")).toEqual({ ok: true, value: 252 });
    expect(validateSetting("agcResetInterval", "2")).toEqual({ ok: true, value: 4 });
    expect(err("agcResetInterval", "256")).toBe("range");
  });

  it("limits the tx delay factors to 0-2", () => {
    expect(err("txdelay", "2.5")).toBe("range");
    expect(validateSetting("txdelay", "0.5")).toEqual({ ok: true, value: 0.5 });
    expect(err("directTxdelay", "-0.1")).toBe("range");
  });

  it("rounds rxdelay to one decimal within 0-20", () => {
    expect(validateSetting("rxdelay", "1.26")).toEqual({ ok: true, value: 1.3 });
    expect(err("rxdelay", "21")).toBe("range");
  });

  it("limits hop counts, interference threshold and tx power", () => {
    expect(err("floodMax", "65")).toBe("range");
    expect(err("floodMaxUnscoped", "-1")).toBe("range");
    expect(err("intThresh", "256")).toBe("range");
    expect(validateSetting("txPower", "22")).toEqual({ ok: true, value: 22 });
    expect(err("txPower", "0")).toBe("range");
    expect(err("txPower", "23")).toBe("range");
  });

  it("rejects non-numbers", () => {
    expect(err("floodMax", "abc")).toBe("number");
    expect(err("floodMax", "1.5")).toBe("number");
    expect(err("floodMax", "Infinity")).toBe("number");
  });

  it("accepts numbers as typed", () => {
    expect(validateSetting("txdelay", ".5")).toEqual({ ok: true, value: 0.5 });
    expect(validateSetting("txdelay", "1.")).toEqual({ ok: true, value: 1 });
    expect(validateSetting("floodMax", "5.")).toEqual({ ok: true, value: 5 });
    expect(validateSetting("floodMax", "1e1")).toEqual({ ok: true, value: 10 });
  });

  it("uses the form default for empty numeric input, none for tx power", () => {
    expect(validateSetting("floodMaxUnscoped", " ")).toEqual({ ok: true, value: 12 });
    expect(validateSetting("txdelay", "")).toEqual({ ok: true, value: 0.5 });
    expect(validateSetting("txPower", "")).toEqual({ ok: true, value: null });
  });

  it("trims text settings", () => {
    expect(validateSetting("ownerInfo", "  hi  ")).toEqual({ ok: true, value: "hi" });
    expect(validateSetting("guestPassword", "   ")).toEqual({ ok: true, value: "" });
  });

  it("accepts only the listed options", () => {
    expect(validateSetting("dutycycle", "10")).toEqual({ ok: true, value: "10" });
    expect(err("dutycycle", "20")).toBe("option");
    expect(err("dutycycle", "1")).toBe("option");
    expect(err("loopDetect", "loud")).toBe("option");
    expect(validateSetting("pathHashMode", "2")).toEqual({ ok: true, value: "2" });
  });

  it("enforces the 15-byte admin password limit on the trimmed value", () => {
    expect(err("adminPassword", "x".repeat(16))).toBe("tooLong");
    expect(validateSetting("adminPassword", " " + "x".repeat(15) + " ")).toEqual({
      ok: true,
      value: "x".repeat(15),
    });
    expect(err("adminPassword", "é".repeat(8))).toBe("tooLong");
  });

  it("accepts any owner info and guest password", () => {
    expect(validateSetting("ownerInfo", "x".repeat(300))).toEqual({ ok: true, value: "x".repeat(300) });
    expect(validateSetting("guestPassword", "")).toEqual({ ok: true, value: "" });
  });
});

describe("adminPasswordCliLine", () => {
  it("emits nothing for an empty password and trims otherwise", () => {
    expect(adminPasswordCliLine("")).toBeNull();
    expect(adminPasswordCliLine("   ")).toBeNull();
    expect(adminPasswordCliLine(" s3cret ")).toBe("password s3cret");
  });
});

describe("SETTINGS registry", () => {
  it("has an en.json help string for every setting", () => {
    const strings = en as Record<string, string>;
    for (const s of SETTINGS) {
      expect(strings[s.helpKey], s.key).toBeTruthy();
    }
  });

  it("has unique keys and the old firmware defaults", () => {
    expect(new Set(SETTINGS.map((s) => s.key)).size).toBe(SETTINGS.length);
    expect(SETTINGS).toHaveLength(20);
    const def = (k: string) => SETTINGS.find((s) => s.key === k)!;
    expect(def("floodMaxAdvert").firmwareDefault).toBe(8);
    expect(def("floodMaxAdvert").formDefault).toBe(8);
    expect(def("floodMaxUnscoped").formDefault).toBe(12);
    expect(def("directTxdelay").firmwareDefault).toBe(0.2);
    expect(def("dutycycle").firmwareDefault).toBe("50");
    expect(def("dutycycle").formDefault).toBe("10");
    expect(def("loopDetect").formDefault).toBe("minimal");
    expect(def("pathHashMode").formDefault).toBe("1");
    expect(def("agcResetInterval").readCmd).toBe("get agc.reset.interval");
    expect(def("adminPassword").cliKey).toBe("password");
    expect(def("txPower").cliKey).toBe("tx");
  });

  it("the #BEmesh recommendations come from the blocks, with no second copy here", () => {
    expect("RECOMMENDED_SETTINGS" in settings).toBe(false);
    const plan = recommendedForAll(defaultPlan());
    expect(presetForRadio(plan.radio)?.title).toBe("EU/UK (Narrow)");
    expect(plan.settings).toMatchObject({
      dutycycle: "10",
      floodAdvertHours: 47,
      advertIntervalMinutes: 0,
      floodMax: 18,
      pathHashMode: "1",
      loopDetect: "minimal",
    });
    expect(FLOOD_ALLOWANCE).toEqual({
      tight: [2, 3],
      minimal: [4, 6],
      average: [8, 12],
      extended: [16, 24],
      full: [64, 64],
    });
  });
});
