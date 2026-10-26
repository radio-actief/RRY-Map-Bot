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
import { SettingsStep } from "../src/steps/SettingsStep";
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
  store.step.value = "settings";
  visited.value = new Set(["settings"]);
});
afterEach(cleanup);

const type = (label: RegExp | string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
const card = (title: string) =>
  screen.getByRole("heading", { name: title, level: 3 }).closest("section") as HTMLElement;
const fieldOf = (label: RegExp | string) => screen.getByLabelText(label).closest(".field") as HTMLElement;
const segment = (label: string, option: string) =>
  within(screen.getByRole("group", { name: label })).getByRole("button", { name: option });

describe("Settings step", () => {
  it("no longer shows owner info (it is on Name)", () => {
    render(<SettingsStep />);
    expect(screen.queryByRole("heading", { name: "Owner info" })).toBeNull();
    expect(screen.queryByLabelText("Owner info")).toBeNull();
  });

  it("lists the admin password line in the summary and no longer shows the password fields", async () => {
    render(<SettingsStep />);
    expect(screen.getByText("Admin password stays as it is")).toBeTruthy();
    expect(screen.queryByLabelText("Admin password")).toBeNull();
    expect(screen.queryByLabelText("Guest password")).toBeNull();
    store.plan.value = { ...store.plan.value, settings: { ...store.plan.value.settings, adminPassword: "secret" } };
    expect(await screen.findByText("Admin password will be changed")).toBeTruthy();
  });

  it("shows the range error for zero-hop advert 30, which blocks Apply but never turns the Advanced segment orange", () => {
    render(<SettingsStep />);
    type("Zero-hop advert (minutes)", "30");
    expect(screen.getByText("Value is out of range.")).toBeTruthy();
    expect(canApply.value.reasons).toContainEqual({ key: "error.range" });
    store.step.value = "send";
    expect(stepStatus("settings")).toBe("done");
    store.step.value = "settings";
    type("Zero-hop advert (minutes)", "60");
    expect(canApply.value.reasons).not.toContainEqual({ key: "error.range" });
    store.step.value = "send";
    expect(stepStatus("settings")).toBe("done");
  });

  it("the Average pill sets flood.max.unscoped 8 and flood.max.advert 12", () => {
    render(<SettingsStep />);
    fireEvent.click(screen.getByRole("button", { name: /Average/ }));
    expect(store.plan.value.settings.floodMaxUnscoped).toBe(8);
    expect(store.plan.value.settings.floodMaxAdvert).toBe(12);
    expect(screen.getByRole("button", { name: /Average/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("badges: unchanged, then a change count, and the changed field is outlined", () => {
    render(<SettingsStep />);
    expect(within(card("Adverts & hops")).getByText("unchanged")).toBeTruthy();
    type("Flood advert (hours)", "12");
    expect(within(card("Adverts & hops")).getByText("1 change")).toBeTruthy();
    expect(fieldOf("Flood advert (hours)").classList.contains("changed")).toBe(true);
  });

  it("a preset shows its radio as one line; the four fields appear only for Custom", () => {
    render(<SettingsStep />);
    const select = screen.getByLabelText("Preset") as HTMLSelectElement;
    expect(select.value).toBe("EU/UK (Narrow)");
    expect(screen.getByText("869.618 MHz · 62.5 kHz · SF8 · CR8")).toBeTruthy();
    expect(screen.queryByLabelText("Frequency (MHz)")).toBeNull();
    fireEvent.change(select, { target: { value: "Australia" } });
    expect(store.plan.value.radio).toEqual({ freq: 915.8, sf: 10, bw: 250, cr: 5 });
    expect(screen.getByText("915.8 MHz · 250 kHz · SF10 · CR5")).toBeTruthy();
    fireEvent.change(select, { target: { value: "custom" } });
    expect(screen.queryByText("915.8 MHz · 250 kHz · SF10 · CR5")).toBeNull();
    type("Frequency (MHz)", "868.1");
    expect(store.plan.value.radio.freq).toBe(868.1);
    expect((screen.getByLabelText("Preset") as HTMLSelectElement).value).toBe("custom");
  });

  it("tags 'On repeater: X' only when the snapshot has the setting and the plan differs, and ↺ restores it", () => {
    store.snapshot.value = { settings: { floodAdvertHours: 3, dutycycle: "10" }, missing: [] };
    render(<SettingsStep />);
    type("Flood advert (hours)", "12");
    const line = fieldOf("Flood advert (hours)").querySelector(".label-line") as HTMLElement;
    const tag = within(line).getByText("On repeater:").closest(".repeater-value") as HTMLElement;
    expect(within(tag).getByText("3").tagName).toBe("CODE");
    expect(screen.queryByText(/Was .* on the repeater/)).toBeNull();
    expect(within(fieldOf("Duty cycle")).queryByText("On repeater:")).toBeNull();
    fireEvent.click(within(tag).getByRole("button", { name: "Use the repeater's value (3)" }));
    expect(store.plan.value.settings.floodAdvertHours).toBe(3);
    expect(within(fieldOf("Flood advert (hours)")).queryByText("On repeater:")).toBeNull();
  });

  it("Advertising's button sets 47 and 8/12 and leaves Repeating's loop detect alone", () => {
    render(<SettingsStep />);
    type("Flood advert (hours)", "12");
    fireEvent.click(segment("Loop detection", "Strict"));
    fireEvent.click(within(card("Adverts & hops")).getByRole("button", { name: "#BEmesh Recommended" }));
    expect(store.plan.value.settings.floodAdvertHours).toBe(47);
    expect(store.plan.value.settings.advertIntervalMinutes).toBe(0);
    expect(store.plan.value.settings.floodMaxUnscoped).toBe(8);
    expect(store.plan.value.settings.floodMaxAdvert).toBe(12);
    expect(store.plan.value.settings.loopDetect).toBe("strict");
    expect(within(card("Adverts & hops")).getByText("recommended ✓")).toBeTruthy();
  });

  it("the all button sets every block and leaves the guest password alone", () => {
    render(<SettingsStep />);
    store.plan.value = { ...store.plan.value, settings: { ...store.plan.value.settings, guestPassword: "hello" } };
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "Australia" } });
    fireEvent.click(segment("Loop detection", "Strict"));
    fireEvent.click(segment("Path hash size", "3 bytes"));
    fireEvent.click(screen.getByRole("button", { name: "#BEmesh Recommended for all" }));
    const plan = store.plan.value;
    for (const b of BLOCKS) expect(isBlockRecommended(plan, b)).toBe(true);
    expect(plan.settings.guestPassword).toBe("hello");
    expect(plan.settings.loopDetect).toBe("minimal");
    expect(plan.settings.pathHashMode).toBe("1");
    expect(plan.radio).toEqual(defaultPlan().radio);
  });

  it("the Repeating ↺ shows once loop detect changed, and undoes only Repeating", () => {
    render(<SettingsStep />);
    expect(within(card("Repeating")).queryByRole("button", { name: "Undo the changes in Repeating" })).toBeNull();
    type("Flood advert (hours)", "12");
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
    // As the drawer's import does: the imported plan is also the start plan. Flood advert 12
    // keeps the block off its recommendation, so 64 reads as a change rather than "recommended".
    const imported = { ...newPlan(), settings: { ...newPlan().settings, floodMax: 32, floodAdvertHours: 12 } };
    store.plan.value = imported;
    store.startPlan.value = imported;
    render(<SettingsStep />);
    const adverts = card("Adverts & hops");
    expect(within(adverts).getByText("unchanged")).toBeTruthy();
    expect(fieldOf("Max flood hops").classList.contains("changed")).toBe(false);
    type("Max flood hops", "64");
    expect(within(adverts).getByText("1 change")).toBeTruthy();
    expect(fieldOf("Max flood hops").classList.contains("changed")).toBe(true);
    fireEvent.click(within(adverts).getByRole("button", { name: "Undo the changes in Adverts & hops" }));
    expect(store.plan.value.settings.floodMax).toBe(32);
    expect(within(adverts).getByText("unchanged")).toBeTruthy();
  });

  it("a block with changes that match its recommendation reads recommended, and its button is off", () => {
    const imported = { ...newPlan(), settings: { ...newPlan().settings, floodMax: 32 } };
    store.plan.value = imported;
    store.startPlan.value = imported;
    render(<SettingsStep />);
    const adverts = card("Adverts & hops");
    const recommend = within(adverts).getByRole("button", { name: "#BEmesh Recommended" });
    expect(recommend.hasAttribute("disabled")).toBe(false);
    type("Max flood hops", "64");
    expect(within(adverts).getByText("recommended ✓")).toBeTruthy();
    expect(within(adverts).getByRole("button", { name: "Undo the changes in Adverts & hops" })).toBeTruthy();
    expect(recommend.hasAttribute("disabled")).toBe(true);
  });

  it("a fresh app shows every block unchanged and no field outlined", () => {
    resetPlan(newPlan());
    render(<SettingsStep />);
    for (const name of ["Radio", "Adverts & hops", "Repeating", "Site & timing", "Advanced"]) {
      expect(within(card(name)).getByText("unchanged")).toBeTruthy();
      expect(within(card(name)).queryByText(/\d+ changes?$/)).toBeNull();
    }
    expect(document.querySelectorAll(".field.changed").length).toBe(0);
  });

  it("the Site & timing card: Hilltop sets 2 / 2 / 3, typed timing shows Custom and opens Fine-tune", () => {
    render(<SettingsStep />);
    const site = card("Site & timing");
    expect(within(site).getByText("Timing preset")).toBeTruthy();
    expect(within(card("Adverts & hops")).getByText("Hop allowance preset (unscoped / advert)")).toBeTruthy();
    const fold = within(site).getByText("Fine-tune").closest("details") as HTMLDetailsElement;
    fireEvent.click(within(site).getByRole("button", { name: "Hilltop" }));
    expect(store.plan.value.settings).toMatchObject({ txdelay: 2, directTxdelay: 2, rxdelay: 3 });
    expect(within(fold).getByText("2 / 2 / 3")).toBeTruthy();
    expect(fold.open).toBe(false);
    expect(within(site).getByRole("button", { name: "Custom" }).getAttribute("aria-pressed")).toBe("false");
    type("Flood delay factor", "0.6");
    expect(within(site).getByRole("button", { name: "Custom" }).getAttribute("aria-pressed")).toBe("true");
    expect(fold.open).toBe(true);
  });

  it("folds the two hop numbers under the hop preset; max flood hops stays in view", () => {
    resetPlan(newPlan());
    render(<SettingsStep />);
    const adverts = card("Adverts & hops");
    const fold = within(adverts).getByText("Fine-tune").closest("details") as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(within(fold).getByText("8 / 12")).toBeTruthy();
    expect(within(fold).getByLabelText("Max hops without region")).toBeTruthy();
    expect(fieldOf("Max flood hops").closest("details")).toBeNull();
    type("Max hops without region", "9");
    expect(fold.open).toBe(true);
  });

  it("keeps the long help behind ⓘ", () => {
    render(<SettingsStep />);
    const duty = fieldOf("Duty cycle");
    expect(within(duty).getByText("Share of airtime it may transmit. EU 868 MHz: 10 %.")).toBeTruthy();
    expect(within(duty).queryByText(/stays silent/)).toBeNull();
    const info = within(duty).getByRole("button", { name: "More about Duty cycle" });
    expect(info.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(info);
    expect(info.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(info.getAttribute("aria-controls")!)!.textContent).toMatch(/stays silent/);
    // A field whose help says it all has no ⓘ.
    expect(within(fieldOf("Extra acknowledgements")).queryByRole("button", { name: /More about/ })).toBeNull();
  });

  it("the Tight pill sets 2/3 and explains itself", () => {
    render(<SettingsStep />);
    fireEvent.click(screen.getByRole("button", { name: "Tight 2/3" }));
    expect(store.plan.value.settings.floodMaxUnscoped).toBe(2);
    expect(store.plan.value.settings.floodMaxAdvert).toBe(3);
    expect(screen.getByText("Floods reach only the repeaters close by.")).toBeTruthy();
  });

  it("the Radio ↺ restores the start radio after choosing Australia", () => {
    render(<SettingsStep />);
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "Australia" } });
    expect(within(card("Radio")).getByText("1 change")).toBeTruthy();
    fireEvent.click(within(card("Radio")).getByRole("button", { name: "Undo the changes in Radio" }));
    expect(store.plan.value.radio).toEqual(defaultPlan().radio);
    expect((screen.getByLabelText("Preset") as HTMLSelectElement).value).toBe("EU/UK (Narrow)");
  });

  it("lists the changes live and goes back / next", () => {
    render(<SettingsStep />);
    const count = () => Number(/· (\d+)$/.exec(screen.getByText(/^What will change · /).textContent!)![1]);
    const before = count();
    type("Flood advert (hours)", "12");
    expect(count()).toBe(before + 1);
    expect(within(document.querySelector(".summary") as HTMLElement).getAllByText("→ 12").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(store.step.value).toBe("regions");
    store.step.value = "settings";
    fireEvent.click(screen.getByRole("button", { name: /Next: Send/ }));
    expect(store.step.value).toBe("send");
  });

  it("draws a static mini map with the pin", () => {
    chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
    render(<SettingsStep />);
    const map = ofKind("map")[0];
    expect(map.options.dragging).toBe(false);
    expect(map.options.scrollWheelZoom).toBe(false);
    expect(ofKind("marker").length).toBe(1);
  });

  it("shows the five blocks as cards in order, with the all button by the title and each card's in its header", () => {
    render(<SettingsStep />);
    const titles = [...document.querySelectorAll(".card-grid .card-head h3")].map((h) => h.textContent);
    expect(titles).toEqual(["Radio", "Adverts & hops", "Repeating", "Site & timing", "Advanced"]);
    const head = screen.getByRole("heading", { name: "Settings", level: 2 }).closest(".step-head")!;
    expect(within(head as HTMLElement).getByRole("button", { name: "#BEmesh Recommended for all" })).toBeTruthy();
    for (const name of ["Radio", "Adverts & hops", "Repeating", "Site & timing", "Advanced"]) {
      const head = card(name).querySelector(".card-head") as HTMLElement;
      expect(within(head).getByRole("button", { name: "#BEmesh Recommended" })).toBeTruthy();
    }
  });
});

describe("Radio fields", () => {
  const field = (n: string) => screen.getByLabelText(n) as HTMLInputElement;
  beforeEach(() => {
    store.plan.value = { ...store.plan.value, radioCustom: true };
  });

  it("rejects out-of-range values with an inline error and a plan error, keeping the last valid radio", () => {
    render(<SettingsStep />);
    type("Spreading factor", "13");
    expect(screen.getByText("Spreading factor must be a whole number from 5 to 12.")).toBeTruthy();
    expect(store.plan.value.radio.sf).toBe(8);
    expect(planErrors(store.plan.value).some((e) => e.key === "radio")).toBe(true);
    expect(canApply.value.reasons).toContainEqual({ key: "error.radioInvalid" });
    store.step.value = "send";
    expect(stepStatus("settings")).toBe("done");
  });

  it("keeps the invalid text across blur and a remount until the value becomes valid", () => {
    const { unmount } = render(<SettingsStep />);
    type("Frequency (MHz)", "99");
    fireEvent.blur(field("Frequency (MHz)"));
    expect(field("Frequency (MHz)").value).toBe("99");
    unmount();
    render(<SettingsStep />);
    expect(field("Frequency (MHz)").value).toBe("99");
    expect((screen.getByLabelText("Preset") as HTMLSelectElement).value).toBe("custom");
    type("Frequency (MHz)", "868.1");
    expect(store.plan.value.radioText).toBeUndefined();
    expect(planErrors(store.plan.value).some((e) => e.key === "radio")).toBe(false);
  });

  it("limits: freq 150-2500, bandwidth 7-500 rounded to 3 decimals, whole SF and CR", () => {
    render(<SettingsStep />);
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
    store.plan.value = { ...store.plan.value, radioCustom: undefined };
    const { unmount } = render(<SettingsStep />);
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "custom" } });
    unmount();
    render(<SettingsStep />);
    expect((screen.getByLabelText("Preset") as HTMLSelectElement).value).toBe("custom");
    type("Frequency (MHz)", "99");
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "Australia" } });
    expect(store.plan.value.radioText).toBeUndefined();
    expect(store.plan.value.radioCustom).toBeUndefined();
    expect((screen.getByLabelText("Preset") as HTMLSelectElement).value).toBe("Australia");
  });

  it("on a preset, tags the repeater's whole radio by the preset; ↺ puts it back as Custom", () => {
    store.plan.value = { ...store.plan.value, radioCustom: undefined };
    store.snapshot.value = { radio: { freq: 869.618, sf: 8, bw: 62.5, cr: 5 }, settings: {}, missing: [] };
    render(<SettingsStep />);
    const preset = screen.getByLabelText("Preset").closest(".field") as HTMLElement;
    expect(within(preset).getByText("869.618 MHz · 62.5 kHz · SF8 · CR5").tagName).toBe("CODE");
    fireEvent.click(within(preset).getByRole("button", { name: "Use the repeater's value (869.618 MHz · 62.5 kHz · SF8 · CR5)" }));
    expect(store.plan.value.radio).toEqual({ freq: 869.618, sf: 8, bw: 62.5, cr: 5 });
    expect((screen.getByLabelText("Preset") as HTMLSelectElement).value).toBe("custom");
    expect(within(preset).queryByText("On repeater:")).toBeNull();
    expect(field("Coding rate").value).toBe("5");
  });

  it("tags what the repeater's radio has, ↺ restores it, and outlines against the start plan", () => {
    store.snapshot.value = { radio: { freq: 869.618, sf: 8, bw: 62.5, cr: 5 }, settings: {}, missing: [] };
    render(<SettingsStep />);
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
    render(<SettingsStep />);
    expect(within(list()).getAllByText("Unknown key")).toHaveLength(2);
    expect(within(list()).getByText("aaaaaa…bbbbbb")).toBeTruthy();
    const select = within(list()).getAllByRole("combobox")[0] as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["Admin", "Read-write", "Read-only"]);
    expect(select.value).toBe("3");
  });

  it("changing a role edits the plan and drops raw perms", () => {
    withAcl([{ key: K1, role: 3, perms: 7 }]);
    render(<SettingsStep />);
    fireEvent.change(within(list()).getAllByRole("combobox")[0], { target: { value: "2" } });
    expect(store.plan.value.acl).toEqual([{ key: K1, role: 2 }]);
  });

  it("remove strikes the row with a removed badge; undo restores it", () => {
    render(<SettingsStep />);
    fireEvent.click(within(list()).getAllByRole("button", { name: /^Remove/ })[1]);
    expect(store.plan.value.acl).toEqual([{ key: K1, role: 3 }]);
    expect(within(list()).getByText("removed")).toBeTruthy();
    expect(within(list()).getByText("1 change")).toBeTruthy();
    fireEvent.click(within(list()).getByRole("button", { name: /^Undo the removal/ }));
    expect(store.plan.value.acl).toEqual([{ key: K1, role: 3 }, { key: K2, role: 1 }]);
    expect(within(list()).queryByText("removed")).toBeNull();
  });

  it("adds a pasted key as Admin with a new badge", () => {
    render(<SettingsStep />);
    add(K4.replace(/(.{8})/g, "$1 "));
    fireEvent.click(within(list()).getByRole("button", { name: "Add" }));
    expect(store.plan.value.acl!.at(-1)).toEqual({ key: K4, role: 3 });
    expect(within(list()).getByText("new")).toBeTruthy();
    expect(within(list()).getByText("BE-GNT-Pieter")).toBeTruthy();
  });

  it("refuses a short or duplicate key", () => {
    render(<SettingsStep />);
    add("abc");
    fireEvent.click(within(list()).getByRole("button", { name: "Add" }));
    expect(within(list()).getByText("Not a public key: 64 hexadecimal characters")).toBeTruthy();
    add(K1);
    fireEvent.click(within(list()).getByRole("button", { name: "Add" }));
    expect(within(list()).getByText("This key is already on the list")).toBeTruthy();
    expect(store.plan.value.acl).toHaveLength(2);
  });

  it("offers companions from the map by name or key prefix", () => {
    render(<SettingsStep />);
    add("Pieter");
    fireEvent.click(within(list()).getByRole("button", { name: "BE-GNT-Pieter" }));
    expect(store.plan.value.acl!.at(-1)).toEqual({ key: K4, role: 3 });
  });

  it("the badge counts the changes and ↺ resets to what was read", () => {
    render(<SettingsStep />);
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
    render(<SettingsStep />);
    expect(within(list()).queryByText(warn)).toBeNull();
    const full = Array.from({ length: ACL_MAX }, (_, i) => ({ key: i.toString(16).padStart(64, "0"), role: 1 as const }));
    store.plan.value = { ...store.plan.value, acl: full };
    return screen.findByText(warn);
  });

  it("without a Read the card asks for one", () => {
    store.snapshot.value = null;
    resetPlan(defaultPlan());
    render(<SettingsStep />);
    expect(within(list()).getByText("Read the repeater to see its access list.")).toBeTruthy();
  });

  it("an access list in the plan without the repeater's Read (unplugged, another device) is not editable", () => {
    store.plan.value = { ...store.plan.value, acl: [{ key: K1, role: 3 }] };
    store.snapshot.value = null;
    render(<SettingsStep />);
    expect(within(list()).getByText("Read the repeater to see its access list.")).toBeTruthy();
    expect(within(list()).queryByRole("combobox")).toBeNull();
    expect(within(list()).queryByPlaceholderText(/Paste a public key/)).toBeNull();
    expect(within(list()).queryByText(/change/)).toBeNull();
  });

  it("removed and new rows and the badge compare with what the repeater holds", () => {
    store.startPlan.value = { ...store.startPlan.value, acl: [{ key: K1, role: 3 }] };
    store.plan.value = { ...store.plan.value, acl: [{ key: K1, role: 3 }, { key: K4, role: 3 }] };
    render(<SettingsStep />);
    expect(within(list()).getByText("removed")).toBeTruthy();
    expect(within(list()).getByText("new")).toBeTruthy();
    expect(within(list()).getByText("2 changes")).toBeTruthy();
    fireEvent.click(within(list()).getByRole("button", { name: "Reset the access list to what was read" }));
    expect(store.plan.value.acl).toEqual(store.snapshot.value!.acl);
  });

  it("recommended buttons never change the list", () => {
    render(<SettingsStep />);
    const acl = store.plan.value.acl;
    fireEvent.click(screen.getByRole("button", { name: "#BEmesh Recommended for all" }));
    expect(store.plan.value.acl).toEqual(acl);
  });
});
