import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("leaflet", async () => await import("./fakes/leaflet"));

/** Switches for the two cases the real modules can't produce: an empty script and an apply() that throws. */
const force = vi.hoisted(() => ({ emptyScript: false, applyThrows: false, extraLine: "" }));
vi.mock("../src/core/cli", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/cli")>();
  const buildScript = (...a: Parameters<typeof real.buildScript>) => {
    if (force.emptyScript) return [];
    const groups = real.buildScript(...a);
    return force.extraLine ? [...groups, { titleKey: "settings" as const, lines: [force.extraLine] }] : groups;
  };
  return { ...real, buildScript };
});
vi.mock("../src/device/repeater", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/device/repeater")>();
  return {
    ...real,
    apply: (...a: Parameters<typeof real.apply>) =>
      force.applyThrows ? Promise.reject(new Error("boom")) : real.apply(...a),
  };
});

import { buildScript, commandLines } from "../src/core/cli";
import { defaultPlan } from "../src/core/plan";
import { addFreeRegion, regionCountAfterApply, regionsAfterApply } from "../src/core/regions";
import type { Place } from "../src/core/search";
import { SerialLink } from "../src/device/serial";
import { Panel } from "../src/app/Panel";
import { Send } from "../src/steps/Send";
import { connectUsb, disconnectUsb, readDevice } from "../src/state/device";
import { chooseLocation, prefs, resetPlan, store } from "../src/state/store";
import { FakePort } from "./fakes/fake-port";
import { resetFake } from "./fakes/leaflet";
import read from "./fixtures/read-ronse.json";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(__dirname, "../../../data/be-locode.json"), "utf8"));
const MUNIS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/municipalities-3.json"), "utf8"));
const RONSE = PLACES.find((p) => p.city_code === "beron")!;
const FAST = { interCommandDelayMs: 0, bootDrainMs: 0, disconnectSettleMs: 0, replyTimeoutMs: 40 };
const VER = "v1.17.1 (Build: 12-Oct-2026)";

/** What Apply sends: the full script, unchanged defaults included (as the old page). */
const applyLines = () =>
  commandLines(
    buildScript(store.plan.value, PLACES, { includeDefaults: true, device: store.deviceRegions.value }),
  );

/** A console that answers every line Apply sends with OK. */
const okReplies = (lines: string[], ver = VER) => ({
  ver,
  ...Object.fromEntries(lines.map((l) => [l, "OK"])),
});

async function connect(replies: Record<string, string>, opts: { disconnectAfter?: number } = {}, firmware = "v1.17.1") {
  const port = new FakePort(replies, opts);
  const link = new SerialLink(port, FAST);
  await link.open();
  store.device.value = { status: "connected", link, firmware };
  return { port, link };
}

const applyButton = () => screen.getByRole("button", { name: /Apply to repeater/ }) as HTMLButtonElement;
const scriptText = () => document.querySelector(".script")!.textContent!;

/** Connect through connectUsb, so the unplug handling is wired as in the app (its `ver` is the port's first line). */
async function connectApp(replies: Record<string, string>, opts: { disconnectAfter?: number } = {}) {
  const port = new FakePort(replies, opts);
  await connectUsb({ requestPort: async () => port, timing: FAST });
  return port;
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetFake();
  resetPlan(defaultPlan());
  store.snapshot.value = null;
  store.deviceRegions.value = undefined;
  store.notice.value = null;
  store.reading.value = false;
  store.applying.value = false;
  store.commandBusy.value = false;
  force.emptyScript = false;
  force.applyThrows = false;
  force.extraLine = "";
  store.apply.value = { phase: "idle" };
  store.log.value = [];
  store.step.value = "send";
  store.device.value = { status: "none", link: null, firmware: null };
  store.data.value = { failed: new Set(), places: PLACES, municipalities: MUNIS };
  prefs.set("configurator.includeDefaults", "0");
  chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
  store.plan.value = { ...store.plan.value, nameSuffix: "Kluisberg" };
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Send step: script", () => {
  it("starts with # group headers and its command lines are commandLines(...)", () => {
    render(<Send />);
    const text = scriptText();
    expect(text.startsWith("# ")).toBe(true);
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(lines).toEqual(commandLines(buildScript(store.plan.value, PLACES, { includeDefaults: false })));
    expect(text).toContain("# Name\nset name BE-RON-Kluisberg");
  });

  it("Include unchanged defaults adds the default values and is remembered", () => {
    render(<Send />);
    const without = scriptText();
    fireEvent.click(screen.getByLabelText("Include unchanged defaults"));
    const lines = scriptText()
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"));
    expect(lines).toEqual(commandLines(buildScript(store.plan.value, PLACES, { includeDefaults: true })));
    expect(lines.length).toBeGreaterThan(without.split("\n").filter((l) => l && !l.startsWith("#")).length);
    expect(prefs.get("configurator.includeDefaults")).toBe("1");
  });

  it("uses the device regions from the last Read for the removals", () => {
    store.deviceRegions.value = { named: ["bemak"], home: null, default: null };
    render(<Send />);
    expect(scriptText()).toContain("region remove bemak");
  });

  it("Copy script and Download work without a device, Apply lists why it can't run", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<Send />);
    expect(applyButton().disabled).toBe(true);
    expect(screen.getByText("Connect a repeater first.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy script" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(scriptText()));

    fireEvent.click(screen.getByRole("button", { name: "Download .txt" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe("bemesh-repeater-commands.txt");
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:x"));
    click.mockRestore();
  });

  it("offers Connect over USB when no repeater is connected, and keeps the plan", async () => {
    const port = new FakePort({ ver: VER });
    const requestPort = vi.fn(async () => port);
    Object.defineProperty(navigator, "serial", { value: { requestPort }, configurable: true });
    try {
      render(<Send />);
      fireEvent.click(screen.getByRole("button", { name: "Connect over USB" }));
      await waitFor(() => expect(store.device.value.status).toBe("connected"), { timeout: 3000 });
      expect(requestPort).toHaveBeenCalledTimes(1);
      expect(store.step.value).toBe("send");
      expect(store.plan.value.nameSuffix).toBe("Kluisberg");
      expect(screen.queryByRole("button", { name: "Connect over USB" })).toBeNull();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).serial;
      await disconnectUsb();
    }
  });

  it("a failed copy shows a notice", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<Send />);
    fireEvent.click(screen.getByRole("button", { name: "Copy script" }));
    expect(await screen.findByText(/Couldn't copy/)).toBeTruthy();
  });

  it("lists the changes grouped, with the admin password line", () => {
    render(<Send />);
    expect(screen.getByText("Name & location")).toBeTruthy();
    expect(screen.getByText("BE-RON-Kluisberg", { selector: ".rv-to" })).toBeTruthy();
    expect(screen.getByText(/Admin password stays as it is/)).toBeTruthy();
  });
});

describe("Send step: Apply", () => {
  it("firmware v1.15.0 never writes, shows the blocking notice and keeps Apply disabled", async () => {
    // Connected as 1.17.1, but the board was swapped: Apply re-reads `ver`.
    const { port } = await connect(okReplies(applyLines(), "v1.15.0 (Build: 01-Jan-2026)"));
    render(<Send />);
    expect(applyButton().disabled).toBe(false);
    fireEvent.click(applyButton());
    expect(await screen.findByText(/runs MeshCore v1.15.0/, { selector: ".notice" })).toBeTruthy();
    expect(port.received).toEqual(["ver"]);
    expect(applyButton().disabled).toBe(true);
    expect(screen.getByText("Regions need firmware 1.16 or newer.")).toBeTruthy();
  });

  it("a successful Apply shows progress reaching M/M, then the reboot dialog", async () => {
    const lines = applyLines();
    const { port } = await connect(okReplies(lines));
    render(<Send />);
    fireEvent.click(applyButton());
    expect(await screen.findByRole("button", { name: "Reboot now" })).toBeTruthy();
    const m = lines.length;
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(String(m));
    expect(screen.getByText(new RegExp(`${m} / ${m}`))).toBeTruthy();
    expect(port.received).toEqual(["ver", ...lines]);

    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("button", { name: "Reboot now" })).toBeNull();
    expect(port.received).not.toContain("reboot");
  });

  it("Reboot now sends reboot and the expected disconnect shows no error", async () => {
    const { port } = await connect(okReplies(applyLines()));
    render(<Send />);
    fireEvent.click(applyButton());
    fireEvent.click(await screen.findByRole("button", { name: "Reboot now" }));
    // The lock holds while `reboot` is in flight and the link settles.
    expect(store.commandBusy.value).toBe(true);
    await waitFor(() => expect(store.device.value.status).toBe("none"));
    expect(store.commandBusy.value).toBe(false);
    expect(port.received.at(-1)).toBe("reboot");
    expect(store.notice.value?.kind).not.toBe("error");
  });

  it("a disconnect at command 3 stops there and offers the remaining commands, the failed one first", async () => {
    const device = { named: ["bemak"], home: null, default: null };
    store.deviceRegions.value = device;
    const lines = applyLines();
    // `ver` is the first line the port receives, so command 3 of Apply is its 4th.
    await connect(okReplies(lines), { disconnectAfter: 4 });
    render(<Send />);
    fireEvent.click(applyButton());
    expect(
      await screen.findByText(`Stopped at command 3 of ${lines.length}: ${lines[2]}`, { selector: ".notice p" }),
    ).toBeTruthy();
    expect(screen.getByText(/Read the repeater again before applying again/)).toBeTruthy();
    expect(store.deviceRegions.value).toBe(device);
    fireEvent.click(screen.getByRole("button", { name: "Copy remaining commands" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(lines.slice(2).join("\n")));
  });

  it("an unplug during Apply stops it and shows the unplug notice", async () => {
    const lines = applyLines();
    // connect's `ver`, Apply's `ver`, then commands 1-3.
    await connectApp(okReplies(lines), { disconnectAfter: 5 });
    render(<Send />);
    fireEvent.click(applyButton());
    expect(await screen.findByText(`Stopped at command 3 of ${lines.length}: ${lines[2]}`, { selector: ".notice p" })).toBeTruthy();
    expect(store.notice.value).toEqual({ kind: "error", text: expect.stringMatching(/repeater was disconnected/) });
    expect(store.device.value.status).toBe("none");
  });

  it("an unplug during the firmware check goes back to idle without asking", async () => {
    await connect(okReplies(applyLines()), { disconnectAfter: 1 });
    render(<Send />);
    fireEvent.click(applyButton());
    await waitFor(() => expect(store.applying.value).toBe(false));
    expect(store.apply.value).toEqual({ phase: "idle" });
    expect(screen.queryByRole("dialog", { name: "Firmware version unreadable" })).toBeNull();
  });

  it("a line over 151 bytes blocks Apply before anything is sent", async () => {
    // 85 characters, 155 bytes
    force.extraLine = `set owner.info ${"é".repeat(70)}`;
    const { port } = await connect(okReplies(applyLines()));
    render(<Send />);
    fireEvent.click(applyButton());
    expect(await screen.findByText(/longer than the 151 bytes/)).toBeTruthy();
    expect(screen.getByText(force.extraLine, { selector: "code" })).toBeTruthy();
    expect(port.received).toEqual([]);
  });

  it("shows a control character in the script as a visible symbol", () => {
    force.extraLine = "set name x\rerase";
    render(<Send />);
    expect(scriptText()).toContain("set name x␍erase");
    expect(scriptText()).not.toContain("\r");
  });

  it("an empty script is not applied", async () => {
    const { port } = await connect({ ver: VER });
    force.emptyScript = true;
    render(<Send />);
    fireEvent.click(applyButton());
    expect(await screen.findByText("No commands to apply.")).toBeTruthy();
    expect(port.received).toEqual([]);
  });

  it("an unexpected error ends Apply with a notice and releases the lock", async () => {
    await connect(okReplies(applyLines()));
    force.applyThrows = true;
    render(<Send />);
    fireEvent.click(applyButton());
    expect(await screen.findByText("Apply failed: boom", { selector: ".notice" })).toBeTruthy();
    expect(store.applying.value).toBe(false);
  });

  it("blocks Apply and says how many regions the plan needs over the repeater's 32", async () => {
    await connect({});
    let regions = store.plan.value.regions!;
    const anchor = store.plan.value.anchor!;
    for (let i = 0; regionCountAfterApply(anchor, regions, PLACES) < 33; i++) regions = addFreeRegion(regions, `zone${i}`, null, anchor);
    store.plan.value = { ...store.plan.value, regions };
    render(<Send />);
    expect(applyButton().disabled).toBe(true);
    expect(screen.getByText("The repeater holds at most 32 regions; this plan needs 33.")).toBeTruthy();
  });

  it("needs a location", () => {
    store.plan.value = { ...store.plan.value, anchor: null, regions: null };
    render(<Send />);
    expect(applyButton().disabled).toBe(true);
    expect(screen.getByText("Choose a location first: the region commands need one.")).toBeTruthy();
  });

  it("a changed plan or coming back to Send clears the last outcome", () => {
    store.apply.value = { phase: "old", version: "v1.15.0" };
    store.plan.value = { ...store.plan.value, nameSuffix: "Other" };
    expect(store.apply.value).toEqual({ phase: "idle" });
    store.apply.value = { phase: "empty" };
    store.step.value = "advanced";
    expect(store.apply.value).toEqual({ phase: "empty" });
    store.step.value = "send";
    expect(store.apply.value).toEqual({ phase: "idle" });
  });

  it("unreadable firmware asks first; Continue anyway applies", async () => {
    const lines = applyLines();
    const { port } = await connect(okReplies(lines, "MeshCore"));
    render(<Send />);
    fireEvent.click(applyButton());
    expect(await screen.findByRole("dialog", { name: "Firmware version unreadable" })).toBeTruthy();
    expect(port.received).toEqual(["ver"]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Firmware version unreadable" })).toBeNull();

    fireEvent.click(applyButton());
    fireEvent.click(await screen.findByRole("button", { name: "Continue anyway" }));
    expect(await screen.findByRole("button", { name: "Reboot now" })).toBeTruthy();
    expect(port.received).toEqual(["ver", "ver", ...lines]);
  });

  it("after a successful Apply the device regions are what was sent, so nothing is removed twice", async () => {
    store.deviceRegions.value = { named: ["bemak"], home: null, default: null };
    const lines = applyLines();
    expect(lines).toContain("region remove bemak");
    await connect(okReplies(lines));
    render(<Send />);
    fireEvent.click(applyButton());
    await screen.findByRole("button", { name: "Reboot now" });
    const plan = store.plan.value;
    expect(store.deviceRegions.value).toEqual(regionsAfterApply(plan.anchor!, plan.regions!, PLACES));
    expect(applyLines().some((l) => l.startsWith("region remove"))).toBe(false);
  });

  it("locks step navigation while sending", async () => {
    const lines = applyLines();
    await connect(okReplies(lines));
    render(<Panel />);
    fireEvent.click(applyButton());
    await waitFor(() => expect(store.applying.value).toBe(true));
    expect((screen.getByRole("button", { name: /Back/ }) as HTMLButtonElement).disabled).toBe(true);
    for (const seg of document.querySelectorAll<HTMLButtonElement>(".seg")) expect(seg.disabled).toBe(true);
    await screen.findByRole("button", { name: "Reboot now" });
    expect(store.applying.value).toBe(false);
  });
});

describe("Console", () => {
  it("logs Apply traffic and console commands, with history", async () => {
    const lines = applyLines();
    await connect({ ...okReplies(lines), "get name": "BE-RON-Kluisberg" });
    render(<Send />);
    fireEvent.click(applyButton());
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    fireEvent.click(screen.getByRole("button", { name: /Console/ }));
    const log = () => document.querySelector(".console-log")!.textContent!;
    expect(log()).toContain(`> ${lines[0]}`);

    const input = screen.getByLabelText("Console command") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "get name" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(log()).toContain("-> BE-RON-Kluisberg"));
    expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("get name");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("");
  });

  it("does not keep a typed set prv.key in the history", async () => {
    await connect({ ver: VER, "get name": "X" });
    render(<Send />);
    fireEvent.click(screen.getByRole("button", { name: /Console/ }));
    const input = screen.getByLabelText("Console command") as HTMLInputElement;
    for (const cmd of ["get name", `set prv.key ${"ab".repeat(64)}`]) {
      fireEvent.input(input, { target: { value: cmd } });
      fireEvent.submit(input.closest("form")!);
      await waitFor(() => expect(store.commandBusy.value).toBe(false));
    }
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("get name");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).not.toContain("abab");
  });

  it("the input is disabled without a device, and Show command log is remembered", () => {
    render(<Send />);
    fireEvent.click(screen.getByRole("button", { name: /Console/ }));
    expect((screen.getByLabelText("Console command") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Show command log"));
    expect(prefs.get("configurator.serialShowCommandLog")).toBe("1");
  });

  it("logs Read traffic only when Show command log is on", async () => {
    await connect(read);
    prefs.set("configurator.serialShowCommandLog", "0");
    await readDevice();
    expect(store.log.value.some((l) => l.text === "> get name")).toBe(false);
    prefs.set("configurator.serialShowCommandLog", "1");
    await readDevice();
    expect(store.log.value.some((l) => l.text === "> get name")).toBe(true);
  });

  it("a console `reboot` is an expected disconnect: no unplug notice", async () => {
    await connectApp({ ver: VER });
    render(<Send />);
    fireEvent.click(screen.getByRole("button", { name: /Console/ }));
    const input = screen.getByLabelText("Console command") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "reboot" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(store.device.value.status).toBe("none"));
    expect(store.notice.value).toBeNull();
  });

  it("keeps the last 50 commands in the history and offers the old suggestions", async () => {
    await connect({ ver: VER });
    render(<Send />);
    fireEvent.click(screen.getByRole("button", { name: /Console/ }));
    const input = screen.getByLabelText("Console command") as HTMLInputElement;
    expect(input.getAttribute("list")).toBe("console-commands");
    expect(document.querySelectorAll("#console-commands option").length).toBe(131);
    for (let i = 0; i < 55; i++) {
      fireEvent.input(input, { target: { value: `c${i}` } });
      fireEvent.submit(input.closest("form")!);
      await waitFor(() => expect(store.commandBusy.value).toBe(false));
    }
    for (let i = 0; i < 60; i++) fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("c5");
  });

  it("bounds the log at 500 lines and marks each Apply with a separator", async () => {
    store.log.value = Array.from({ length: 600 }, (_, i) => ({ text: `old ${i}`, kind: "muted" as const }));
    const lines = applyLines();
    await connect(okReplies(lines));
    render(<Send />);
    fireEvent.click(applyButton());
    await screen.findByRole("button", { name: "Reboot now" });
    const log = store.log.value;
    expect(log.length).toBe(500);
    expect(log.some((l) => l.kind === "sep")).toBe(true);
    expect(log.at(-1)?.text).toBe("Apply complete.");
  });
});

describe("Send step: Before you send", () => {
  const admin = () => screen.getByLabelText("Admin password") as HTMLInputElement;
  const eye = () => screen.getByRole("button", { name: "Hold to show the password" });

  it("shows the admin password only while the eye is held (pointer)", () => {
    render(<Send />);
    expect(admin().type).toBe("password");
    fireEvent.pointerDown(eye());
    expect(admin().type).toBe("text");
    expect(eye().getAttribute("aria-pressed")).toBe("true");
    fireEvent.pointerUp(eye());
    expect(admin().type).toBe("password");
    fireEvent.pointerDown(eye());
    fireEvent.pointerLeave(eye());
    expect(admin().type).toBe("password");
    fireEvent.pointerDown(eye());
    fireEvent.pointerCancel(eye());
    expect(admin().type).toBe("password");
    fireEvent.pointerDown(eye());
    fireEvent.blur(eye());
    expect(admin().type).toBe("password");
  });

  it("holds with Space or Enter and never toggles on click", () => {
    render(<Send />);
    fireEvent.keyDown(eye(), { key: " " });
    expect(admin().type).toBe("text");
    fireEvent.keyUp(eye(), { key: " " });
    expect(admin().type).toBe("password");
    fireEvent.keyDown(eye(), { key: "Enter" });
    expect(admin().type).toBe("text");
    fireEvent.keyUp(eye(), { key: "Enter" });
    fireEvent.click(eye());
    expect(admin().type).toBe("password");
  });

  it("puts the typed passwords in the plan and keeps them off Advanced", () => {
    render(<Send />);
    fireEvent.input(admin(), { target: { value: "secret" } });
    fireEvent.input(screen.getByLabelText("Guest password"), { target: { value: "hello" } });
    expect(store.plan.value.settings.adminPassword).toBe("secret");
    expect(store.plan.value.settings.guestPassword).toBe("hello");
    expect(screen.getByPlaceholderText("Leave empty to keep the current one")).toBeTruthy();
  });

  it("lists the radio, duty cycle and TX power read-only, each linking to Advanced", () => {
    store.plan.value = { ...store.plan.value, settings: { ...store.plan.value.settings, txPower: 14 } };
    render(<Send />);
    expect(screen.getByText(/^Radio: /)).toBeTruthy();
    expect(screen.getByText(/^Duty cycle: /)).toBeTruthy();
    expect(screen.getByText("TX power: 14")).toBeTruthy();
    const links = screen.getAllByRole("button", { name: "Change in Advanced" });
    expect(links.length).toBe(3);
    fireEvent.click(links[0]);
    expect(store.step.value).toBe("advanced");
  });

  it("never tags the admin password with the repeater's value", () => {
    store.snapshot.value = { settings: { adminPassword: "old" }, missing: [] };
    render(<Send />);
    fireEvent.input(admin(), { target: { value: "secret" } });
    expect(within(admin().closest(".field") as HTMLElement).queryByText("On repeater:")).toBeNull();
  });

  it("says TX power is unchanged when none is set", () => {
    render(<Send />);
    expect(screen.getByText("TX power: unchanged")).toBeTruthy();
  });
});
