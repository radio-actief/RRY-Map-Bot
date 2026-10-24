import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultPlan, newPlan } from "../src/core/plan";
import { addFreeRegion, MAX_REGIONS, policyFor, regionCountAfterApply, setRowState, type Anchor } from "../src/core/regions";
import type { Place } from "../src/core/search";

const BELGIUM: Anchor = { mode: "country", province_code: null, place: null };
const GENT = { lat: 51.05, lon: 3.72 };
const PLACES: Place[] = JSON.parse(readFileSync(resolve(__dirname, "../../../data/be-locode.json"), "utf8"));
const MUNIS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/municipalities-3.json"), "utf8"));
const RONSE = PLACES.find((p) => p.city_code === "beron")!;
const RONSE_ANCHOR: Anchor = { mode: "city", province_code: RONSE.province_code, place: RONSE };
import { canApply, chooseLocation, setLocation, prefs, regionCount, resetPlan, stepStatus, store, visited } from "../src/state/store";

afterEach(() => {
  vi.restoreAllMocks();
  store.plan.value = defaultPlan();
  store.step.value = "connect";
  visited.value = new Set(["connect"]);
  store.device.value = { status: "none", link: null, firmware: null };
  store.data.value = { failed: new Set() };
});

describe("stepStatus", () => {
  it("shows current for the step the user is on, even with a problem", () => {
    expect(stepStatus("connect")).toBe("current");
    store.step.value = "regions";
    expect(stepStatus("regions")).toBe("current");
  });
  it("flags a visited step with a problem (no anchor on regions)", () => {
    expect(store.plan.value.anchor).toBeNull();
    store.step.value = "regions";
    store.step.value = "connect";
    expect(stepStatus("regions")).toBe("attention");
  });
  it("leaves an unvisited step with a problem as todo", () => {
    expect(stepStatus("place")).toBe("todo");
    expect(stepStatus("name")).toBe("todo");
  });
  it("marks a visited, problem-free step done", () => {
    store.step.value = "send";
    store.step.value = "connect";
    expect(stepStatus("send")).toBe("done");
  });
  it("once send was reached, every step with a problem is attention", () => {
    store.step.value = "send";
    expect(stepStatus("place")).toBe("attention");
    expect(stepStatus("name")).toBe("attention");
    expect(stepStatus("regions")).toBe("attention");
  });
  it("splits place (location) from name (name, owner info)", () => {
    store.plan.value = { ...defaultPlan(), nameSuffix: "Gent", anchor: BELGIUM, location: GENT };
    store.step.value = "place";
    store.step.value = "name";
    store.step.value = "send";
    expect(stepStatus("place")).toBe("done");
    expect(stepStatus("name")).toBe("done");
    store.plan.value = { ...store.plan.value, location: null };
    expect(stepStatus("place")).toBe("attention");
    store.plan.value = { ...store.plan.value, location: GENT, settings: { ...store.plan.value.settings, ownerInfo: "x".repeat(120) } };
    expect(stepStatus("place")).toBe("done");
    expect(stepStatus("name")).toBe("attention");
  });
  it("connect and site never show attention", () => {
    store.step.value = "site";
    store.step.value = "send";
    expect(stepStatus("connect")).toBe("done");
    expect(stepStatus("site")).toBe("done");
  });
  it("Advanced is never attention, even with a range error, which still blocks Apply", () => {
    store.plan.value = {
      ...defaultPlan(),
      nameSuffix: "Gent",
      anchor: BELGIUM,
      location: GENT,
      settings: { advertIntervalMinutes: "30" },
    };
    store.device.value = { status: "connected", link: null, firmware: "v1.17.1 (Build: 14 Aug 2026)" };
    expect(stepStatus("advanced")).toBe("todo");
    store.step.value = "advanced";
    expect(stepStatus("advanced")).toBe("current");
    store.step.value = "send";
    expect(stepStatus("advanced")).toBe("done");
    expect(canApply.value.ok).toBe(false);
    expect(canApply.value.reasons).toContainEqual({ key: "error.range" });
  });
  it("flags send for an invalid guest password", () => {
    store.plan.value = { ...defaultPlan(), nameSuffix: "Gent", anchor: BELGIUM, location: GENT, settings: { guestPassword: "a\rb" } };
    store.step.value = "send";
    store.step.value = "connect";
    expect(stepStatus("send")).toBe("attention");
    expect(stepStatus("advanced")).toBe("todo");
  });
  it("flags regions, not advanced, for a region code with a control character", () => {
    const row = { code: "be\rerase", labelKey: "", label: "", group: "country" as const, allow: true, deny: false };
    const regions = { rows: [row], untaggedFlood: true, homeOverride: null, defaultScope: null };
    store.plan.value = { ...defaultPlan(), anchor: BELGIUM, regions };
    store.step.value = "send";
    store.step.value = "connect";
    expect(stepStatus("regions")).toBe("attention");
    expect(stepStatus("advanced")).not.toBe("attention");
    expect(canApply.value.reasons).toContainEqual({ key: "error.regionControlChars" });
  });
});

/** The Ronse policy with free rows added until applying it needs `count` regions. */
function ronseNeeding(count: number) {
  let policy = policyFor(RONSE_ANCHOR, PLACES);
  for (let i = 0; regionCountAfterApply(RONSE_ANCHOR, policy, PLACES) < count; i++) {
    policy = addFreeRegion(policy, `zone${i}`, null, RONSE_ANCHOR);
  }
  expect(regionCountAfterApply(RONSE_ANCHOR, policy, PLACES)).toBe(count);
  return policy;
}

describe("regionCount", () => {
  it("is 0 without an anchor and counts what applying the policy defines", () => {
    expect(regionCount.value).toBe(0);
    store.data.value = { failed: new Set(), places: PLACES };
    const regions = policyFor(RONSE_ANCHOR, PLACES);
    store.plan.value = { ...defaultPlan(), anchor: RONSE_ANCHOR, regions };
    expect(regionCount.value).toBe(regionCountAfterApply(RONSE_ANCHOR, regions, PLACES));
    expect(regionCount.value).toBeGreaterThan(0);
  });
  it("flags regions when the plan needs more regions than the repeater holds", () => {
    store.data.value = { failed: new Set(), places: PLACES };
    store.plan.value = { ...defaultPlan(), anchor: RONSE_ANCHOR, regions: ronseNeeding(MAX_REGIONS) };
    store.step.value = "regions";
    store.step.value = "connect";
    expect(stepStatus("regions")).toBe("done");
    store.plan.value = { ...store.plan.value, regions: ronseNeeding(MAX_REGIONS + 1) };
    expect(stepStatus("regions")).toBe("attention");
  });
});

describe("canApply", () => {
  it("lists reasons as translation keys", () => {
    const c = canApply.value;
    expect(c.ok).toBe(false);
    expect(c.reasons).toContainEqual({ key: "apply.noDevice" });
    expect(c.reasons).toContainEqual({ key: "error.nameEmpty" });
    expect(c.reasons).toContainEqual({ key: "apply.noLocation" });
  });
  it("blocks old firmware", () => {
    store.plan.value = { ...defaultPlan(), nameSuffix: "Gent", anchor: BELGIUM, location: GENT };
    store.device.value = { status: "connected", link: null, firmware: "v1.14.0" };
    expect(canApply.value.reasons).toEqual([{ key: "apply.firmwareTooOld" }]);
  });
  it("is ok for a connected device with a valid plan", () => {
    store.plan.value = { ...defaultPlan(), nameSuffix: "Gent", anchor: BELGIUM, location: GENT };
    store.device.value = { status: "connected", link: null, firmware: "v1.17.1 (Build: 14 Aug 2026)" };
    expect(canApply.value).toEqual({ ok: true, reasons: [] });
  });
  it("lists error.regionCount with the count when 33 regions are needed", () => {
    store.data.value = { failed: new Set(), places: PLACES };
    store.device.value = { status: "connected", link: null, firmware: "v1.17.1 (Build: 14 Aug 2026)" };
    const plan = { ...defaultPlan(), nameSuffix: "Kluisberg", anchor: RONSE_ANCHOR, location: { lat: RONSE.lat, lon: RONSE.lon } };
    store.plan.value = { ...plan, regions: ronseNeeding(32) };
    expect(canApply.value).toEqual({ ok: true, reasons: [] });
    store.plan.value = { ...plan, regions: ronseNeeding(33) };
    expect(canApply.value.reasons).toEqual([{ key: "error.regionCount", params: { count: 33, max: 32 } }]);
  });
});

describe("start plan", () => {
  it("starts from newPlan and follows resetPlan", () => {
    expect(store.startPlan.value).toEqual(newPlan());
    const plan = { ...defaultPlan(), nameSuffix: "Read" };
    resetPlan(plan);
    expect(store.startPlan.value).toBe(plan);
    expect(store.planBase.value).toBe(plan);
  });
});

describe("theme and prefs", () => {
  it("writes data-theme on <html> and removes it for system", () => {
    store.theme.value = "dark";
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    store.theme.value = "system";
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
  it("survives throwing storage and keeps the value for the session", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => prefs.set("configurator.x", "1")).not.toThrow();
    expect(prefs.get("configurator.x")).toBe("1");
    store.theme.value = "light";
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(prefs.get("configurator.theme")).toBe("light");
  });
  it("prefers the value written this session over a stale stored one", () => {
    localStorage.setItem("configurator.stale", "old");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    prefs.set("configurator.stale", "new");
    expect(prefs.get("configurator.stale")).toBe("new");
    localStorage.removeItem("configurator.stale");
  });
});

describe("free regions survive a rebuilt policy", () => {
  it("keeps a free row and its state when the location moves", () => {
    store.data.value = { failed: new Set(), places: PLACES };
    chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
    const regions = addFreeRegion(store.plan.value.regions!, "zone", null, store.plan.value.anchor!);
    store.plan.value = { ...store.plan.value, regions };
    const before = store.plan.value.regions!.rows.find((r) => r.code === "zone")!;
    const kortrijk = PLACES.find((p) => p.city_code === "bekjk")!;
    chooseLocation({ type: "city", label: "Kortrijk", place: kortrijk } as never);
    const after = store.plan.value.regions!.rows.find((r) => r.code === "zone");
    expect(after).toEqual(before);
    expect(after!.allow).toBe(true);
  });

  it("keeps a free row and its state when the pin moves into another municipality", () => {
    store.data.value = { failed: new Set(), places: PLACES, municipalities: MUNIS };
    chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
    const regions = setRowState(addFreeRegion(store.plan.value.regions!, "zone", null, store.plan.value.anchor!), "zone", "deny");
    store.plan.value = { ...store.plan.value, regions };
    const before = store.plan.value.regions!.rows.find((r) => r.code === "zone")!;
    setLocation({ lat: 50.7788, lon: 3.5368 });
    expect(store.plan.value.anchor?.place?.city_code).toBe("beksr");
    const after = store.plan.value.regions!.rows.find((r) => r.code === "zone");
    expect(after).toEqual(before);
    expect(after!.deny).toBe(true);
  });
});
