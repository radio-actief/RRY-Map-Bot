import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("leaflet", async () => await import("./fakes/leaflet"));

import { Panel } from "../src/app/Panel";
import { Stepper } from "../src/app/Stepper";
import { defaultPlan } from "../src/core/plan";
import type { Place } from "../src/core/search";
import { isWide, NUMBERED, resetPlan, stepNumber, STEPS, store, visited } from "../src/state/store";
import { resetFake } from "./fakes/leaflet";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(__dirname, "../../../data/be-locode.json"), "utf8"));

beforeEach(() => {
  resetFake();
  resetPlan(defaultPlan());
  store.data.value = { failed: new Set(), places: PLACES };
  store.device.value = { status: "none", link: null, firmware: null };
  store.step.value = "connect";
  visited.value = new Set(["connect"]);
});
afterEach(cleanup);

describe("step list", () => {
  it("runs connect → place → name → regions → settings → send, every step numbered", () => {
    expect(STEPS).toEqual(["connect", "place", "name", "regions", "settings", "send"]);
    expect(NUMBERED).toEqual(STEPS);
    expect(STEPS.map(stepNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(STEPS.filter(isWide)).toEqual(["settings", "send"]);
  });
});

describe("Stepper", () => {
  it("renders 6 segments, the 5th labelled Settings, none optional", () => {
    const { container } = render(<Stepper wide={false} />);
    const segs = container.querySelectorAll(".seg");
    expect(segs).toHaveLength(6);
    expect(segs[4].textContent).toContain("Settings");
    expect(container.querySelector(".seg.optional")).toBeNull();
  });

  it("the docked line reads 2 / 6 on place, with the next numbered step", () => {
    store.step.value = "place";
    const { container } = render(<Stepper wide={false} />);
    const line = container.querySelector(".stepper-line")!;
    expect(line.textContent).toContain("2 / 6");
    expect(line.textContent).toContain("Place");
    expect(line.textContent).toContain("Next: Name");
  });

  it("the docked line on Settings reads 5 / 6 and Next: Send", () => {
    store.step.value = "settings";
    const { container } = render(<Stepper wide={false} />);
    const line = container.querySelector(".stepper-line")!;
    expect(line.textContent).toContain("5 / 6");
    expect(line.textContent).toContain("Settings");
    expect(line.textContent).toContain("Next: Send");
  });

  it("the docked line on Send has no next step", () => {
    store.step.value = "send";
    const { container } = render(<Stepper wide={false} />);
    const line = container.querySelector(".stepper-line")!;
    expect(line.textContent).toContain("6 / 6");
    expect(line.textContent).not.toContain("Next:");
  });

  it("clicking a segment jumps to that step", () => {
    const { container } = render(<Stepper wide={false} />);
    fireEvent.click(container.querySelectorAll(".seg")[3]);
    expect(store.step.value).toBe("regions");
  });
});

describe("panel footer", () => {
  it("from regions, Next: Settings goes to settings, and there is no separate settings link", () => {
    store.step.value = "regions";
    render(<Panel />);
    expect(screen.queryByRole("button", { name: "Advanced settings" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next: Settings →" }));
    expect(store.step.value).toBe("settings");
  });

  it("name goes Next to regions and Back to place", () => {
    store.step.value = "name";
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "Next: Regions →" }));
    expect(store.step.value).toBe("regions");
    store.step.value = "name";
    cleanup();
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(store.step.value).toBe("place");
  });

  it("Settings goes Back to regions and Next to send", () => {
    store.step.value = "settings";
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "Next: Send →" }));
    expect(store.step.value).toBe("send");
    store.step.value = "settings";
    cleanup();
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(store.step.value).toBe("regions");
  });

  it("Send goes Back to settings", () => {
    store.step.value = "send";
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(store.step.value).toBe("settings");
  });
});
