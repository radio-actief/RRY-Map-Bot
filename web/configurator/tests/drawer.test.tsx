import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
/** The vanity search's give-up limit, lowered by the test that hits it. */
const cap = vi.hoisted(() => ({ max: 5_000_000 }));
vi.mock("../src/core/vanity", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/vanity")>();
  return {
    ...real,
    get VANITY_MAX_ATTEMPTS() {
      return cap.max;
    },
  };
});

import { DeviceDrawer, clockOffset } from "../src/app/DeviceDrawer";
import { Connect } from "../src/steps/Connect";
import { importBackup } from "../src/core/backup";
import { defaultPlan } from "../src/core/plan";
import type { Place } from "../src/core/search";
import { isErrorReply, SerialLink } from "../src/device/serial";
import { t } from "../src/i18n/t";
import { connectUsb, deviceCommand } from "../src/state/device";
import { dirty, placeChosen, placeLeft, resetPlan, store } from "../src/state/store";
import { FakePort } from "./fakes/fake-port";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(__dirname, "../../../data/be-locode.json"), "utf8"));
const FAST = { interCommandDelayMs: 0, bootDrainMs: 0, disconnectSettleMs: 0, replyTimeoutMs: 40 };
const VER = "v1.17.1 (Build: 12-Oct-2026)";
const PUB = "3f5a9c0e1b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a";
const SECRET = "ab".repeat(64);

// MeshCore's own ed25519_create_keypair reference vector (as in vanity.test.ts).
const SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const MESHCORE_PRV =
  "3894eea49c580aef816935762be049559d6d1440dede12e6a125f1841fff8e6f" +
  "a9d71862a3e5746b571be3d187b0041046f52ebd850c7cbd5fde8ee38473b649";
const MESHCORE_PUB = "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8";
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** Connect through connectUsb, so the unplug handling is wired as in the app (its first line is `ver`). */
async function connectApp(replies: Record<string, string>) {
  const port = new FakePort({ ver: VER, ...replies });
  await connectUsb({ requestPort: async () => port, timing: FAST });
  return port;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

/** Write to device asks first: tick that the old key is backed up (or not needed), then replace. */
function confirmReplace() {
  fireEvent.click(button("Write to device"));
  fireEvent.click(screen.getByRole("checkbox", { name: t("identity.backedUp") }));
  fireEvent.click(button("Replace identity"));
}
const logText = () => store.log.value.map((l) => l.text).join("\n");
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetPlan(defaultPlan());
  store.snapshot.value = null;
  store.clock.value = null;
  store.notice.value = null;
  store.reading.value = false;
  store.applying.value = false;
  store.commandBusy.value = false;
  store.log.value = [];
  store.device.value = { status: "none", link: null, firmware: null };
  store.data.value = { failed: new Set(), places: PLACES };
  store.drawerOpen.value = true;
  cap.max = 5_000_000;
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  store.drawerOpen.value = false;
});

describe("Device tools drawer: without a device", () => {
  it("disables Reboot and the device actions but keeps Export and Import", () => {
    render(<DeviceDrawer />);
    expect(button("Reboot").disabled).toBe(true);
    expect(button("Start OTA").disabled).toBe(true);
    expect(button("Factory reset…").disabled).toBe(true);
    expect(button("Flood advert").disabled).toBe(true);
    expect(button("Generate vanity key…").disabled).toBe(true);
    expect(button("Generate random key…").disabled).toBe(true);
    expect(button("Export JSON").disabled).toBe(false);
    expect(button("Import JSON").disabled).toBe(false);
  });

  it("renders nothing while closed", () => {
    store.drawerOpen.value = false;
    const { container } = render(<DeviceDrawer />);
    expect(container.querySelector(".drawer")).toBeNull();
  });

  it("ignores Escape pressed inside another dialog", () => {
    render(<DeviceDrawer />);
    const other = document.createElement("dialog");
    const inside = document.createElement("button");
    other.appendChild(inside);
    document.body.appendChild(other);
    fireEvent.keyDown(inside, { key: "Escape" });
    expect(store.drawerOpen.value).toBe(true);
    other.remove();
  });

  it("closes on Escape and on a backdrop click, and takes focus when opened", () => {
    const { container } = render(<DeviceDrawer />);
    expect(container.querySelector(".drawer")!.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(store.drawerOpen.value).toBe(false);
    store.drawerOpen.value = true;
    cleanup();
    const again = render(<DeviceDrawer />);
    fireEvent.click(again.container.querySelector(".drawer-backdrop")!);
    expect(store.drawerOpen.value).toBe(false);
  });
});

describe("Device tools drawer: backup", () => {
  it("Export downloads the plan as bemesh-repeater-config.json", async () => {
    // jsdom has no object URLs.
    const created = vi.fn((_blob: Blob) => "blob:x");
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    let name = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    render(<DeviceDrawer />);
    fireEvent.click(button("Export JSON"));
    expect(click).toHaveBeenCalled();
    expect(name).toBe("bemesh-repeater-config.json");
    const blob = created.mock.calls[0][0];
    const json = JSON.parse(await blob.text());
    expect(json).toMatchObject({ app: "bemesh-configurator", version: 2, plan: defaultPlan() });
  });

  it("Import of a v1 parity backup sets the plan and closes the drawer", async () => {
    const text = readFileSync(resolve(__dirname, "fixtures/parity/ronse-solar.backup.json"), "utf8");
    const { container } = render(<DeviceDrawer />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([text], "backup.json")], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(store.drawerOpen.value).toBe(false));
    expect(store.plan.value).toEqual(importBackup(JSON.parse(text), PLACES));
    expect(store.plan.value.nameSuffix).toBe("Kluisberg");
    expect(dirty.value).toBe(true);
    expect(store.notice.value).toEqual({ kind: "ok", text: t("tools.imported") });
  });

  it("an import sets the start plan and leaves the plan base", async () => {
    const base = store.planBase.value;
    const text = readFileSync(resolve(__dirname, "fixtures/parity/ronse-solar.backup.json"), "utf8");
    const { container } = render(<DeviceDrawer />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([text], "backup.json")], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(store.drawerOpen.value).toBe(false));
    expect(store.startPlan.value).toBe(store.plan.value);
    expect(store.planBase.value).toBe(base);
  });

  it("an import resets the Place latches like a Read does", async () => {
    const importFile = async (name: string) => {
      placeLeft.value = true;
      placeChosen.value = true;
      store.drawerOpen.value = true;
      const text = readFileSync(resolve(__dirname, `fixtures/parity/${name}.backup.json`), "utf8");
      const { container, unmount } = render(<DeviceDrawer />);
      const input = container.querySelector("input[type=file]") as HTMLInputElement;
      Object.defineProperty(input, "files", { value: [new File([text], "backup.json")], configurable: true });
      fireEvent.change(input);
      await waitFor(() => expect(store.drawerOpen.value).toBe(false));
      unmount();
    };
    await importFile("no-location");
    expect(store.plan.value.location).toBeNull();
    expect([placeLeft.value, placeChosen.value]).toEqual([false, false]);
    await importFile("ronse-solar");
    expect(store.plan.value.location).not.toBeNull();
    expect([placeLeft.value, placeChosen.value]).toEqual([false, true]);
  });

  it("a file that is not a backup shows the BackupError message and keeps the plan", async () => {
    const before = store.plan.value;
    const { container } = render(<DeviceDrawer />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(['{"app":"other"}'], "x.json")], configurable: true });
    fireEvent.change(input);
    await screen.findByText(t("backup.error.unknown"));
    expect(store.plan.value).toBe(before);
    expect(store.drawerOpen.value).toBe(true);
  });
});

describe("Device tools drawer: maintenance and danger zone", () => {
  it("Reboot asks first, then sends reboot without an unplug notice", async () => {
    const port = await connectApp({});
    render(<DeviceDrawer />);
    fireEvent.click(button("Reboot"));
    expect(port.received).not.toContain("reboot");
    fireEvent.click(button("Reboot now"));
    await waitFor(() => expect(store.device.value.status).toBe("none"));
    expect(port.received.at(-1)).toBe("reboot");
    expect(store.notice.value).toEqual({ kind: "ok", text: t("apply.rebootSent") });
    expect(store.drawerOpen.value).toBe(false);
  });

  it("Start OTA asks first, then sends start ota and says to reconnect", async () => {
    const port = await connectApp({});
    render(<DeviceDrawer />);
    fireEvent.click(button("Start OTA"));
    fireEvent.click(button("Start OTA now"));
    await waitFor(() => expect(store.device.value.status).toBe("none"));
    expect(port.received.at(-1)).toBe("start ota");
    expect(store.notice.value).toEqual({ kind: "ok", text: t("tools.otaSent") });
  });

  it("Factory reset stays disabled until RESET is typed, then sends erase", async () => {
    const port = await connectApp({});
    render(<DeviceDrawer />);
    fireEvent.click(button("Factory reset…"));
    const input = screen.getByLabelText(/Type RESET/) as HTMLInputElement;
    const confirm = () => button("Erase the device");
    expect(confirm().disabled).toBe(true);
    fireEvent.input(input, { target: { value: "reset" } });
    expect(confirm().disabled).toBe(true);
    fireEvent.input(input, { target: { value: "RESET " } });
    expect(confirm().disabled).toBe(true);
    fireEvent.input(input, { target: { value: "RESET" } });
    expect(confirm().disabled).toBe(false);
    fireEvent.click(confirm());
    await waitFor(() => expect(store.device.value.status).toBe("none"));
    expect(port.received.at(-1)).toBe("erase");
    expect(store.notice.value).toEqual({ kind: "ok", text: t("tools.resetSent") });
  });
});

describe("Device tools drawer: confirmations", () => {
  it("Enter in a destructive confirmation does not confirm", async () => {
    const port = await connectApp({});
    render(<DeviceDrawer />);
    fireEvent.click(button("Reboot"));
    expect(document.activeElement).not.toBe(button("Reboot now"));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
    fireEvent.click(button("Cancel"));
    fireEvent.click(button("Factory reset…"));
    const input = screen.getByLabelText(/Type RESET/) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "RESET" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyPress(input, { key: "Enter", charCode: 13 });
    await new Promise((r) => setTimeout(r, 20));
    expect(port.received).not.toContain("reboot");
    expect(port.received).not.toContain("erase");
    expect(store.device.value.status).toBe("connected");
  });

  it.each([
    ["Reboot", "Reboot now", "reboot"],
    ["Factory reset…", "Erase the device", "erase"],
  ])("a double click on %s sends the command once", async (open, confirm, cmd) => {
    const port = await connectApp({});
    render(<DeviceDrawer />);
    fireEvent.click(button(open));
    if (cmd === "erase") fireEvent.input(screen.getByLabelText(/Type RESET/), { target: { value: "RESET" } });
    const go = button(confirm);
    fireEvent.click(go);
    fireEvent.click(go);
    await waitFor(() => expect(store.device.value.status).toBe("none"));
    expect(port.received.filter((l) => l === cmd)).toHaveLength(1);
  });

  it("a double click on an advert or on Replace identity sends it once", async () => {
    vi.spyOn(nacl, "randomBytes").mockImplementation(() => fromHex(SEED));
    const port = await connectApp({ advert: "OK", [`set prv.key ${MESHCORE_PRV}`]: `OK, reboot to apply! New pubkey: ${MESHCORE_PUB}` });
    render(<DeviceDrawer />);
    const flood = button("Flood advert");
    fireEvent.click(flood);
    fireEvent.click(flood);
    await screen.findByText(t("tools.advertSent"));
    expect(port.received.filter((l) => l === "advert")).toHaveLength(1);
    fireEvent.click(button("Generate vanity key…"));
    fireEvent.input(screen.getByLabelText("Public key prefix"), { target: { value: "03" } });
    fireEvent.click(button("Generate"));
    await screen.findByText(MESHCORE_PUB);
    fireEvent.click(button("Write to device"));
    fireEvent.click(screen.getByRole("checkbox", { name: t("identity.backedUp") }));
    const replace = button("Replace identity");
    fireEvent.click(replace);
    fireEvent.click(replace);
    await screen.findByText(t("vanity.written", { key: MESHCORE_PUB }));
    expect(port.received.filter((l) => l.startsWith("set prv.key"))).toHaveLength(1);
  });
});

describe("Device tools drawer: device info", () => {
  it("shows how far the device clock is from this computer", () => {
    const at = Date.UTC(2026, 9, 24, 14, 7, 30);
    expect(clockOffset("14:05 - 24/10/2026 UTC", at)).toBe("2 min behind");
    expect(clockOffset("14:07 - 24/10/2026 UTC", at)).toBe("in sync");
    expect(clockOffset("17:07 - 24/10/2026 UTC", at)).toBe("3 h ahead");
    expect(clockOffset("00:00 - 1/1/2024 UTC", at)).toBe("1027 days behind");
    expect(clockOffset("garbage", at)).toBeNull();
  });

  it("Sync sends the old time command, then re-reads the clock", async () => {
    const now = Date.UTC(2026, 9, 24, 14, 7, 30);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const port = await connectApp({ [`time ${now / 1000}`]: "OK - clock set", clock: "14:07 - 24/10/2026 UTC" });
    render(<DeviceDrawer />);
    fireEvent.click(button("Sync"));
    await screen.findByText(t("tools.synced"));
    expect(port.received.slice(-2)).toEqual([`time ${now / 1000}`, "clock"]);
    expect(screen.getByText("in sync")).toBeTruthy();
  });

  it("the firmware's 'clock cannot go backwards' reply is an error", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    await connectApp({ "time 1800000000": "(ERR: clock cannot go backwards)" });
    expect(isErrorReply("(ERR: clock cannot go backwards)")).toBe(true);
    render(<DeviceDrawer />);
    fireEvent.click(button("Sync"));
    await screen.findByText(t("tools.syncFailed", { reason: "(ERR: clock cannot go backwards)" }));
  });

  it("sends the zero-hop and flood adverts", async () => {
    const port = await connectApp({ "advert.zerohop": "OK - zerohop advert sent", advert: "OK - Advert sent" });
    store.snapshot.value = { settings: {}, missing: [], publicKey: PUB };
    render(<DeviceDrawer />);
    fireEvent.click(button("Zero-hop advert"));
    await screen.findByText(t("tools.advertSent"));
    fireEvent.click(button("Flood advert"));
    await waitFor(() => expect(port.received.at(-1)).toBe("advert"));
    await waitFor(() => expect(store.commandBusy.value).toBe(false));
    expect(port.received).toContain("advert.zerohop");
  });

  it("device actions are disabled while another command holds the lock", async () => {
    await connectApp({});
    store.commandBusy.value = true;
    render(<DeviceDrawer />);
    expect(button("Sync").disabled).toBe(true);
    expect(button("Reboot").disabled).toBe(true);
    expect(button("Export JSON").disabled).toBe(false);
  });
});

describe("Device tools drawer: identity", () => {
  const identity = () => screen.getByRole("heading", { name: "Identity" }).closest("section") as HTMLElement;

  it("shows the public key in full with its Copy, next to the private key", async () => {
    await connectApp({});
    store.snapshot.value = { settings: {}, missing: [], publicKey: PUB };
    render(<DeviceDrawer />);
    expect(within(identity()).getByText(PUB)).toBeTruthy();
    expect(within(identity()).getByText("Private key")).toBeTruthy();
    fireEvent.click(within(identity()).getByRole("button", { name: "Copy public key" }));
    expect(writeText).toHaveBeenCalledWith(PUB);
    const device = screen.getByRole("heading", { name: "Device" }).closest("section") as HTMLElement;
    expect(within(device).queryByRole("button", { name: "Copy public key" })).toBeNull();
  });

  it("asks before replacing the identity and offers to back up the old private key first", async () => {
    vi.spyOn(nacl, "randomBytes").mockImplementation(() => fromHex(SEED));
    const port = await connectApp({
      "get prv.key": `> ${SECRET}`,
      [`set prv.key ${MESHCORE_PRV}`]: `OK, reboot to apply! New pubkey: ${MESHCORE_PUB}`,
    });
    render(<DeviceDrawer />);
    fireEvent.click(button("Generate vanity key…"));
    fireEvent.input(screen.getByLabelText("Public key prefix"), { target: { value: "03" } });
    fireEvent.click(button("Generate"));
    await screen.findByText(MESHCORE_PUB);
    fireEvent.click(button("Write to device"));
    expect(screen.getByText(t("identity.replaceWarn"))).toBeTruthy();
    expect(port.received.some((l) => l.startsWith("set prv.key"))).toBe(false);
    expect(button("Replace identity").disabled).toBe(true);
    // Back goes to the found key without writing.
    fireEvent.click(button("Back"));
    expect(screen.getByText(MESHCORE_PUB)).toBeTruthy();
    fireEvent.click(button("Write to device"));
    // Copying the old key ticks the backup box.
    fireEvent.click(button("Copy current private key"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
    const box = screen.getByRole("checkbox", { name: t("identity.backedUp") }) as HTMLInputElement;
    await waitFor(() => expect(box.checked).toBe(true));
    expect(document.body.textContent).not.toContain(SECRET);
    await waitFor(() => expect(button("Replace identity").disabled).toBe(false));
    fireEvent.click(button("Replace identity"));
    await screen.findByText(t("vanity.written", { key: MESHCORE_PUB }));
    expect(port.received.filter((l) => l.startsWith("set prv.key"))).toHaveLength(1);
  });

  it("a key write records the old public key into previousPublicKeys", async () => {
    vi.spyOn(nacl, "randomBytes").mockImplementation(() => fromHex(SEED));
    await connectApp({ [`set prv.key ${MESHCORE_PRV}`]: `OK, reboot to apply! New pubkey: ${MESHCORE_PUB}` });
    store.snapshot.value = { settings: {}, missing: [], publicKey: "aa11" };
    render(<DeviceDrawer />);
    fireEvent.click(button("Generate random key…"));
    fireEvent.click(button("Generate"));
    await screen.findByText(MESHCORE_PUB);
    confirmReplace();
    await screen.findByText(t("vanity.written", { key: MESHCORE_PUB }));
    expect(store.snapshot.value?.publicKey).toBe(MESHCORE_PUB);
    expect(store.snapshot.value?.previousPublicKeys).toEqual(["aa11"]);
  });

  it("generates a random key and writes it after the same confirmation", async () => {
    vi.spyOn(nacl, "randomBytes").mockImplementation(() => fromHex(SEED));
    const port = await connectApp({ [`set prv.key ${MESHCORE_PRV}`]: `OK, reboot to apply! New pubkey: ${MESHCORE_PUB}` });
    render(<DeviceDrawer />);
    fireEvent.click(button("Generate random key…"));
    expect(screen.queryByLabelText("Public key prefix")).toBeNull();
    fireEvent.click(button("Generate"));
    await screen.findByText(MESHCORE_PUB);
    confirmReplace();
    await screen.findByText(t("vanity.written", { key: MESHCORE_PUB }));
    expect(port.received.filter((l) => l.startsWith("set prv.key"))).toEqual([`set prv.key ${MESHCORE_PRV}`]);
    expect(logText()).not.toContain(MESHCORE_PRV);
  });

  it("Reveal reads the private key only on click, Copy copies it, and closing the drawer hides it", async () => {
    const port = await connectApp({ "get prv.key": `> ${SECRET}` });
    const first = render(<DeviceDrawer />);
    expect(port.received).not.toContain("get prv.key");
    expect(first.container.textContent).not.toContain(SECRET);
    fireEvent.click(button("Reveal"));
    await screen.findByText(SECRET);
    fireEvent.click(button("Copy private key"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
    expect(logText()).not.toContain(SECRET);
    store.drawerOpen.value = false;
    cleanup();
    store.drawerOpen.value = true;
    const again = render(<DeviceDrawer />);
    expect(again.container.textContent).not.toContain(SECRET);
  });

  it("rejects a vanity prefix of 00 (and non-hex or over 4 characters)", async () => {
    await connectApp({});
    render(<DeviceDrawer />);
    fireEvent.click(button("Generate vanity key…"));
    const input = screen.getByLabelText("Public key prefix") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "00" } });
    expect(screen.getByText(t("vanity.notAllowed"))).toBeTruthy();
    expect(button("Generate").disabled).toBe(true);
    fireEvent.input(input, { target: { value: "xyz" } });
    expect(screen.getByText(t("vanity.invalid"))).toBeTruthy();
    expect(input.maxLength).toBe(4);
    fireEvent.input(input, { target: { value: "12345" } });
    expect(screen.getByText(t("vanity.invalid"))).toBeTruthy();
    expect(button("Generate").disabled).toBe(true);
    fireEvent.input(input, { target: { value: "be" } });
    expect(button("Generate").disabled).toBe(false);
    expect(screen.getByText(t("vanity.estimate", { count: "256" }))).toBeTruthy();
  });

  async function generateAndWrite(reply: string) {
    vi.spyOn(nacl, "randomBytes").mockImplementation(() => fromHex(SEED));
    const port = await connectApp({ [`set prv.key ${MESHCORE_PRV}`]: reply });
    render(<DeviceDrawer />);
    fireEvent.click(button("Generate vanity key…"));
    fireEvent.input(screen.getByLabelText("Public key prefix"), { target: { value: "03" } });
    fireEvent.click(button("Generate"));
    await screen.findByText(MESHCORE_PUB);
    confirmReplace();
    await waitFor(() => expect(port.received.at(-1)).toBe(`set prv.key ${MESHCORE_PRV}`));
    return port;
  }

  it("writes the found key with set prv.key and confirms the public key the device reports", async () => {
    await generateAndWrite(`OK, reboot to apply! New pubkey: ${MESHCORE_PUB}`);
    await screen.findByText(t("vanity.written", { key: MESHCORE_PUB }));
    expect(logText()).not.toContain(MESHCORE_PRV);
    expect(logText()).toContain("set prv.key");
  });

  it("after a write, the old private key is gone and the public key is the new one, pending a reboot", async () => {
    vi.spyOn(nacl, "randomBytes").mockImplementation(() => fromHex(SEED));
    const port = await connectApp({
      "get prv.key": `> ${SECRET}`,
      [`set prv.key ${MESHCORE_PRV}`]: `OK, reboot to apply! New pubkey: ${MESHCORE_PUB}`,
    });
    store.snapshot.value = { settings: {}, missing: [], publicKey: PUB };
    const { container } = render(<DeviceDrawer />);
    fireEvent.click(button("Reveal"));
    await screen.findByText(SECRET);
    fireEvent.click(button("Generate vanity key…"));
    fireEvent.input(screen.getByLabelText("Public key prefix"), { target: { value: "03" } });
    fireEvent.click(button("Generate"));
    await screen.findByText(MESHCORE_PUB);
    confirmReplace();
    await screen.findByText(t("vanity.written", { key: MESHCORE_PUB }));
    expect(container.textContent).not.toContain(SECRET);
    expect(button("Reveal")).toBeTruthy();
    expect(store.snapshot.value).toMatchObject({ publicKey: MESHCORE_PUB, publicKeyPending: true });
    fireEvent.click(button("Copy public key"));
    expect(writeText).toHaveBeenCalledWith(MESHCORE_PUB);
    // Copy of the private key reads it from the device again instead of using the old one.
    await waitFor(() => expect(store.commandBusy.value).toBe(false));
    fireEvent.click(button("Copy private key"));
    await waitFor(() => expect(port.received.filter((l) => l === "get prv.key")).toHaveLength(2));
  });

  it("the device card marks a written public key as applying after a reboot", async () => {
    await connectApp({});
    store.snapshot.value = { settings: {}, missing: [], publicKey: MESHCORE_PUB, publicKeyPending: true };
    render(<Connect />);
    expect(screen.getByTitle(MESHCORE_PUB).textContent).toContain(t("device.afterReboot"));
  });

  it("warns when the device reports a different public key", async () => {
    await generateAndWrite(`OK, reboot to apply! New pubkey: ${PUB}`);
    const warning = await screen.findByText(t("vanity.mismatch", { got: PUB, want: MESHCORE_PUB }));
    // The device saved a key that is not the generated one: an error, not a warning.
    expect(warning.closest(".notice")?.classList.contains("error")).toBe(true);
    expect(logText()).not.toContain(MESHCORE_PRV);
  });

  it("a failed write that echoes the key shows no key, keeps the generated key and can be retried", async () => {
    const port = await generateAndWrite(`unknown config: prv.key ${MESHCORE_PRV}`);
    const failure = await screen.findByText(t("vanity.writeFailed", { reason: "unknown config: prv.key (hidden)" }));
    expect(failure.closest(".notice")?.classList.contains("error")).toBe(true);
    expect(document.body.textContent).not.toContain(MESHCORE_PRV);
    expect(logText()).not.toContain(MESHCORE_PRV);
    // Still the found key: write again without searching.
    expect(screen.getByText(MESHCORE_PUB)).toBeTruthy();
    await waitFor(() => expect(button("Replace identity").disabled).toBe(false));
    fireEvent.click(button("Replace identity"));
    await waitFor(() => expect(port.received.filter((l) => l.startsWith("set prv.key")).length).toBe(2));
  });

  it("a drawer command never hands back a private key it sent, even in a too-long-line error", async () => {
    await connectApp({});
    const long = "ab".repeat(80);
    const r = await deviceCommand(`set prv.key ${long}`);
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("abab");
    expect(JSON.stringify(r)).toContain("(hidden)");
  });

  it("a truncated echo of the key after prv.key is masked too", async () => {
    await connectApp({ [`set prv.key ${SECRET}`]: `unknown config: prv.key ${SECRET.slice(0, 8)}…` });
    const r = await deviceCommand(`set prv.key ${SECRET}`);
    expect(r).toEqual({ ok: false, error: "unknown config: prv.key (hidden)…" });
    expect(logText()).not.toContain("abab");
  });

  it("a device change closes the vanity dialog and drops the generated key", async () => {
    vi.spyOn(nacl, "randomBytes").mockImplementation(() => fromHex(SEED));
    await connectApp({});
    render(<DeviceDrawer />);
    fireEvent.click(button("Generate vanity key…"));
    fireEvent.input(screen.getByLabelText("Public key prefix"), { target: { value: "03" } });
    fireEvent.click(button("Generate"));
    await screen.findByText(MESHCORE_PUB);
    const second = await connectApp({});
    await waitFor(() => expect(screen.queryByText(MESHCORE_PUB)).toBeNull());
    expect(screen.queryByRole("button", { name: "Write to device" })).toBeNull();
    // Opening it again starts from the prefix, not the old key.
    fireEvent.click(button("Generate vanity key…"));
    expect(screen.getByLabelText("Public key prefix")).toBeTruthy();
    expect(screen.queryByText(MESHCORE_PUB)).toBeNull();
    expect(second.received.some((l) => l.startsWith("set prv.key"))).toBe(false);
  });

  it("gives up after the attempt limit with the old message", async () => {
    cap.max = 64;
    vi.spyOn(nacl, "randomBytes").mockImplementation(() => fromHex(SEED));
    await connectApp({});
    render(<DeviceDrawer />);
    fireEvent.click(button("Generate vanity key…"));
    fireEvent.input(screen.getByLabelText("Public key prefix"), { target: { value: "9" } });
    fireEvent.click(button("Generate"));
    await screen.findByText("Gave up after 64 attempts. Try a shorter prefix.");
    expect(button("Generate").disabled).toBe(false);
  });

  it("Cancel stops a running search", async () => {
    vi.spyOn(nacl, "randomBytes").mockImplementation(() => fromHex(SEED));
    await connectApp({});
    render(<DeviceDrawer />);
    fireEvent.click(button("Generate vanity key…"));
    // The reference seed's key starts with 03, never with 9.
    fireEvent.input(screen.getByLabelText("Public key prefix"), { target: { value: "9" } });
    fireEvent.click(button("Generate"));
    await screen.findByText(/keys tried/);
    fireEvent.click(button("Cancel"));
    expect(screen.queryByText(/keys tried/)).toBeNull();
    expect(button("Generate").disabled).toBe(false);
  });
});

describe("command log", () => {
  it("never shows a private key typed or read through the link", async () => {
    const other = "cd".repeat(64);
    await connectApp({
      "get prv.key": `> ${SECRET}`,
      [`set prv.key ${SECRET}`]: "OK",
      // a reply that echoes the key it was given
      [`set prv.key ${other}`]: `unknown config: prv.key ${other}`,
    });
    const link = store.device.value.link as SerialLink;
    await link.command("get prv.key");
    await link.command(`set prv.key ${SECRET}`);
    await link.command(`set prv.key ${other}`);
    await link.command(`set prv.key ${SECRET}${"0".repeat(20)}`).catch(() => undefined);
    expect(logText()).not.toMatch(/abab|cdcd/);
    expect(logText()).toContain("> get prv.key");
    expect(logText()).toContain("> set prv.key (hidden)");
  });
});
