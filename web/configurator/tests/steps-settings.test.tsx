import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("leaflet", async () => await import("./fakes/leaflet"));

import { defaultPlan } from "../src/core/plan";
import type { Place } from "../src/core/search";
import { Regions } from "../src/steps/Regions";
import { Settings } from "../src/steps/Settings";
import { chooseLocation, resetPlan, stepStatus, store, visited } from "../src/state/store";
import { ofKind, resetFake } from "./fakes/leaflet";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(__dirname, "../../../data/be-locode.json"), "utf8"));
const MUNIS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/municipalities-3.json"), "utf8"));
const RONSE = PLACES.find((p) => p.city_code === "beron")!;

beforeEach(() => {
  resetFake();
  resetPlan(defaultPlan());
  store.snapshot.value = null;
  store.deviceRegions.value = undefined;
  store.data.value = { failed: new Set(), places: PLACES, municipalities: MUNIS };
  store.step.value = 4;
  visited.value = new Set([4]);
});
afterEach(cleanup);

const type = (label: RegExp | string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
const card = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;

describe("Settings step", () => {
  it("explains the admin password and always lists it in the summary", () => {
    render(<Settings />);
    expect(screen.getByPlaceholderText("Leave empty to keep the current one")).toBeTruthy();
    expect(screen.getByText("Factory default is “password”. Max 15 characters.")).toBeTruthy();
    expect(screen.getByText("Admin password stays as it is")).toBeTruthy();
    type("Admin password", "secret");
    expect(screen.getByText("Admin password will be changed")).toBeTruthy();
  });

  it("shows the range error for zero-hop advert 30 and turns the Settings segment to attention", () => {
    render(<Settings />);
    type(/Zero-hop advert/, "30");
    expect(screen.getByText("Value is out of range.")).toBeTruthy();
    store.step.value = 5;
    expect(stepStatus(4)).toBe("attention");
    store.step.value = 4;
    type(/Zero-hop advert/, "60");
    store.step.value = 5;
    expect(stepStatus(4)).toBe("done");
  });

  it("the Average pill sets flood.max.unscoped 8 and flood.max.advert 12", () => {
    render(<Settings />);
    fireEvent.click(screen.getByRole("button", { name: /Average/ }));
    expect(store.plan.value.settings.floodMaxUnscoped).toBe(8);
    expect(store.plan.value.settings.floodMaxAdvert).toBe(12);
    expect(screen.getByRole("button", { name: /Average/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("counts owner info in the | form with its byte limit", () => {
    render(<Settings />);
    expect(screen.getByText("0 / 119 bytes")).toBeTruthy();
    type("Contact or notes", "a\r\nb");
    expect(screen.getByText("3 / 119 bytes")).toBeTruthy();
    type("Contact or notes", "x".repeat(120));
    expect(screen.getByText("Too long. Owner info allows 119 bytes.")).toBeTruthy();
  });

  it("badges: unchanged, then a change count, and the changed field is outlined", () => {
    render(<Settings />);
    expect(within(card("Access")).getByText("unchanged")).toBeTruthy();
    type("Guest password", "hello");
    expect(within(card("Access")).getByText("1 change")).toBeTruthy();
    expect(screen.getByLabelText("Guest password").closest(".field")!.classList.contains("changed")).toBe(true);
  });

  it("choosing a preset fills the radio and editing a field flips the select to Custom", () => {
    render(<Settings />);
    const select = screen.getByLabelText("Preset") as HTMLSelectElement;
    expect(select.value).toBe("EU/UK (Narrow)");
    fireEvent.change(select, { target: { value: "Australia" } });
    expect(store.plan.value.radio).toEqual({ freq: 915.8, sf: 10, bw: 250, cr: 5 });
    type("Frequency (MHz)", "868.1");
    expect(store.plan.value.radio.freq).toBe(868.1);
    expect((screen.getByLabelText("Preset") as HTMLSelectElement).value).toBe("custom");
  });

  it("shows 'was X' only when the snapshot has the setting and the plan differs", () => {
    store.snapshot.value = { settings: { floodAdvertHours: 3, dutycycle: "10" }, missing: [] };
    render(<Settings />);
    type(/Flood advert/, "12");
    expect(screen.getByText("Was 3 on the repeater.")).toBeTruthy();
    expect(screen.queryByText(/Was 10 on/)).toBeNull();
  });

  it("Use #BEmesh recommendation restores the recommended values", () => {
    render(<Settings />);
    type(/Flood advert/, "12");
    fireEvent.click(within(card("Advertising & hops")).getByRole("button", { name: "Use #BEmesh recommendation" }));
    expect(store.plan.value.settings.floodAdvertHours).toBe(47);
    expect(store.plan.value.settings.floodMaxUnscoped).toBe(8);
  });

  it("lists the changes live and goes back / next", () => {
    render(<Settings />);
    const count = () => Number(/· (\d+)$/.exec(screen.getByText(/^What will change · /).textContent!)![1]);
    const before = count();
    type("Guest password", "hello");
    expect(count()).toBe(before + 1);
    expect(screen.getByText("→ hello")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(store.step.value).toBe(3);
    store.step.value = 4;
    fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
    expect(store.step.value).toBe(5);
  });

  it("draws a static mini map with the pin", () => {
    chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
    render(<Settings />);
    const map = ofKind("map")[0];
    expect(map.options.dragging).toBe(false);
    expect(map.options.scrollWheelZoom).toBe(false);
    expect(ofKind("marker").length).toBe(1);
  });

  it("folds the advanced settings", () => {
    render(<Settings />);
    const details = document.querySelector("details.advanced") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText("all recommended")).toBeTruthy();
  });
});

describe("Regions polish", () => {
  it("marks the home row and shows which code Default resolves to", () => {
    chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
    render(<Regions />);
    const row = document.querySelector('li[data-code="beron"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /^Allow:/ }));
    expect(within(row).getByText("home")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Default: beron (smallest allowed home region)" })).toBeTruthy();
  });
});
