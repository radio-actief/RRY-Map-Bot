import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newPlan, type DeviceSnapshot } from "../src/core/plan";
import { timingOf } from "../src/core/site";
import { resetPlan, store } from "../src/state/store";
import { TimingPreset } from "../src/steps/settings/TimingPreset";

const node = (name: string, lat: number, lon: number, type = 2) => ({
  public_key: name,
  type,
  adv_name: name,
  adv_lat: lat,
  adv_lon: lon,
});

const NAMES = ["Hilltop", "Foothills", "Suburban", "Local", "Custom"];

beforeEach(() => {
  resetPlan(newPlan());
  store.snapshot.value = null;
  store.data.value = { failed: new Set(), places: [], municipalities: [] };
});
afterEach(cleanup);

const pill = (name: string) => screen.getByRole("button", { name });

describe("Timing preset", () => {
  it("shows the four sites and Custom, Suburban pressed on a new plan, with its description", () => {
    render(<TimingPreset />);
    expect(screen.getByRole("group", { name: "Timing preset" })).toBeTruthy();
    for (const n of NAMES) expect(pill(n).getAttribute("aria-pressed")).toBe(n === "Suburban" ? "true" : "false");
    expect(screen.queryByRole("button", { name: "Its own" })).toBeNull();
    expect(screen.getByText(/A typical rooftop covering your own neighbourhood\. 5–10 neighbours/)).toBeTruthy();
  });

  it("Hilltop sets 2 / 2 / 3", () => {
    render(<TimingPreset />);
    fireEvent.click(pill("Hilltop"));
    expect(timingOf(store.plan.value)).toEqual({ txdelay: 2, directTxdelay: 2, rxdelay: 3 });
    expect(pill("Hilltop").getAttribute("aria-pressed")).toBe("true");
  });

  it("Custom is pressed for a timing that is no site, and puts back the repeater's timing after a Read", () => {
    store.snapshot.value = { settings: { txdelay: "1", directTxdelay: "0.5", rxdelay: "0" } } as unknown as DeviceSnapshot;
    resetPlan({ ...newPlan(), settings: { ...newPlan().settings, txdelay: 1, directTxdelay: 0.5, rxdelay: 0 } });
    render(<TimingPreset />);
    expect(pill("Custom").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/the values in the fields below/)).toBeTruthy();
    fireEvent.click(pill("Hilltop"));
    expect(pill("Custom").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pill("Custom"));
    expect(timingOf(store.plan.value)).toEqual({ txdelay: 1, directTxdelay: 0.5, rxdelay: 0 });
  });

  it("Custom without a Read puts back the firmware's timing", () => {
    render(<TimingPreset />);
    fireEvent.click(pill("Custom"));
    expect(timingOf(store.plan.value)).toEqual({ txdelay: 0.5, directTxdelay: 0.2, rxdelay: 0 });
    expect(pill("Custom").getAttribute("aria-pressed")).toBe("true");
  });

  it("counts repeaters within 25 km of the location", () => {
    store.plan.value = { ...store.plan.value, location: { lat: 50.75, lon: 3.6 } };
    store.data.value = {
      failed: new Set(),
      places: [],
      municipalities: [],
      nodes: [node("a", 50.76, 3.6), node("b", 50.74, 3.61), node("c", 50.76, 3.6, 1), node("far", 51.5, 4.5)],
    } as never;
    render(<TimingPreset />);
    expect(screen.getByText("The map shows 2 repeaters within 25 km.")).toBeTruthy();
  });

  it("asks for a place without a location and omits the line when nodes failed", () => {
    render(<TimingPreset />);
    expect(screen.getByText(/Pick a place to see/)).toBeTruthy();
    cleanup();
    store.data.value = { failed: new Set(["nodes"]), places: [], municipalities: [] } as never;
    render(<TimingPreset />);
    expect(screen.queryByText(/Pick a place to see/)).toBeNull();
  });
});
