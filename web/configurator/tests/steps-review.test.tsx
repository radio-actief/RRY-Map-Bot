import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("leaflet", async () => await import("./fakes/leaflet"));

import { buildScript, commandLines } from "../src/core/cli";
import { defaultPlan } from "../src/core/plan";
import { regionsAfterApply } from "../src/core/regions";
import type { Place } from "../src/core/search";
import { SerialLink } from "../src/device/serial";
import { Panel } from "../src/app/Panel";
import { Review } from "../src/steps/Review";
import { readDevice } from "../src/state/device";
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

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetFake();
  resetPlan(defaultPlan());
  store.snapshot.value = null;
  store.deviceRegions.value = undefined;
  store.notice.value = null;
  store.reading.value = false;
  store.applying.value = false;
  store.apply.value = { phase: "idle" };
  store.log.value = [];
  store.step.value = 5;
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

describe("Review step: script", () => {
  it("starts with # group headers and its command lines are commandLines(...)", () => {
    render(<Review />);
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
    render(<Review />);
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
    render(<Review />);
    expect(scriptText()).toContain("region remove bemak");
  });

  it("Copy script and Download work without a device, Apply lists why it can't run", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<Review />);
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

  it("a failed copy shows a notice", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<Review />);
    fireEvent.click(screen.getByRole("button", { name: "Copy script" }));
    expect(await screen.findByText(/Couldn't copy/)).toBeTruthy();
  });

  it("lists the changes grouped, with the admin password line", () => {
    render(<Review />);
    expect(screen.getByText("Name & location")).toBeTruthy();
    expect(screen.getByText("BE-RON-Kluisberg", { selector: ".rv-to" })).toBeTruthy();
    expect(screen.getByText(/Admin password stays as it is/)).toBeTruthy();
  });
});

describe("Review step: Apply", () => {
  it("firmware v1.15.0 never writes, shows the blocking notice and keeps Apply disabled", async () => {
    // Connected as 1.17.1, but the board was swapped: Apply re-reads `ver`.
    const { port } = await connect(okReplies(applyLines(), "v1.15.0 (Build: 01-Jan-2026)"));
    render(<Review />);
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
    render(<Review />);
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
    render(<Review />);
    fireEvent.click(applyButton());
    fireEvent.click(await screen.findByRole("button", { name: "Reboot now" }));
    await waitFor(() => expect(store.device.value.status).toBe("none"));
    expect(port.received.at(-1)).toBe("reboot");
    expect(store.notice.value?.kind).not.toBe("error");
  });

  it("a disconnect at command 3 stops there and offers the remaining commands", async () => {
    const lines = applyLines();
    // `ver` is the first line the port receives, so command 3 of Apply is its 4th.
    await connect(okReplies(lines), { disconnectAfter: 4 });
    render(<Review />);
    fireEvent.click(applyButton());
    expect(
      await screen.findByText(`Stopped at command 3 of ${lines.length}: ${lines[2]}`, { selector: ".notice p" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy remaining commands" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(lines.slice(3).join("\n")));
  });

  it("unreadable firmware asks first; Continue anyway applies", async () => {
    const lines = applyLines();
    const { port } = await connect(okReplies(lines, "MeshCore"));
    render(<Review />);
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
    render(<Review />);
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
    render(<Review />);
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

  it("the input is disabled without a device, and Show command log is remembered", () => {
    render(<Review />);
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
});
