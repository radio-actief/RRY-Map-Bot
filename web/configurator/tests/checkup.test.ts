import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { recommendedForAll } from "../src/core/blocks";
import { applyCheckup, checkupCounts, checkupLines } from "../src/core/checkup";
import { planFromSnapshot, planName, snapshotFromReplies, type Plan } from "../src/core/plan";
import { policyFor } from "../src/core/regions";
import type { Place } from "../src/core/search";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(process.cwd(), "data/be-locode.json"), "utf8"));
const RONSE: Record<string, string> = JSON.parse(readFileSync(resolve(__dirname, "fixtures/read-ronse.json"), "utf8"));

const read = planFromSnapshot(snapshotFromReplies(RONSE), PLACES);
/** The Ronse read (hop pair 12/8, no level) with its advert intervals on the recommendation and the rest off it. */
const P: Plan = {
  ...read,
  prefixFormat: "none",
  nameSuffix: "Kluisberg",
  settings: {
    ...read.settings,
    floodAdvertHours: 47,
    advertIntervalMinutes: 0,
    dutycycle: "50",
    floodMaxUnscoped: 12,
    floodMaxAdvert: 8,
    loopDetect: "off",
    txdelay: 0.5,
    directTxdelay: 0.2,
    rxdelay: 0,
  },
};
const ticked = (plan: Plan) => new Set(checkupLines(plan, PLACES).filter((l) => l.ticked).map((l) => l.id));

describe("checkupLines", () => {
  it("lists each difference once, in group order", () => {
    const lines = checkupLines(P, PLACES);
    expect(lines.map((l) => l.id)).toEqual(["name", "dutycycle", "hops", "loopDetect", "regions", "timing"]);
    expect(lines.map((l) => l.group)).toEqual(["name", "radio", "advertising", "repeating", "regions", "advanced"]);
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    expect([byId.hops.from, byId.hops.to]).toEqual(["Custom (12 / 8)", "Average (8 / 12)"]);
    expect([byId.timing.from, byId.timing.to]).toEqual(["own (0.5 / 0.2 / 0)", "Suburban (0.8 / 0.4 / 3)"]);
    expect(byId.timing.noteKey).toBe("checkup.timingNote");
    expect([byId.dutycycle.from, byId.dutycycle.to]).toEqual(["50 %", "10 %"]);
    expect([byId.loopDetect.from, byId.loopDetect.to]).toEqual(["Off", "Minimal"]);
    expect(byId.loopDetect.labelKey).toBe("setting.loopDetect");
  });

  it("a repeater read on the Suburban timing has no Timing line", () => {
    const s = snapshotFromReplies({
      ...RONSE,
      "get txdelay": "> 0.8",
      "get direct.txdelay": "> 0.3999999",
      "get rxdelay": "> 3.0",
    });
    const plan = planFromSnapshot(s, PLACES);
    expect([plan.settings.txdelay, plan.settings.directTxdelay, plan.settings.rxdelay]).toEqual([0.8, 0.4, 3]);
    expect(checkupLines(plan, PLACES).map((l) => l.id)).not.toContain("timing");
  });

  it("the name is listed, not ticked, with its note", () => {
    const name = checkupLines(P, PLACES)[0];
    expect(name).toMatchObject({ id: "name", ticked: false, noteKey: "checkup.nameNote" });
    expect([name.from, name.to]).toEqual(["Kluisberg🌞", "BE-RON-Kluisberg🌞"]);
  });

  it("the regions line names the home codes and spells out what it adds, denies and removes", () => {
    const regions = checkupLines(P, PLACES).find((l) => l.id === "regions")!;
    expect(regions).toMatchObject({ ticked: true, labelKey: "summary.regionHome", from: "beron", to: "be-vov" });
    expect(regions.detail!.removes).toEqual(["beron", "bemak"]);
    expect(regions.detail!.adds).not.toContain("bemak");
    expect(regions.detail!.denies).not.toContain("bemak");
  });

  it("without an anchor", () => {
    const lines = checkupLines({ ...P, anchor: null }, PLACES);
    expect(lines.some((l) => l.id === "name")).toBe(false);
    expect(lines.find((l) => l.id === "regions")).toMatchObject({
      disabled: true,
      ticked: false,
      noteKey: "checkup.needLocation",
    });
    expect(lines.map((l) => l.id)).toEqual(["dutycycle", "hops", "loopDetect", "regions", "timing"]);
    expect(checkupCounts(lines).total).toBe(4);
  });

  it("nothing differs: no lines", () => {
    const plan = recommendedForAll({ ...P, prefixFormat: "city", regions: policyFor(P.anchor!, PLACES) });
    expect(checkupLines(plan, PLACES)).toEqual([]);
  });

  it("an existing BE-…- prefix in the name is replaced", () => {
    const name = checkupLines({ ...P, nameSuffix: "BE-XYZ-Kluisberg" }, PLACES)[0];
    expect([name.from, name.to]).toEqual(["BE-XYZ-Kluisberg🌞", "BE-RON-Kluisberg🌞"]);
  });
});

describe("applyCheckup", () => {
  it("applyCheckup with every ticked id equals the recommendation for those blocks, and leaves the name alone", () => {
    const next = applyCheckup(P, PLACES, ticked(P));
    expect(next).toEqual({ ...recommendedForAll(P), regions: policyFor(P.anchor!, PLACES) });
    expect([next.prefixFormat, next.nameSuffix]).toEqual(["none", "Kluisberg"]);
    expect(next.acl).toEqual(P.acl);
    expect(next.location).toEqual(P.location);
    expect(next.settings.ownerInfo).toBe(P.settings.ownerInfo);
  });

  it("applies only the ticked ids", () => {
    const next = applyCheckup(P, PLACES, new Set(["dutycycle", "timing"]));
    expect(next).toEqual({
      ...P,
      settings: { ...P.settings, dutycycle: "10", txdelay: 0.8, directTxdelay: 0.4, rxdelay: 3 },
    });
    expect(next.regions).toBe(P.regions);
  });

  it("applying the name line sets the recommended prefix format", () => {
    const next = applyCheckup(P, PLACES, new Set(["name"]));
    expect(next.prefixFormat).toBe("city");
    expect(planName(next)).toBe("BE-RON-Kluisberg🌞");
    expect(planName(applyCheckup({ ...P, nameSuffix: "BE-XYZ-Kluisberg" }, PLACES, new Set(["name"])))).toBe(
      "BE-RON-Kluisberg🌞",
    );
  });

  it("applying the radio line sets the #BEmesh radio", () => {
    const off = { ...P, radio: { ...P.radio, freq: 869.525 }, radioCustom: true };
    const line = checkupLines(off, PLACES).find((l) => l.id === "radio")!;
    expect(line).toMatchObject({ group: "radio", from: "869.525,62.5,8,8", to: "869.618,62.5,8,8" });
    const next = applyCheckup(off, PLACES, new Set(["radio"]));
    expect(next.radio).toEqual(P.radio);
    expect(next.radioCustom).toBeUndefined();
  });
});

describe("checkupCounts", () => {
  it("checkupCounts", () => {
    expect(checkupCounts(checkupLines(P, PLACES))).toEqual({
      total: 5,
      perGroup: { radio: 1, advertising: 1, repeating: 1, advanced: 1, regions: 1 },
      nameDiffers: true,
    });
    expect(checkupCounts([])).toEqual({ total: 0, perGroup: {}, nameDiffers: false });
  });
});
