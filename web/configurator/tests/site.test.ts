import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { importBackup } from "../src/core/backup";
import { defaultPlan, newPlan } from "../src/core/plan";
import type { Place } from "../src/core/search";
import { bandFor, bandTiming, FIRMWARE_TIMING, SITE_PROFILES, siteOf, timingOf, withTiming } from "../src/core/site";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(process.cwd(), "data/be-locode.json"), "utf8"));

describe("site profiles", () => {
  it("matches each profile by its two transmit delays; RX delay is no part of a profile", () => {
    expect(siteOf({ txdelay: 2, directTxdelay: 2, rxdelay: 0 })).toBe("hilltop");
    expect(siteOf({ txdelay: 1.5, directTxdelay: 1, rxdelay: 3 })).toBe("foothills");
    expect(siteOf({ txdelay: 0.8, directTxdelay: 0.4, rxdelay: 7 })).toBe("suburban");
    expect(siteOf({ txdelay: 0.3, directTxdelay: 0.1, rxdelay: 0 })).toBe("local");
    expect(Object.keys(SITE_PROFILES)).toEqual(["hilltop", "foothills", "suburban", "local"]);
    for (const p of Object.values(SITE_PROFILES)) expect(Object.keys(p)).toEqual(["txdelay", "directTxdelay"]);
  });

  it("applying a profile leaves RX delay alone", () => {
    const plan = withTiming({ ...newPlan(), settings: { ...newPlan().settings, rxdelay: 5 } }, SITE_PROFILES.hilltop);
    expect([plan.settings.txdelay, plan.settings.directTxdelay, plan.settings.rxdelay]).toEqual([2, 2, 5]);
  });

  it("compares numerically", () => {
    const plan = withTiming(newPlan(), { txdelay: 0.8, directTxdelay: 0.4, rxdelay: 3 });
    plan.settings.txdelay = "0.80";
    expect(siteOf(timingOf(plan))).toBe("suburban");
  });

  it("any timing that is no profile is custom, the firmware's too", () => {
    expect(siteOf(FIRMWARE_TIMING)).toBe("custom");
    expect(siteOf({ txdelay: 0.6, directTxdelay: 0.2, rxdelay: 0 })).toBe("custom");
  });

  it("starts a new plan on Suburban and keeps the default plan on the firmware timing", () => {
    const n = newPlan().settings;
    expect([n.txdelay, n.directTxdelay, n.rxdelay]).toEqual([0.8, 0.4, 0]);
    const d = defaultPlan().settings;
    expect([d.txdelay, d.directTxdelay, d.rxdelay]).toEqual([0.5, 0.2, 0]);
  });

  it("falls back to the firmware timing for an invalid value", () => {
    const plan = defaultPlan();
    plan.settings.txdelay = "abc";
    expect(timingOf(plan)).toEqual(FIRMWARE_TIMING);
  });

  it("picks the band from how many repeaters it hears: 0-2 local, 3-5 suburban, 6-10 foothills, 11+ hilltop", () => {
    const bands = Array.from({ length: 13 }, (_, n) => bandFor(n));
    expect(bands).toEqual([
      "local", "local", "local",
      "suburban", "suburban", "suburban",
      "foothills", "foothills", "foothills", "foothills", "foothills",
      "hilltop", "hilltop",
    ]);
    expect(bandFor(40)).toBe("hilltop");
  });

  it("a band's timing is its two transmit delays with RX delay 0", () => {
    expect(bandTiming("local")).toEqual({ txdelay: 0.3, directTxdelay: 0.1, rxdelay: 0 });
    expect(bandTiming("suburban")).toEqual({ txdelay: 0.8, directTxdelay: 0.4, rxdelay: 0 });
    expect(bandTiming("foothills")).toEqual({ txdelay: 1.5, directTxdelay: 1, rxdelay: 0 });
    expect(bandTiming("hilltop")).toEqual({ txdelay: 2, directTxdelay: 2, rxdelay: 0 });
  });

  it("keeps the firmware timing on a v1 import without timing fields", () => {
    const b = JSON.parse(readFileSync(resolve(__dirname, "fixtures/parity/ronse-solar.backup.json"), "utf8"));
    for (const k of ["setting-txdelay", "setting-direct-txdelay", "setting-rxdelay"]) delete b.fields[k];
    const s = importBackup(b, PLACES).settings;
    expect([s.txdelay, s.directTxdelay, s.rxdelay]).toEqual([0.5, 0.2, 0]);
  });
});
