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
  it("runs connect → place → name → site → regions → advanced → send; Advanced is not numbered", () => {
    expect(STEPS).toEqual(["connect", "place", "name", "site", "regions", "advanced", "send"]);
    expect(NUMBERED).toEqual(["connect", "place", "name", "site", "regions", "send"]);
    expect(STEPS.map(stepNumber)).toEqual([1, 2, 3, 4, 5, null, 6]);
    expect(STEPS.filter(isWide)).toEqual(["advanced", "send"]);
  });
});

describe("Stepper", () => {
  it("renders 7 segments, the 6th labelled Advanced (optional) with class optional", () => {
    const { container } = render(<Stepper wide={false} />);
    const segs = container.querySelectorAll(".seg");
    expect(segs).toHaveLength(7);
    expect(segs[5].textContent).toContain("Advanced (optional)");
    expect(segs[5].classList.contains("optional")).toBe(true);
    expect([...segs].filter((s) => s.classList.contains("optional"))).toHaveLength(1);
  });

  it("the docked line reads 2 / 6 on place, with the next numbered step", () => {
    store.step.value = "place";
    const { container } = render(<Stepper wide={false} />);
    const line = container.querySelector(".stepper-line")!;
    expect(line.textContent).toContain("2 / 6");
    expect(line.textContent).toContain("Place");
    expect(line.textContent).toContain("Next: Name");
  });

  it("the docked line on Advanced shows only the name and Next: Send", () => {
    store.step.value = "advanced";
    const { container } = render(<Stepper wide={false} />);
    const line = container.querySelector(".stepper-line")!;
    expect(line.textContent).not.toMatch(/\/ 6/);
    expect(line.textContent).toContain("Advanced (optional)");
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
    expect(store.step.value).toBe("site");
  });
});

describe("panel footer", () => {
  it("from regions, Next: Send goes to send and Advanced settings goes to advanced", () => {
    store.step.value = "regions";
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "Next: Send →" }));
    expect(store.step.value).toBe("send");
    store.step.value = "regions";
    cleanup();
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced settings" }));
    expect(store.step.value).toBe("advanced");
  });

  it("place, name and site go Back and Next along the numbered steps", () => {
    store.step.value = "name";
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "Next: Site →" }));
    expect(store.step.value).toBe("site");
    cleanup();
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(store.step.value).toBe("name");
    expect(screen.queryByRole("button", { name: "Advanced settings" })).toBeNull();
  });

  it("Advanced goes Back to regions and Next to send", () => {
    store.step.value = "advanced";
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "Next: Send →" }));
    expect(store.step.value).toBe("send");
    store.step.value = "advanced";
    cleanup();
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(store.step.value).toBe("regions");
  });

  it("Send goes Back to regions", () => {
    store.step.value = "send";
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(store.step.value).toBe("regions");
  });
});
