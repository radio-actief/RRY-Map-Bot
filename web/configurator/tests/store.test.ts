import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultPlan } from "../src/core/plan";
import type { Anchor } from "../src/core/regions";

const BELGIUM: Anchor = { mode: "country", province_code: null, place: null };
import { canApply, prefs, stepStatus, store, visited } from "../src/state/store";

afterEach(() => {
  vi.restoreAllMocks();
  store.plan.value = defaultPlan();
  store.step.value = 1;
  visited.value = new Set([1]);
  store.device.value = { status: "none", link: null, firmware: null };
});

describe("stepStatus", () => {
  it("shows current for the step the user is on, even with a problem", () => {
    expect(stepStatus(1)).toBe("current");
    store.step.value = 3;
    expect(stepStatus(3)).toBe("current");
  });
  it("flags a visited step with a problem (no anchor on step 3)", () => {
    expect(store.plan.value.anchor).toBeNull();
    store.step.value = 3;
    store.step.value = 1;
    expect(stepStatus(3)).toBe("attention");
  });
  it("leaves an unvisited step with a problem as todo", () => {
    expect(stepStatus(2)).toBe("todo");
  });
  it("marks a visited, problem-free step done", () => {
    store.step.value = 5;
    store.step.value = 1;
    expect(stepStatus(5)).toBe("done");
  });
  it("once step 5 was reached, every step with a problem is attention", () => {
    store.step.value = 5;
    expect(stepStatus(2)).toBe("attention");
    expect(stepStatus(3)).toBe("attention");
  });
  it("flags step 4 for an invalid setting once visited", () => {
    store.plan.value = { ...defaultPlan(), settings: { floodMax: "abc" } };
    store.step.value = 4;
    store.step.value = 1;
    expect(stepStatus(4)).toBe("attention");
  });
  it("flags step 3, not step 4, for a region code with a control character", () => {
    const row = { code: "be\rerase", labelKey: "", label: "", group: "country" as const, allow: true, deny: false };
    const regions = { rows: [row], untaggedFlood: true, homeOverride: null, defaultScope: null };
    store.plan.value = { ...defaultPlan(), anchor: BELGIUM, regions };
    store.step.value = 5;
    store.step.value = 1;
    expect(stepStatus(3)).toBe("attention");
    expect(stepStatus(4)).not.toBe("attention");
    expect(canApply.value.reasons).toContain("error.regionControlChars");
  });
});

describe("canApply", () => {
  it("lists reasons as translation keys", () => {
    const c = canApply.value;
    expect(c.ok).toBe(false);
    expect(c.reasons).toContain("apply.noDevice");
    expect(c.reasons).toContain("error.nameEmpty");
    expect(c.reasons).toContain("apply.noLocation");
  });
  it("blocks old firmware", () => {
    store.plan.value = { ...defaultPlan(), nameSuffix: "Gent", anchor: BELGIUM };
    store.device.value = { status: "connected", link: null, firmware: "v1.14.0" };
    expect(canApply.value.reasons).toEqual(["apply.firmwareTooOld"]);
  });
  it("is ok for a connected device with a valid plan", () => {
    store.plan.value = { ...defaultPlan(), nameSuffix: "Gent", anchor: BELGIUM };
    store.device.value = { status: "connected", link: null, firmware: "v1.17.1 (Build: 14 Aug 2026)" };
    expect(canApply.value).toEqual({ ok: true, reasons: [] });
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
