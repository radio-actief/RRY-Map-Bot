import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newPlan, type DeviceSnapshot } from "../src/core/plan";
import { timingOf } from "../src/core/site";
import { resetPlan, store } from "../src/state/store";
import { Site, SiteChoices } from "../src/steps/Site";

const node = (name: string, lat: number, lon: number, type = 2) => ({
  public_key: name,
  type,
  adv_name: name,
  adv_lat: lat,
  adv_lon: lon,
});

const NAMES = ["Hilltop", "Foothills", "Suburban", "Local", "Its own"];

beforeEach(() => {
  resetPlan(newPlan());
  store.snapshot.value = null;
  store.data.value = { failed: new Set(), places: [], municipalities: [] };
});
afterEach(cleanup);

const card = (name: string) => screen.getByRole("button", { name: new RegExp(name) });

describe("Site step", () => {
  it("shows five cards and presses Suburban on a new plan", () => {
    render(<Site />);
    for (const n of NAMES) expect(card(n).getAttribute("aria-pressed")).toBe(n === "Suburban" ? "true" : "false");
  });

  it("Hilltop sets 2 / 2 / 3", () => {
    render(<Site />);
    fireEvent.click(card("Hilltop"));
    expect(timingOf(store.plan.value)).toEqual({ txdelay: 2, directTxdelay: 2, rxdelay: 3 });
    expect(card("Hilltop").getAttribute("aria-pressed")).toBe("true");
  });

  it("Its own presses after a Read and restores the device timing", () => {
    const snap = { settings: { txdelay: "1", directTxdelay: "0.5", rxdelay: "0" } } as unknown as DeviceSnapshot;
    store.snapshot.value = snap;
    resetPlan({ ...newPlan(), settings: { ...newPlan().settings, txdelay: 1, directTxdelay: 0.5, rxdelay: 0 } });
    render(<Site />);
    expect(card("Its own").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(card("Hilltop"));
    expect(card("Its own").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(card("Its own"));
    expect(timingOf(store.plan.value)).toEqual({ txdelay: 1, directTxdelay: 0.5, rxdelay: 0 });
  });

  it("shows a pressed Custom card with the three values", () => {
    store.plan.value = { ...store.plan.value, settings: { ...store.plan.value.settings, txdelay: 0.6 } };
    const { container } = render(<Site />);
    const custom = container.querySelector('.site-card[aria-current="true"]')!;
    expect(custom.tagName).toBe("DIV");
    expect(custom.textContent).toContain("txdelay 0.6 · direct.txdelay 0.4 · rxdelay 3");
  });

  it("counts repeaters within 25 km of the location", () => {
    store.plan.value = { ...store.plan.value, location: { lat: 50.75, lon: 3.6 } };
    store.data.value = {
      failed: new Set(),
      places: [],
      municipalities: [],
      nodes: [node("a", 50.76, 3.6), node("b", 50.74, 3.61), node("c", 50.76, 3.6, 1), node("far", 51.5, 4.5)],
    } as never;
    render(<Site />);
    expect(screen.getByText("The map shows 2 repeaters within 25 km.")).toBeTruthy();
  });

  it("asks for a place without a location and omits the line when nodes failed", () => {
    render(<Site />);
    expect(screen.getByText(/Pick a place to see/)).toBeTruthy();
    cleanup();
    store.data.value = { failed: new Set(["nodes"]), places: [], municipalities: [] } as never;
    render(<Site />);
    expect(screen.queryByText(/Pick a place to see/)).toBeNull();
  });
});

describe("SiteChoices compact", () => {
  it("renders pills and a non-button Custom pill only when custom", () => {
    const { container } = render(<SiteChoices compact />);
    expect(container.querySelectorAll("button.pill").length).toBe(5);
    expect(screen.getByRole("group", { name: "Timing preset" })).toBeTruthy();
    expect(container.querySelector('span.pill[aria-current="true"]')).toBeNull();
    cleanup();
    store.plan.value = { ...store.plan.value, settings: { ...store.plan.value.settings, txdelay: 0.6 } };
    const r = render(<SiteChoices compact />);
    expect(r.container.querySelector('span.pill[aria-current="true"]')?.textContent).toBe("Custom");
    fireEvent.click(screen.getByRole("button", { name: "Local" }));
    expect(r.container.querySelector("span.pill")).toBeNull();
  });
});
