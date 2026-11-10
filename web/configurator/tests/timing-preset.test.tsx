import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newPlan, type DeviceSnapshot } from "../src/core/plan";
import { timingOf } from "../src/core/site";
import { SerialLink } from "../src/device/serial";
import { cancelCount, countNeighbours } from "../src/state/device";
import { resetPlan, store } from "../src/state/store";
import { TimingPreset } from "../src/steps/settings/TimingPreset";
import { FakePort, type FakePortOptions } from "./fakes/fake-port";

const FAST = { interCommandDelayMs: 0, bootDrainMs: 0, disconnectSettleMs: 0, replyTimeoutMs: 40, rawQuietMs: 30 };
/** Rounds in tests: no 20 s wait. */
const QUICK = { roundMs: 0, tickMs: 0 };

const node = (name: string, lat: number, lon: number, type = 2) => ({
  public_key: name,
  type,
  adv_name: name,
  adv_lat: lat,
  adv_lon: lon,
});

/** A `neighbors` line: key prefix, seconds ago, SNR × 4. */
const nb = (prefix: string, snr: number) => `${prefix}:60:${snr * 4}`;
const table = (...lines: string[]) => lines.join("\n");

async function connect(replies: Record<string, string>, opts: FakePortOptions = {}) {
  const port = new FakePort({ "discover.neighbors": "OK - Discover sent", clock: "12:00 - 1/1/2027 UTC", ...replies }, opts);
  const link = new SerialLink(port, FAST);
  await link.open();
  store.device.value = { status: "connected", link, firmware: "v1.17.1" };
  return port;
}

beforeEach(() => {
  resetPlan(newPlan());
  store.snapshot.value = null;
  store.tune.value = { phase: "idle" };
  store.commandBusy.value = false;
  store.device.value = { status: "none", link: null, firmware: null };
  store.data.value = { failed: new Set(), places: [], municipalities: [] };
});
afterEach(cleanup);

const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("Timing", () => {
  it("shows the current timing's band, Suburban on a new plan, and no site chooser", () => {
    render(<TimingPreset />);
    expect(screen.getByText("Suburban")).toBeTruthy();
    for (const n of ["Hilltop", "Foothills", "Local", "Custom"]) expect(screen.queryByRole("button", { name: n })).toBeNull();
  });

  it("shows Custom for a timing that is no band", () => {
    resetPlan({ ...newPlan(), settings: { ...newPlan().settings, txdelay: 1, directTxdelay: 0.5 } });
    render(<TimingPreset />);
    expect(screen.getByText("Custom")).toBeTruthy();
  });

  it("counting needs a repeater on USB, and says to count at its final place", () => {
    render(<TimingPreset />);
    expect(button("Count its neighbours").disabled).toBe(true);
    expect(screen.getByText(/Connect the repeater over USB/)).toBeTruthy();
    expect(screen.getByText(/final place, ideally after a day/)).toBeTruthy();
  });

  it("while counting: the round, the seconds left and Cancel", () => {
    store.tune.value = { phase: "counting", round: 2, rounds: 3, left: 14, total: 20 };
    render(<TimingPreset />);
    expect(screen.getByText("Listening, round 2 of 3: 14 s")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(button("Cancel")).toBeTruthy();
  });

  it("the result names the band; Use this timing puts it in the plan with RX delay 0, nothing is sent", async () => {
    const port = await connect({});
    resetPlan({ ...newPlan(), settings: { ...newPlan().settings, rxdelay: 3 } });
    store.tune.value = { phase: "done", heard: 7, atLeast: false };
    render(<TimingPreset />);
    expect(screen.getByText("Hears 7 repeaters → Foothills timing")).toBeTruthy();
    fireEvent.click(button("Use this timing"));
    expect(timingOf(store.plan.value)).toEqual({ txdelay: 1.5, directTxdelay: 1, rxdelay: 0 });
    expect(button("Use this timing").disabled).toBe(true);
    expect(port.received).toEqual([]);
  });

  it("a cut neighbour table counts as at least", () => {
    store.tune.value = { phase: "done", heard: 8, atLeast: true };
    render(<TimingPreset />);
    expect(screen.getByText("Hears at least 8 repeaters → Foothills timing")).toBeTruthy();
  });

  it("a cut table at Foothills also offers Hilltop, as it may hear more than USB can list", () => {
    store.tune.value = { phase: "done", heard: 8, atLeast: true };
    render(<TimingPreset />);
    fireEvent.click(button("Use Hilltop timing"));
    expect(timingOf(store.plan.value)).toEqual({ txdelay: 2, directTxdelay: 2, rxdelay: 0 });
  });

  it("Use this timing stays on while the band's delays match but RX delay is not 0", () => {
    resetPlan({ ...newPlan(), settings: { ...newPlan().settings, txdelay: 1.5, directTxdelay: 1, rxdelay: 3 } });
    store.tune.value = { phase: "done", heard: 7, atLeast: false };
    render(<TimingPreset />);
    expect(button("Use this timing").disabled).toBe(false);
  });

  it("without a repeater on USB, the timing can be picked by neighbour count", () => {
    render(<TimingPreset />);
    fireEvent.click(button("11+"));
    expect(timingOf(store.plan.value)).toEqual({ txdelay: 2, directTxdelay: 2, rxdelay: 0 });
    expect(button("11+").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("0–2"));
    expect(timingOf(store.plan.value)).toEqual({ txdelay: 0.3, directTxdelay: 0.1, rxdelay: 0 });
  });

  it("with a repeater on USB, the count replaces picking by hand", async () => {
    await connect({});
    render(<TimingPreset />);
    expect(screen.queryByRole("button", { name: "11+" })).toBeNull();
  });

  it("one repeater is singular", () => {
    store.tune.value = { phase: "done", heard: 1, atLeast: false };
    render(<TimingPreset />);
    expect(screen.getByText("Hears 1 repeater → Local timing")).toBeTruthy();
  });

  it("a failed count says why", () => {
    store.tune.value = { phase: "failed", error: "Unknown command" };
    render(<TimingPreset />);
    expect(screen.getByText("Couldn't count: Unknown command")).toBeTruthy();
  });

  it("the button starts counting and Cancel stops it", async () => {
    const port = await connect({ neighbors: table(nb("aaaaaaaa", 5)) });
    render(<TimingPreset />);
    fireEvent.click(button("Count its neighbours"));
    await waitFor(() => expect(store.tune.value.phase).toBe("counting"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(store.tune.value.phase).toBe("idle"));
    await waitFor(() => expect(store.commandBusy.value).toBe(false));
    expect(port.received).not.toContain("neighbors");
  });

  it("counts repeaters within 25 km of the location", () => {
    store.plan.value = { ...store.plan.value, location: { lat: 50.75, lon: 3.6 } };
    store.data.value = {
      failed: new Set(),
      places: [],
      municipalities: [],
      nodes: [node("a", 50.76, 3.6), node("b", 50.74, 3.61), node("c", 50.76, 3.6, 1), node("far", 51.5, 4.5)],
    } as never;
    render(<TimingPreset />);
    expect(screen.getByText("The map shows 2 repeaters within 25 km.")).toBeTruthy();
  });
});

describe("countNeighbours", () => {
  it("sets the clock, then asks the neighbours and reads the table each round, counting those heard above SNR 0", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    try {
      const port = await connect(
        { "time 1800000000": "OK - clock set: 08:00 - 15/1/2027 UTC" },
        {
          sequence: {
            neighbors: [
              table(nb("aaaaaaaa", 5), nb("bbbbbbbb", -2)),
              table(nb("cccccccc", 1), nb("aaaaaaaa", 4), nb("bbbbbbbb", -1)),
              table(nb("dddddddd", 2), nb("cccccccc", 1), nb("aaaaaaaa", 4)),
            ],
          },
        },
      );
      await countNeighbours(QUICK);
      expect(port.received).toEqual([
        "time 1800000000",
        "clock",
        ...Array(3).fill(["discover.neighbors", "neighbors"]).flat(),
      ]);
      expect(store.tune.value).toEqual({ phase: "done", heard: 3, atLeast: false });
      expect(store.clock.value?.reply).toBe("12:00 - 1/1/2027 UTC");
      expect(store.commandBusy.value).toBe(false);
    } finally {
      now.mockRestore();
    }
  });

  it("a first round that hears nobody does not stop the count", async () => {
    const port = await connect({}, { sequence: { neighbors: ["-none-", table(nb("aaaaaaaa", 5)), table(nb("aaaaaaaa", 5))] } });
    await countNeighbours(QUICK);
    expect(port.received.filter((c) => c === "discover.neighbors")).toHaveLength(3);
    expect(store.tune.value).toEqual({ phase: "done", heard: 1, atLeast: false });
  });

  it("stops early when a round adds nobody new", async () => {
    const port = await connect({ neighbors: table(nb("aaaaaaaa", 5), nb("bbbbbbbb", 3)) });
    await countNeighbours(QUICK);
    expect(port.received.filter((c) => c === "discover.neighbors")).toHaveLength(2);
    expect(store.tune.value).toEqual({ phase: "done", heard: 2, atLeast: false });
  });

  it("a table cut at the firmware's limit counts as at least", async () => {
    // The firmware stops once the reply reaches 134 bytes: nine of these 14-byte lines.
    const lines = Array.from({ length: 9 }, (_, i) => nb(`${i}`.padStart(8, "a"), 3));
    expect(table(...lines).length).toBe(134);
    await connect({ neighbors: table(...lines) });
    await countNeighbours(QUICK);
    expect(store.tune.value).toEqual({ phase: "done", heard: 9, atLeast: true });
  });

  it("leaves out repeaters last heard long before the count", async () => {
    await connect({ neighbors: table(nb("aaaaaaaa", 5), "bbbbbbbb:86400:20", "cccccccc:200000:12") });
    await countNeighbours(QUICK);
    expect(store.tune.value).toEqual({ phase: "done", heard: 1, atLeast: false });
  });

  it("stops at once when the repeater is unplugged during the wait", async () => {
    const port = await connect({ neighbors: table(nb("aaaaaaaa", 5)) });
    const run = countNeighbours({ roundMs: 60000, tickMs: 10 });
    await waitFor(() => expect(store.tune.value.phase).toBe("counting"));
    store.device.value = { status: "none", link: null, firmware: null };
    store.tune.value = { phase: "idle" };
    await run;
    expect(store.tune.value).toEqual({ phase: "idle" });
    expect(port.received).toEqual(expect.not.arrayContaining(["neighbors"]));
    expect(store.commandBusy.value).toBe(false);
  });

  it("refreshes the neighbours of the last Read", async () => {
    store.snapshot.value = { settings: {}, missing: [], neighbours: [] } as DeviceSnapshot;
    await connect({ neighbors: table(nb("aaaaaaaa", 5)) });
    await countNeighbours(QUICK);
    expect(store.snapshot.value?.neighbours).toEqual([{ prefix: "aaaaaaaa", agoS: 60, snr: 5 }]);
  });

  it("firmware without discover.neighbors fails with its reply", async () => {
    const port = await connect({ "discover.neighbors": "Unknown command" });
    await countNeighbours(QUICK);
    expect(store.tune.value).toEqual({ phase: "failed", error: "Unknown command" });
    expect(port.received).not.toContain("neighbors");
  });

  it("an unreadable neighbour table fails", async () => {
    await connect({ neighbors: "" });
    await countNeighbours(QUICK);
    expect(store.tune.value.phase).toBe("failed");
  });

  it("does nothing without a device", async () => {
    await countNeighbours(QUICK);
    expect(store.tune.value).toEqual({ phase: "idle" });
  });

  it("cancel during the wait sends nothing more", async () => {
    const port = await connect({ neighbors: table(nb("aaaaaaaa", 5)) });
    const run = countNeighbours({ roundMs: 2000, tickMs: 10 });
    await waitFor(() => expect(store.tune.value.phase).toBe("counting"));
    cancelCount();
    await run;
    expect(store.tune.value).toEqual({ phase: "idle" });
    expect(port.received).toEqual(expect.not.arrayContaining(["neighbors"]));
    expect(store.commandBusy.value).toBe(false);
  });
});
