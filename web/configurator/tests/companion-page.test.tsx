import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { Companion } from "../src/companion/Companion";
import type { ChannelData } from "../src/core/companion";
import { defaultPlan } from "../src/core/plan";
import type { Place } from "../src/core/search";
import { listenToHash, setTask, store, taskFromHash } from "../src/state/store";

const ROOT = resolve(__dirname, "../../..");
const channels = JSON.parse(readFileSync(`${ROOT}/data/companion-channels.json`, "utf8")) as ChannelData;
const places = JSON.parse(readFileSync(`${ROOT}/data/be-locode.json`, "utf8")) as Place[];
const place = (name: string) => places.find((p) => p.plaats === name)!;
const read = (file: string): Record<string, string> => JSON.parse(readFileSync(file, "utf8"));

function stubWidth(px: number) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: /max-width:\s*(\d+)px/.test(q) ? px <= Number(/(\d+)px/.exec(q)![1]) : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const row = (name: string) => screen.getByRole("listitem", { name });
const openLink = (name: string) => within(row(name)).getByRole("link", { name: /Open in app/ });

beforeEach(() => {
  stubWidth(1280);
  store.data.value = { failed: new Set(), places, channels };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  store.task.value = "repeater";
  store.companionPick.value = null;
  store.companionScope.value = true;
  store.step.value = "connect";
  store.plan.value = defaultPlan();
  history.replaceState(null, "", "/configurator");
});

describe("the Companion task", () => {
  it("is chosen by the #companion hash", () => {
    expect(taskFromHash("#companion")).toBe("companion");
    expect(taskFromHash("")).toBe("repeater");
    expect(taskFromHash("#other")).toBe("repeater");
  });

  it("setTask writes the hash, and a hash change sets the task", () => {
    const stop = listenToHash();
    setTask("companion");
    expect(location.hash).toBe("#companion");
    expect(store.task.value).toBe("companion");
    setTask("repeater");
    expect(location.hash).toBe("");
    location.hash = "#companion";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(store.task.value).toBe("companion");
    stop();
  });

  it("the tabs switch between the repeater steps and the Companion page", async () => {
    const { container } = render(<App />);
    expect(container.querySelector(".stepper")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Companion" }));
    expect(store.task.value).toBe("companion");
    expect(container.querySelector(".stepper")).toBeNull();
    expect(await screen.findByRole("heading", { name: "Using MeshCore in Belgium?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Repeater" }));
    expect(container.querySelector(".stepper")).toBeTruthy();
  });

  it("shows the map on the Companion page, also when the repeater task was on a wide step", () => {
    store.step.value = "settings";
    const { container } = render(<App />);
    act(() => setTask("companion"));
    expect((container.querySelector(".map-container") as HTMLElement).hidden).toBe(false);
    expect(container.querySelector(".panel")?.classList.contains("wide")).toBe(false);
  });

  it("opens the phone sheet full", () => {
    stubWidth(390);
    store.sheet.value = "half";
    render(<App />);
    act(() => setTask("companion"));
    expect(store.sheet.value).toBe("full");
  });
});

describe("Companion page", () => {
  it("shows the EU/UK (Narrow) values from the configurator's preset data, with the CR 8 check", () => {
    render(<Companion />);
    const preset = screen.getByRole("group", { name: "EU/UK (Narrow)" });
    for (const v of ["869.618 MHz", "62.5 kHz", "SF 8", "CR 8"]) expect(preset.textContent).toContain(v);
    expect(screen.getByText(/CR 5/)).toBeTruthy();
  });

  it("says to set be as the default region", () => {
    render(<Companion />);
    expect(screen.getByText(/every Belgian repeater that carries regions/)).toBeTruthy();
  });

  it("asks for a place before it lists channels", () => {
    render(<Companion />);
    expect(screen.queryByRole("list", { name: /channels/i })).toBeNull();
  });

  it("Oostende: its own channel first, then #brugge, with region West-Vlaanderen, and the national ones", () => {
    store.companionPick.value = { type: "city", place: place("Oostende") };
    render(<Companion />);
    const local = screen.getByRole("list", { name: "Local channels" });
    expect(within(local).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["#oostende", "#brugge"]);
    expect(row("#oostende").textContent).toContain("West-Vlaanderen");
    expect(row("#brugge").textContent).toContain("West-Vlaanderen");
    expect(row("#bemesh").textContent).toContain("Belgium");
    expect(openLink("#oostende").getAttribute("href")).toBe(
      "meshcore://channel/add?name=%23oostende&secret=a10656e857573cb63f14932cfe377368&region_scope=be-vwv",
    );
    expect(openLink("#bemesh").getAttribute("href")).toBe(
      "meshcore://channel/add?name=%23bemesh&secret=4e92675e10b4a5b3df305e86a6f4f8fa&region_scope=be",
    );
    expect(openLink("#bot").getAttribute("href")).toContain("region_scope=be-vwv");
  });

  it("each channel has a QR code that opens large", () => {
    store.companionPick.value = { type: "city", place: place("Oostende") };
    render(<Companion />);
    const thumb = within(row("#oostende")).getByRole("button", { name: /QR code/ });
    expect(thumb.querySelector("svg path")?.getAttribute("d")).toMatch(/^M/);
    fireEvent.click(thumb);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("#oostende");
    expect(dialog.textContent).toContain("a10656e857573cb63f14932cfe377368");
  });

  it("Namur: no local channels yet, and #bot with region Namen", () => {
    store.companionPick.value = { type: "city", place: place("Namur") };
    render(<Companion />);
    expect(screen.queryByRole("list", { name: "Local channels" })).toBeNull();
    expect(screen.getByText(/No local channel for Namen yet/)).toBeTruthy();
    expect(openLink("#bot").getAttribute("href")).toContain("region_scope=be-wna");
  });

  it("All of Belgium: #bot asks for a place first and has no link", () => {
    store.companionPick.value = { type: "country" };
    render(<Companion />);
    expect(within(row("#bot")).queryByRole("link")).toBeNull();
    expect(row("#bot").textContent).toContain("Pick a place first");
  });

  it("All of Belgium is one click", () => {
    render(<Companion />);
    fireEvent.click(screen.getByRole("button", { name: "All of Belgium" }));
    expect(store.companionPick.value).toEqual({ type: "country" });
  });

  it("without regions, the links carry no region_scope", () => {
    store.companionPick.value = { type: "city", place: place("Gent") };
    render(<Companion />);
    fireEvent.click(screen.getByRole("button", { name: "Without region" }));
    expect(openLink("#gent").getAttribute("href")).toMatch(/^meshcore:\/\/channel\/add\?name=%23gent&secret=[0-9a-f]{32}$/);
    expect(openLink("#bot").getAttribute("href")).not.toContain("region_scope");
  });

  it("the four-step guide steps through and back", () => {
    render(<Companion />);
    fireEvent.click(screen.getByRole("button", { name: /View this first/ }));
    const guide = screen.getByRole("region", { name: /Before you add the channels/ });
    expect(within(guide).getByText("1 / 4")).toBeTruthy();
    expect(guide.textContent).not.toContain("companion.");
    for (const n of [2, 3, 4]) {
      fireEvent.click(within(guide).getByRole("button", { name: "Next" }));
      expect(within(guide).getByText(`${n} / 4`)).toBeTruthy();
    }
    expect(within(guide).queryByRole("button", { name: "Next" })).toBeNull();
    expect(guide.textContent).not.toContain("companion.");
    fireEvent.click(within(guide).getByRole("button", { name: "Back" }));
    expect(within(guide).getByText("3 / 4")).toBeTruthy();
  });

  it("links to the wiki channel page and its form for a missing channel", () => {
    render(<Companion />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://meshwiki.radio-actief.be/index.php?title=MeshCore/Kanalen");
    expect(hrefs).toContain("https://forms.gle/HveTc9f5H3fDHJn48");
  });
});

describe("channel purposes", () => {
  const messages = (l: string) => read(resolve(__dirname, `../src/i18n/${l}.json`));
  it.each(["en", "nl", "fr"])("%s has a purpose for every channel", (l) => {
    const m = messages(l);
    for (const c of channels.channels) expect([c.name, !!m[`companion.purpose.${c.name.slice(1)}`]]).toEqual([c.name, true]);
  });

  it("the English purposes are the data file's", () => {
    const m = messages("en");
    for (const c of channels.channels) expect(m[`companion.purpose.${c.name.slice(1)}`]).toBe(c.purpose);
  });
});
