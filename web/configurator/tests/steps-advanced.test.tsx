import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("leaflet", async () => await import("./fakes/leaflet"));

import { BLOCKS, isBlockRecommended } from "../src/core/blocks";
import { ACL_MAX, type AclEntry } from "../src/core/acl";
import { defaultPlan, newPlan, planErrors } from "../src/core/plan";
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
const card = (title: string) =>
  screen.getByRole("heading", { name: title, level: 3 }).closest("section") as HTMLElement;
const fieldOf = (label: RegExp | string) => screen.getByLabelText(label).closest(".field") as HTMLElement;
const segment = (label: string, option: string) =>
  within(screen.getByRole("group", { name: label })).getByRole("button", { name: option });

describe("Advanced step", () => {
  it("no longer shows owner info (it is on Name)", () => {
    render(<Advanced />);
    expect(screen.queryByRole("heading", { name: "Owner info" })).toBeNull();
    expect(screen.queryByLabelText("Contact or notes")).toBeNull();
  });

  it("lists the admin password line in the summary and no longer shows the password fields", async () => {
    render(<Advanced />);
    expect(screen.getByText("Admin password stays as it is")).toBeTruthy();
    expect(screen.queryByLabelText("Admin password")).toBeNull();
    expect(screen.queryByLabelText("Guest password")).toBeNull();
    store.plan.value = { ...store.plan.value, settings: { ...store.plan.value.settings, adminPassword: "secret" } };
    expect(await screen.findByText("Admin password will be changed")).toBeTruthy();
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
    expect(within(card("Advertising & hops")).getByText("unchanged")).toBeTruthy();
    type(/Flood advert/, "12");
    expect(within(card("Advertising & hops")).getByText("1 change")).toBeTruthy();
    expect(fieldOf(/Flood advert/).classList.contains("changed")).toBe(true);
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

  it("tags 'On repeater: X' only when the snapshot has the setting and the plan differs, and ↺ restores it", () => {
    store.snapshot.value = { settings: { floodAdvertHours: 3, dutycycle: "10" }, missing: [] };
    render(<Advanced />);
    type(/Flood advert/, "12");
    const line = fieldOf(/Flood advert/).querySelector(".label-line") as HTMLElement;
    const tag = within(line).getByText("On repeater:").closest(".repeater-value") as HTMLElement;
    expect(within(tag).getByText("3").tagName).toBe("CODE");
    expect(screen.queryByText(/Was .* on the repeater/)).toBeNull();
    expect(within(fieldOf("Duty cycle")).queryByText("On repeater:")).toBeNull();
    fireEvent.click(within(tag).getByRole("button", { name: "Use the repeater's value (3)" }));
    expect(store.plan.value.settings.floodAdvertHours).toBe(3);
    expect(within(fieldOf(/Flood advert/)).queryByText("On repeater:")).toBeNull();
  });

  it("Advertising's button sets 47 and 8/12 and leaves Repeating's loop detect alone", () => {
    render(<Advanced />);
    type(/Flood advert/, "12");
    fireEvent.click(segment("Loop detection", "Strict"));
    fireEvent.click(within(card("Advertising & hops")).getByRole("button", { name: "Use #BEmesh recommended settings" }));
    expect(store.plan.value.settings.floodAdvertHours).toBe(47);
    expect(store.plan.value.settings.advertIntervalMinutes).toBe(0);
    expect(store.plan.value.settings.floodMaxUnscoped).toBe(8);
    expect(store.plan.value.settings.floodMaxAdvert).toBe(12);
    expect(store.plan.value.settings.loopDetect).toBe("strict");
    expect(within(card("Advertising & hops")).getByText("recommended ✓")).toBeTruthy();
  });

  it("the all button sets every block and leaves the guest password alone", () => {
    render(<Advanced />);
    store.plan.value = { ...store.plan.value, settings: { ...store.plan.value.settings, guestPassword: "hello" } };
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "Australia" } });
    fireEvent.click(segment("Loop detection", "Strict"));
    fireEvent.click(segment("Path hash size", "3 bytes"));
    fireEvent.click(screen.getByRole("button", { name: "Use #BEmesh recommended settings for all" }));
    const plan = store.plan.value;
    for (const b of BLOCKS) expect(isBlockRecommended(plan, b)).toBe(true);
    expect(plan.settings.guestPassword).toBe("hello");
    expect(plan.settings.loopDetect).toBe("minimal");
    expect(plan.settings.pathHashMode).toBe("1");
    expect(plan.radio).toEqual(defaultPlan().radio);
  });

  it("the Repeating ↺ shows once loop detect changed, and undoes only Repeating", () => {
    render(<Advanced />);
    expect(within(card("Repeating")).queryByRole("button", { name: "Undo the changes in Repeating" })).toBeNull();
    type(/Flood advert/, "12");
    fireEvent.click(segment("Loop detection", "Strict"));
    const undo = within(card("Repeating")).getByRole("button", { name: "Undo the changes in Repeating" });
    expect(undo.getAttribute("title")).toBe("Undo the changes in Repeating");
    fireEvent.click(undo);
    expect(store.plan.value.settings.loopDetect).toBe("minimal");
    expect(store.plan.value.settings.floodAdvertHours).toBe("12");
    expect(within(card("Repeating")).getByText("unchanged")).toBeTruthy();
    expect(within(card("Repeating")).queryByRole("button", { name: /Undo/ })).toBeNull();
  });

  it("after an import with flood.max 32 the badge reads unchanged; 64 is one change and ↺ restores 32", () => {
    // As the drawer's import does: the imported plan is also the start plan. Loop detect "strict"
    // keeps the block off its recommendation, so 64 reads as a change rather than "recommended".
    const imported = { ...defaultPlan(), settings: { ...defaultPlan().settings, floodMax: 32, loopDetect: "strict" } };
    store.plan.value = imported;
    store.startPlan.value = imported;
    render(<Advanced />);
    expect(within(card("Repeating")).getByText("unchanged")).toBeTruthy();
    expect(fieldOf("Max flood hops").classList.contains("changed")).toBe(false);
    type("Max flood hops", "64");
    expect(within(card("Repeating")).getByText("1 change")).toBeTruthy();
    expect(fieldOf("Max flood hops").classList.contains("changed")).toBe(true);
    fireEvent.click(within(card("Repeating")).getByRole("button", { name: "Undo the changes in Repeating" }));
    expect(store.plan.value.settings.floodMax).toBe(32);
    expect(within(card("Repeating")).getByText("unchanged")).toBeTruthy();
  });

  it("a block with changes that match its recommendation reads recommended", () => {
    const imported = { ...defaultPlan(), settings: { ...defaultPlan().settings, floodMax: 32 } };
    store.plan.value = imported;
    store.startPlan.value = imported;
    render(<Advanced />);
    type("Max flood hops", "64");
    expect(within(card("Repeating")).getByText("recommended ✓")).toBeTruthy();
    expect(within(card("Repeating")).getByRole("button", { name: "Undo the changes in Repeating" })).toBeTruthy();
  });

  it("a fresh app shows every block unchanged and no field outlined", () => {
    resetPlan(newPlan());
    render(<Advanced />);
    for (const name of ["Radio", "Advertising & hops", "Repeating", "Advanced"]) {
      expect(within(card(name)).getByText("unchanged")).toBeTruthy();
      expect(within(card(name)).queryByText(/\d+ changes?$/)).toBeNull();
    }
    expect(document.querySelectorAll(".field.changed").length).toBe(0);
  });

  it("the Advanced card's timing pills: Hilltop sets 2 / 2 / 3, and typed timing shows Custom", () => {
    render(<Advanced />);
    const adv = card("Advanced");
    expect(within(adv).getByText("Timing preset")).toBeTruthy();
    fireEvent.click(within(adv).getByRole("button", { name: "Hilltop" }));
    expect(store.plan.value.settings).toMatchObject({ txdelay: 2, directTxdelay: 2, rxdelay: 3 });
    expect(within(adv).queryByText("Custom")).toBeNull();
    type("Flood delay factor", "0.6");
    expect(within(adv).getByText("Custom").getAttribute("aria-current")).toBe("true");
  });

  it("the Tight pill sets 2/3 and explains itself", () => {
    render(<Advanced />);
    fireEvent.click(screen.getByRole("button", { name: "Tight 2/3" }));
    expect(store.plan.value.settings.floodMaxUnscoped).toBe(2);
    expect(store.plan.value.settings.floodMaxAdvert).toBe(3);
    expect(screen.getByText("Floods reach only the repeaters close by.")).toBeTruthy();
  });

  it("the Radio ↺ restores the start radio after choosing Australia", () => {
    render(<Advanced />);
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "Australia" } });
    expect(within(card("Radio")).getByText("1 change")).toBeTruthy();
    fireEvent.click(within(card("Radio")).getByRole("button", { name: "Undo the changes in Radio" }));
    expect(store.plan.value.radio).toEqual(defaultPlan().radio);
    expect((screen.getByLabelText("Preset") as HTMLSelectElement).value).toBe("EU/UK (Narrow)");
  });

  it("lists the changes live and goes back / next", () => {
    render(<Advanced />);
    const count = () => Number(/· (\d+)$/.exec(screen.getByText(/^What will change · /).textContent!)![1]);
    const before = count();
    type(/Flood advert/, "12");
    expect(count()).toBe(before + 1);
    expect(within(document.querySelector(".summary") as HTMLElement).getAllByText("→ 12").length).toBeGreaterThan(0);
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

  it("shows the four blocks as cards in order, with the all button by the title", () => {
    render(<Advanced />);
    const titles = [...document.querySelectorAll(".card-grid .card-head h3")].map((h) => h.textContent);
    expect(titles).toEqual(["Radio", "Advertising & hops", "Repeating", "Advanced"]);
    expect(document.querySelector("details")).toBeNull();
    const head = screen.getByRole("heading", { name: "Advanced settings", level: 2 }).closest(".step-head")!;
    expect(within(head as HTMLElement).getByRole("button", { name: "Use #BEmesh recommended settings for all" })).toBeTruthy();
    for (const name of ["Radio", "Advertising & hops", "Repeating", "Advanced"]) {
      expect(within(card(name)).getByRole("button", { name: "Use #BEmesh recommended settings" })).toBeTruthy();
    }
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

  it("tags what the repeater's radio has, ↺ restores it, and outlines against the start plan", () => {
    store.snapshot.value = { radio: { freq: 869.618, sf: 8, bw: 62.5, cr: 5 }, settings: {}, missing: [] };
    render(<Advanced />);
    const cr = field("Coding rate").closest(".field") as HTMLElement;
    expect(within(cr).getByText("On repeater:")).toBeTruthy();
    expect(within(cr).getByText("5").tagName).toBe("CODE");
    expect(screen.queryByText(/Was .* on the repeater/)).toBeNull();
    expect(within(field("Spreading factor").closest(".field") as HTMLElement).queryByText("On repeater:")).toBeNull();
    expect(cr.classList.contains("changed")).toBe(false);
    fireEvent.click(within(cr).getByRole("button", { name: "Use the repeater's value (5)" }));
    expect(store.plan.value.radio.cr).toBe(5);
    expect(within(cr).queryByText("On repeater:")).toBeNull();
    expect(cr.classList.contains("changed")).toBe(true);
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

describe("Access list card", () => {
  const K1 = "a".repeat(6) + "1".repeat(52) + "b".repeat(6);
  const K2 = "c".repeat(64);
  const K4 = "d4".repeat(32);
  /** A Read of a repeater with this access list: the snapshot and the plan hold it. */
  const withAcl = (acl: AclEntry[]) => {
    store.snapshot.value = { settings: {}, missing: [], acl };
    resetPlan({ ...defaultPlan(), acl: acl.map((e) => ({ ...e })) });
    store.data.value = {
      ...store.data.value,
      nodes: [{ public_key: K4.toUpperCase(), type: 1, adv_name: "BE-GNT-Pieter", adv_lat: 0, adv_lon: 0 }],
    };
  };
  const list = () => card("Access list");
  const add = (value: string) => {
    fireEvent.input(screen.getByPlaceholderText(/Paste a public key/), { target: { value } });
  };

  beforeEach(() => withAcl([{ key: K1, role: 3 }, { key: K2, role: 1 }]));

  it("shows each key with its map name, shortened key and role", () => {
    render(<Advanced />);
    expect(within(list()).getAllByText("Unknown key")).toHaveLength(2);
    expect(within(list()).getByText("aaaaaa…bbbbbb")).toBeTruthy();
    const select = within(list()).getAllByRole("combobox")[0] as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["Admin", "Read-write", "Read-only"]);
    expect(select.value).toBe("3");
  });

  it("changing a role edits the plan and drops raw perms", () => {
    withAcl([{ key: K1, role: 3, perms: 7 }]);
    render(<Advanced />);
    fireEvent.change(within(list()).getAllByRole("combobox")[0], { target: { value: "2" } });
    expect(store.plan.value.acl).toEqual([{ key: K1, role: 2 }]);
  });

  it("remove strikes the row with a removed badge; undo restores it", () => {
    render(<Advanced />);
    fireEvent.click(within(list()).getAllByRole("button", { name: /^Remove/ })[1]);
    expect(store.plan.value.acl).toEqual([{ key: K1, role: 3 }]);
    expect(within(list()).getByText("removed")).toBeTruthy();
    expect(within(list()).getByText("1 change")).toBeTruthy();
    fireEvent.click(within(list()).getByRole("button", { name: /^Undo the removal/ }));
    expect(store.plan.value.acl).toEqual([{ key: K1, role: 3 }, { key: K2, role: 1 }]);
    expect(within(list()).queryByText("removed")).toBeNull();
  });

  it("adds a pasted key as Admin with a new badge", () => {
    render(<Advanced />);
    add(K4.replace(/(.{8})/g, "$1 "));
    fireEvent.click(within(list()).getByRole("button", { name: "Add" }));
    expect(store.plan.value.acl!.at(-1)).toEqual({ key: K4, role: 3 });
    expect(within(list()).getByText("new")).toBeTruthy();
    expect(within(list()).getByText("BE-GNT-Pieter")).toBeTruthy();
  });

  it("refuses a short or duplicate key", () => {
    render(<Advanced />);
    add("abc");
    fireEvent.click(within(list()).getByRole("button", { name: "Add" }));
    expect(within(list()).getByText("Not a public key: 64 hexadecimal characters")).toBeTruthy();
    add(K1);
    fireEvent.click(within(list()).getByRole("button", { name: "Add" }));
    expect(within(list()).getByText("This key is already on the list")).toBeTruthy();
    expect(store.plan.value.acl).toHaveLength(2);
  });

  it("offers companions from the map by name or key prefix", () => {
    render(<Advanced />);
    add("Pieter");
    fireEvent.click(within(list()).getByRole("button", { name: "BE-GNT-Pieter" }));
    expect(store.plan.value.acl!.at(-1)).toEqual({ key: K4, role: 3 });
  });

  it("the badge counts the changes and ↺ resets to what was read", () => {
    render(<Advanced />);
    expect(within(list()).getByText("unchanged")).toBeTruthy();
    fireEvent.click(within(list()).getAllByRole("button", { name: /^Remove/ })[0]);
    fireEvent.change(within(list()).getAllByRole("combobox")[1], { target: { value: "2" } });
    expect(within(list()).getByText("2 changes")).toBeTruthy();
    fireEvent.click(within(list()).getByRole("button", { name: "Reset the access list to what was read" }));
    expect(store.plan.value.acl).toEqual(store.snapshot.value!.acl);
    expect(within(list()).getByText("unchanged")).toBeTruthy();
  });

  it("at 32 entries the card warns", () => {
    const warn = /keeps at most 32 entries/;
    render(<Advanced />);
    expect(within(list()).queryByText(warn)).toBeNull();
    const full = Array.from({ length: ACL_MAX }, (_, i) => ({ key: i.toString(16).padStart(64, "0"), role: 1 as const }));
    store.plan.value = { ...store.plan.value, acl: full };
    return screen.findByText(warn);
  });

  it("without a Read the card asks for one", () => {
    store.snapshot.value = null;
    resetPlan(defaultPlan());
    render(<Advanced />);
    expect(within(list()).getByText("Read the repeater to see its access list.")).toBeTruthy();
  });

  it("an access list in the plan without the repeater's Read (unplugged, another device) is not editable", () => {
    store.plan.value = { ...store.plan.value, acl: [{ key: K1, role: 3 }] };
    store.snapshot.value = null;
    render(<Advanced />);
    expect(within(list()).getByText("Read the repeater to see its access list.")).toBeTruthy();
    expect(within(list()).queryByRole("combobox")).toBeNull();
    expect(within(list()).queryByPlaceholderText(/Paste a public key/)).toBeNull();
    expect(within(list()).queryByText(/change/)).toBeNull();
  });

  it("removed and new rows and the badge compare with what the repeater holds", () => {
    store.startPlan.value = { ...store.startPlan.value, acl: [{ key: K1, role: 3 }] };
    store.plan.value = { ...store.plan.value, acl: [{ key: K1, role: 3 }, { key: K4, role: 3 }] };
    render(<Advanced />);
    expect(within(list()).getByText("removed")).toBeTruthy();
    expect(within(list()).getByText("new")).toBeTruthy();
    expect(within(list()).getByText("2 changes")).toBeTruthy();
    fireEvent.click(within(list()).getByRole("button", { name: "Reset the access list to what was read" }));
    expect(store.plan.value.acl).toEqual(store.snapshot.value!.acl);
  });

  it("recommended buttons never change the list", () => {
    render(<Advanced />);
    const acl = store.plan.value.acl;
    fireEvent.click(screen.getByRole("button", { name: "Use #BEmesh recommended settings for all" }));
    expect(store.plan.value.acl).toEqual(acl);
  });
});
