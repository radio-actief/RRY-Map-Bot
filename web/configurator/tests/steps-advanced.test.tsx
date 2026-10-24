import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("leaflet", async () => await import("./fakes/leaflet"));

import { defaultPlan, planErrors } from "../src/core/plan";
import type { Place } from "../src/core/search";
import { Regions } from "../src/steps/Regions";
import { Advanced } from "../src/steps/Advanced";
import { canApply, chooseLocation, resetPlan, stepStatus, store, visited } from "../src/state/store";
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
  store.step.value = "advanced";
  visited.value = new Set(["advanced"]);
});
afterEach(cleanup);

const type = (label: RegExp | string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
const card = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;

describe("Advanced step", () => {
  it("no longer shows owner info (it is on Name)", () => {
    render(<Advanced />);
    expect(screen.queryByRole("heading", { name: "Owner info" })).toBeNull();
    expect(screen.queryByLabelText("Contact or notes")).toBeNull();
  });

  it("explains the admin password and always lists it in the summary", () => {
    render(<Advanced />);
    expect(screen.getByPlaceholderText("Leave empty to keep the current one")).toBeTruthy();
    expect(screen.getByText("Admin password stays as it is")).toBeTruthy();
    type("Admin password", "secret");
    expect(screen.getByText("Admin password will be changed")).toBeTruthy();
  });

  it("shows the range error for zero-hop advert 30, which blocks Apply but never turns the Advanced segment orange", () => {
    render(<Advanced />);
    type(/Zero-hop advert/, "30");
    expect(screen.getByText("Value is out of range.")).toBeTruthy();
    expect(canApply.value.reasons).toContainEqual({ key: "error.range" });
    store.step.value = "send";
    expect(stepStatus("advanced")).toBe("done");
    store.step.value = "advanced";
    type(/Zero-hop advert/, "60");
    expect(canApply.value.reasons).not.toContainEqual({ key: "error.range" });
    store.step.value = "send";
    expect(stepStatus("advanced")).toBe("done");
  });

  it("the Average pill sets flood.max.unscoped 8 and flood.max.advert 12", () => {
    render(<Advanced />);
    fireEvent.click(screen.getByRole("button", { name: /Average/ }));
    expect(store.plan.value.settings.floodMaxUnscoped).toBe(8);
    expect(store.plan.value.settings.floodMaxAdvert).toBe(12);
    expect(screen.getByRole("button", { name: /Average/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("badges: unchanged, then a change count, and the changed field is outlined", () => {
    render(<Advanced />);
    expect(within(card("Access")).getByText("unchanged")).toBeTruthy();
    type("Guest password", "hello");
    expect(within(card("Access")).getByText("1 change")).toBeTruthy();
    expect(screen.getByLabelText("Guest password").closest(".field")!.classList.contains("changed")).toBe(true);
  });

  it("choosing a preset fills the radio and editing a field flips the select to Custom", () => {
    render(<Advanced />);
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
    render(<Advanced />);
    type(/Flood advert/, "12");
    expect(screen.getByText("Was 3 on the repeater.")).toBeTruthy();
    expect(screen.queryByText(/Was 10 on/)).toBeNull();
  });

  it("Use #BEmesh recommendation restores the recommended values", () => {
    render(<Advanced />);
    type(/Flood advert/, "12");
    fireEvent.click(within(card("Advertising & hops")).getByRole("button", { name: "Use #BEmesh recommendation" }));
    expect(store.plan.value.settings.floodAdvertHours).toBe(47);
    expect(store.plan.value.settings.floodMaxUnscoped).toBe(8);
  });

  it("lists the changes live and goes back / next", () => {
    render(<Advanced />);
    const count = () => Number(/· (\d+)$/.exec(screen.getByText(/^What will change · /).textContent!)![1]);
    const before = count();
    type("Guest password", "hello");
    expect(count()).toBe(before + 1);
    expect(screen.getByText("→ hello")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(store.step.value).toBe("regions");
    store.step.value = "advanced";
    fireEvent.click(screen.getByRole("button", { name: /Next: Send/ }));
    expect(store.step.value).toBe("send");
  });

  it("draws a static mini map with the pin", () => {
    chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
    render(<Advanced />);
    const map = ofKind("map")[0];
    expect(map.options.dragging).toBe(false);
    expect(map.options.scrollWheelZoom).toBe(false);
    expect(ofKind("marker").length).toBe(1);
  });

  it("shows the advanced settings open", () => {
    render(<Advanced />);
    const details = document.querySelector("details.advanced") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(within(details).getByText("all recommended")).toBeTruthy();
  });
});

describe("Radio fields", () => {
  const field = (n: string) => screen.getByLabelText(n) as HTMLInputElement;

  it("rejects out-of-range values with an inline error and a plan error, keeping the last valid radio", () => {
    render(<Advanced />);
    type("Spreading factor", "13");
    expect(screen.getByText("Spreading factor must be a whole number from 5 to 12.")).toBeTruthy();
    expect(store.plan.value.radio.sf).toBe(8);
    expect(planErrors(store.plan.value).some((e) => e.key === "radio")).toBe(true);
    expect(canApply.value.reasons).toContainEqual({ key: "error.radioInvalid" });
    store.step.value = "send";
    expect(stepStatus("advanced")).toBe("done");
  });

  it("keeps the invalid text across blur and a remount until the value becomes valid", () => {
    const { unmount } = render(<Advanced />);
    type("Frequency (MHz)", "99");
    fireEvent.blur(field("Frequency (MHz)"));
    expect(field("Frequency (MHz)").value).toBe("99");
    unmount();
    render(<Advanced />);
    expect(field("Frequency (MHz)").value).toBe("99");
    expect((screen.getByLabelText("Preset") as HTMLSelectElement).value).toBe("custom");
    type("Frequency (MHz)", "868.1");
    expect(store.plan.value.radioText).toBeUndefined();
    expect(planErrors(store.plan.value).some((e) => e.key === "radio")).toBe(false);
  });

  it("limits: freq 150-2500, bandwidth 7-500 rounded to 3 decimals, whole SF and CR", () => {
    render(<Advanced />);
    type("Bandwidth (kHz)", "62.12345");
    expect(store.plan.value.radio.bw).toBe(62.123);
    type("Bandwidth (kHz)", "501");
    expect(store.plan.value.radioText?.bw).toBe("501");
    type("Coding rate", "5.5");
    expect(store.plan.value.radioText?.cr).toBe("5.5");
    type("Frequency (MHz)", "2501");
    expect(store.plan.value.radioText?.freq).toBe("2501");
  });

  it("keeps Custom selected after choosing it, and picking a preset clears the custom state", () => {
    const { unmount } = render(<Advanced />);
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "custom" } });
    unmount();
    render(<Advanced />);
    expect((screen.getByLabelText("Preset") as HTMLSelectElement).value).toBe("custom");
    type("Frequency (MHz)", "99");
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "Australia" } });
    expect(store.plan.value.radioText).toBeUndefined();
    expect(store.plan.value.radioCustom).toBeUndefined();
    expect((screen.getByLabelText("Preset") as HTMLSelectElement).value).toBe("Australia");
  });

  it("outlines against snapshot.radio and shows what the repeater has", () => {
    store.snapshot.value = { radio: { freq: 869.618, sf: 8, bw: 62.5, cr: 5 }, settings: {}, missing: [] };
    render(<Advanced />);
    expect(field("Coding rate").closest(".field")!.classList.contains("changed")).toBe(true);
    expect(screen.getByText("Was 5 on the repeater.")).toBeTruthy();
    expect(field("Spreading factor").closest(".field")!.classList.contains("changed")).toBe(false);
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
