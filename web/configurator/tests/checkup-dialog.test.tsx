import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("leaflet", async () => await import("./fakes/leaflet"));

import { recommendedForAll } from "../src/core/blocks";
import { applyCheckup, checkupLines } from "../src/core/checkup";
import { defaultPlan, planFromSnapshot, snapshotFromReplies, type Plan } from "../src/core/plan";
import { policyFor } from "../src/core/regions";
import type { Place } from "../src/core/search";
import { Connect } from "../src/steps/Connect";
import { resetPlan, store } from "../src/state/store";
import { resetFake } from "./fakes/leaflet";
import read from "./fixtures/read-ronse.json";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(__dirname, "../../../data/be-locode.json"), "utf8"));
const snapshot = snapshotFromReplies(read);
const fromRead = planFromSnapshot(snapshot, PLACES);
const P: Plan = {
  ...fromRead,
  prefixFormat: "none",
  nameSuffix: "Kluisberg",
  settings: {
    ...fromRead.settings,
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

function afterRead(plan: Plan) {
  resetPlan(plan);
  store.snapshot.value = snapshot;
  store.lastRead.value = { ok: true, count: 34, missing: [] };
  store.device.value = { status: "connected", link: null, firmware: "v1.17.1" };
}

beforeEach(() => {
  resetFake();
  resetPlan(defaultPlan());
  store.snapshot.value = null;
  store.lastRead.value = null;
  store.step.value = "connect";
  store.device.value = { status: "none", link: null, firmware: null };
  store.data.value = { failed: new Set(), places: PLACES, municipalities: [] };
});
afterEach(cleanup);

const openDialog = () => {
  render(<Connect />);
  fireEvent.click(screen.getByRole("button", { name: "Quick check-up…" }));
  return screen.getByRole("dialog", { name: "Quick check-up", hidden: true });
};

describe("Connect notice", () => {
  it("after a Read the notice counts the differences per block", () => {
    afterRead(P);
    render(<Connect />);
    expect(screen.getByText("5 settings differ from #BEmesh")).toBeTruthy();
    expect(screen.getByText(/Radio 1 · Advertising & hops 1 · Repeating 1 · Regions · Advanced 1\. The name differs too\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quick check-up…" })).toBeTruthy();
  });

  it("a repeater that follows the recommendation", () => {
    afterRead(recommendedForAll({ ...P, prefixFormat: "city", regions: policyFor(P.anchor!, PLACES) }));
    render(<Connect />);
    expect(screen.getByText("This repeater follows the #BEmesh recommendation")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quick check-up…" })).toBeNull();
  });

  it("no notice before a Read", () => {
    store.device.value = { status: "connected", link: null, firmware: "v1.17.1" };
    render(<Connect />);
    expect(screen.queryByText(/differ from #BEmesh/)).toBeNull();
    expect(screen.queryByText(/follows the #BEmesh/)).toBeNull();
  });
});

describe("Quick check-up dialog", () => {
  it("lists the lines grouped, name unticked, with the footer count", () => {
    afterRead(P);
    const d = within(openDialog());
    expect(d.getByRole("heading", { name: "Quick check-up", hidden: true })).toBeTruthy();
    expect(d.getByText(/compared with the #BEmesh recommendation/)).toBeTruthy();
    expect(d.getByText("50 % → 10 %")).toBeTruthy();
    expect(d.getByText("Not ticked: people and the map know your node by its name.")).toBeTruthy();
    const boxes = d.getAllByRole("checkbox", { hidden: true }) as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true, true, true, true, true]);
    expect(d.getByText("5 of 6 ticked")).toBeTruthy();
  });

  it("Send N changes… applies the ticked lines and opens Send", () => {
    afterRead(P);
    const d = within(openDialog());
    const ids = new Set(checkupLines(P, PLACES).filter((l) => l.ticked).map((l) => l.id));
    fireEvent.click(d.getByRole("button", { name: "Send 5 changes…", hidden: true }));
    expect(store.step.value).toBe("send");
    expect(store.plan.value).toEqual(applyCheckup(P, PLACES, ids));
  });

  it("Open in the steps applies and opens Place", () => {
    afterRead(P);
    const d = within(openDialog());
    fireEvent.click(d.getByRole("button", { name: "Open in the steps", hidden: true }));
    expect(store.step.value).toBe("place");
    expect(store.plan.value.settings.dutycycle).toBe("10");
  });

  it("Escape and the close button change nothing", () => {
    afterRead(P);
    const dialog = openDialog();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog", { name: "Quick check-up", hidden: true })).toBeNull();
    expect(store.plan.value).toBe(P);
    fireEvent.click(screen.getByRole("button", { name: "Quick check-up…" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Quick check-up", hidden: true })).getByRole("button", { name: "Close", hidden: true }));
    expect(screen.queryByRole("dialog", { name: "Quick check-up", hidden: true })).toBeNull();
    expect(store.plan.value).toBe(P);
    expect(store.step.value).toBe("connect");
  });

  it("with nothing ticked both buttons are disabled", () => {
    afterRead(P);
    const d = within(openDialog());
    for (const b of d.getAllByRole("checkbox", { hidden: true })) if ((b as HTMLInputElement).checked) fireEvent.click(b);
    expect((d.getByRole("button", { name: /Send 0 changes/, hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    expect((d.getByRole("button", { name: "Open in the steps", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a disabled regions line cannot be ticked and shows Choose a location in Place first", () => {
    afterRead({ ...P, anchor: null });
    const d = within(openDialog());
    expect(d.getByText("Choose a location in Place first")).toBeTruthy();
    const boxes = d.getAllByRole("checkbox", { hidden: true }) as HTMLInputElement[];
    const disabled = boxes.filter((b) => b.disabled);
    expect(disabled).toHaveLength(1);
    expect(disabled[0].checked).toBe(false);
    fireEvent.click(disabled[0]);
    expect(d.getByText("4 of 5 ticked")).toBeTruthy();
  });
});
