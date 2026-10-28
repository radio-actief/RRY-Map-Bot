import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("leaflet", async () => await import("./fakes/leaflet"));

import { MapView } from "../src/app/MapView";
import { Panel } from "../src/app/Panel";
import { defaultPlan, planErrors } from "../src/core/plan";
import type { Place as PlaceRow } from "../src/core/search";
import { SerialLink } from "../src/device/serial";
import { Connect } from "../src/steps/Connect";
import { DeviceDrawer } from "../src/app/DeviceDrawer";
import { connectUsb, disconnectUsb, readDevice } from "../src/state/device";
import { Name } from "../src/steps/Name";
import { Place } from "../src/steps/Place";
import { Send } from "../src/steps/Send";
import { canApply, placeChosen, placeLeft, resetPlan, setLocation, stepStatus, store } from "../src/state/store";
import { FakePort } from "./fakes/fake-port";
import { ofKind, resetFake } from "./fakes/leaflet";
import read from "./fixtures/read-ronse.json";

const PLACES: PlaceRow[] = JSON.parse(readFileSync(resolve(__dirname, "../../../data/be-locode.json"), "utf8"));
const MUNIS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/municipalities-3.json"), "utf8"));
const RONSE = PLACES.find((p) => p.city_code === "beron")!;
const FAST = { interCommandDelayMs: 0, bootDrainMs: 0, disconnectSettleMs: 0, replyTimeoutMs: 40, rawQuietMs: 30 };

const type = (label: RegExp | string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });

const node = (name: string, lat: number, lon: number, type = 2) => ({
  public_key: name,
  type,
  adv_name: name,
  adv_lat: lat,
  adv_lon: lon,
});

beforeEach(() => {
  resetFake();
  resetPlan(defaultPlan());
  store.snapshot.value = null;
  store.deviceRegions.value = undefined;
  store.notice.value = null;
  store.reading.value = false;
  store.lastRead.value = null;
  store.step.value = "place";
  store.device.value = { status: "none", link: null, firmware: null };
  store.data.value = { failed: new Set(), places: PLACES, municipalities: MUNIS };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function connectedLink(replies: Record<string, string> = read) {
  const port = new FakePort(replies);
  const link = new SerialLink(port, FAST);
  await link.open();
  return { port, link };
}

describe("Connect step", () => {
  it("without Web Serial explains why and offers to continue without a device", () => {
    store.step.value = "connect";
    render(<Connect />);
    expect(screen.getByText(/can't use USB/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect over USB" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Continue without a device/ }));
    expect(store.step.value).toBe("place");
  });

  it("connecting checks the firmware once and fills the device card", async () => {
    store.step.value = "connect";
    const port = new FakePort(read);
    await connectUsb({ requestPort: async () => port, timing: FAST });
    expect(port.received).toEqual(["ver"]);
    expect(store.device.value.status).toBe("connected");
    expect(store.device.value.firmware).toBe("v1.17.1");
    render(<Connect />);
    expect(screen.getByText("v1.17.1")).toBeTruthy();
    expect(screen.getByText("regions ✓")).toBeTruthy();
  });

  it("connecting keeps the port's USB vendor and product id", async () => {
    const port = new FakePort(read, { info: { usbVendorId: 0x239a, usbProductId: 0x8029 } });
    await connectUsb({ requestPort: async () => port, timing: FAST });
    expect(store.device.value.usb).toEqual({ usbVendorId: 0x239a, usbProductId: 0x8029 });
    await disconnectUsb();
    expect(store.device.value.usb).toBeUndefined();
  });

  it("unplugging resets the device and shows a notice", async () => {
    const port = new FakePort(read, { disconnectAfter: 2 });
    await connectUsb({ requestPort: async () => port, timing: FAST });
    const link = store.device.value.link!;
    await link.command("get name").catch(() => undefined);
    await waitFor(() => expect(store.device.value.status).toBe("none"));
    expect(store.device.value.link).toBeNull();
    expect(store.notice.value?.kind).toBe("error");
  });

  it("Read without edits fills the plan and keeps the snapshot and device regions", async () => {
    const { link } = await connectedLink();
    store.device.value = { status: "connected", link, firmware: "v1.17.1" };
    render(<Connect />);
    fireEvent.click(screen.getByRole("button", { name: "Read settings from repeater" }));
    await waitFor(() => expect(store.snapshot.value).not.toBeNull());
    expect(store.plan.value.anchor?.place?.city_code).toBe("beron");
    expect(store.plan.value.nameSuffix).toBe("Kluisberg");
    expect(store.deviceRegions.value?.named).toContain("bemak");
    const card = (await screen.findByText("34 settings")).closest(".device-card") as HTMLElement;
    expect(within(card).getByText("Last read")).toBeTruthy();
    expect(screen.getByText("BE-RON-Kluisberg🌞")).toBeTruthy();
    // After a Read: one gold button (Next), Read again is a plain one, and no plug-in hint.
    const again = screen.getByRole("button", { name: "Read again" });
    expect(again.classList.contains("primary")).toBe(false);
    expect(screen.queryByRole("button", { name: "Read settings from repeater" })).toBeNull();
    expect(screen.queryByText(/Plug it in with a USB cable/)).toBeNull();
  });

  it("Read keeps the repeater's access list in the snapshot and the plan", async () => {
    const { link } = await connectedLink();
    store.device.value = { status: "connected", link, firmware: "v1.17.1" };
    render(<Connect />);
    fireEvent.click(screen.getByRole("button", { name: "Read settings from repeater" }));
    await waitFor(() => expect(store.snapshot.value).not.toBeNull());
    const entry = [{ key: "a1".repeat(32), role: 3 }];
    expect(store.snapshot.value?.acl).toEqual(entry);
    expect(store.plan.value.acl).toEqual(entry);
  });

  it("Read over an edited plan asks first, and Skip leaves the plan alone", async () => {
    const { link } = await connectedLink();
    store.device.value = { status: "connected", link, firmware: "v1.17.1" };
    store.plan.value = { ...store.plan.value, nameSuffix: "Mine" };
    render(<Connect />);
    fireEvent.click(screen.getByRole("button", { name: "Read settings from repeater" }));
    expect(screen.getByText("Read settings from repeater?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(store.plan.value.nameSuffix).toBe("Mine");
    expect(store.snapshot.value).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Read settings from repeater" }));
    fireEvent.click(screen.getByRole("button", { name: "Read and overwrite form" }));
    await waitFor(() => expect(store.plan.value.nameSuffix).toBe("Kluisberg"));
  });

  it("lists commands that got no reply", async () => {
    const { link } = await connectedLink({ ...read, "get tx": "", "get multi.acks": "Err - unknown" });
    store.device.value = { status: "connected", link, firmware: "v1.17.1" };
    render(<Connect />);
    fireEvent.click(screen.getByRole("button", { name: "Read settings from repeater" }));
    expect(await screen.findByText(/No reply to: get tx, get multi\.acks/)).toBeTruthy();
  });

  it("unplugged while opening: back to no device with a notice", async () => {
    const port = { readable: null, writable: null, open: async () => {}, close: async () => {} };
    await connectUsb({ requestPort: async () => port, timing: FAST });
    expect(store.device.value.status).toBe("none");
    expect(store.notice.value?.kind).toBe("error");
  });

  it("a Read cut short by an unplug changes nothing and says it failed", async () => {
    // The 6th read command loses the link.
    const port = new FakePort(read, { disconnectAfter: 6 });
    const link = new SerialLink(port, FAST);
    await link.open();
    store.device.value = { status: "connected", link, firmware: "v1.17.1" };
    const before = store.plan.value;
    render(<Connect />);
    fireEvent.click(screen.getByRole("button", { name: "Read settings from repeater" }));
    expect(await screen.findByText(/Read failed: the repeater was disconnected/)).toBeTruthy();
    expect(store.plan.value).toBe(before);
    expect(store.snapshot.value).toBeNull();
    expect(store.deviceRegions.value).toBeUndefined();
  });

  it("Disconnect during a Read changes nothing", async () => {
    const { link } = await connectedLink();
    store.device.value = { status: "connected", link, firmware: "v1.17.1" };
    const before = store.plan.value;
    render(<Connect />);
    fireEvent.click(screen.getByRole("button", { name: "Read settings from repeater" }));
    expect(store.reading.value).toBe(true);
    await disconnectUsb();
    await waitFor(() => expect(store.reading.value).toBe(false));
    expect(store.plan.value).toBe(before);
    expect(store.snapshot.value).toBeNull();
    expect(store.lastRead.value?.ok).toBe(false);
  });

  describe("another device", () => {
    const B = { ver: "v1.17.1 (Build: 12-Oct-2026)" };
    const A_KEY = read["get public.key"].replace(/^> /, "");

    /** Device A connected through the app and read (34 commands after `ver`), the next command unplugs it. */
    async function readA() {
      const port = new FakePort(read, { disconnectAfter: 36 });
      await connectUsb({ requestPort: async () => port, timing: FAST });
      await readDevice();
      expect(store.snapshot.value?.publicKey).toBe(A_KEY);
      expect(store.clock.value).not.toBeNull();
      expect(store.deviceRegions.value).toBeDefined();
    }

    const forgotten = () => {
      expect(store.snapshot.value).toBeNull();
      expect(store.clock.value).toBeNull();
      expect(store.deviceRegions.value).toBeUndefined();
      expect(store.lastRead.value).toBeNull();
    };

    it("unplug A, connect B: nothing of A shows in the card, drawer, summary or nearby check", async () => {
      await readA();
      await store.device.value.link!.command("clock").catch(() => undefined);
      await waitFor(() => expect(store.device.value.status).toBe("none"));
      forgotten();

      await connectUsb({ requestPort: async () => new FakePort(B), timing: FAST });
      expect(store.device.value.status).toBe("connected");
      forgotten();

      store.step.value = "connect";
      const card = render(<Connect />);
      expect(screen.queryByText("BE-RON-Kluisberg🌞")).toBeNull();
      expect(screen.getAllByText("—").length).toBe(2);
      card.unmount();

      store.drawerOpen.value = true;
      const drawer = render(<DeviceDrawer />);
      expect((screen.getByRole("button", { name: "Copy public key" }) as HTMLButtonElement).disabled).toBe(true);
      // Neither the clock nor the public key of B has been read.
      expect(screen.getAllByText(/not read/)).toHaveLength(2);
      drawer.unmount();
      store.drawerOpen.value = false;

      const send = render(<Send />);
      expect(document.querySelector(".rv-from")).toBeNull();
      send.unmount();

      // A's own node no longer counts as "this repeater" for B.
      store.data.value = { ...store.data.value, nodes: [{ ...node("BE-RON-Kluisberg", 50.76, 3.61), public_key: A_KEY }] };
      render(<Name />);
      expect(screen.getByText(/already used nearby/)).toBeTruthy();
    });

    it("Disconnect and a new connect forget the device read", async () => {
      await readA();
      await disconnectUsb();
      forgotten();
      await readA();
      await connectUsb({ requestPort: async () => new FakePort(B), timing: FAST });
      forgotten();
    });
  });

  it("while reading, step navigation is disabled", () => {
    store.reading.value = true;
    render(<Panel />);
    expect((screen.getByRole("button", { name: /Next: Name/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "← Back" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Disconnect in the panel footer on Connect while connected", async () => {
    const { link } = await connectedLink();
    store.device.value = { status: "connected", link, firmware: "v1.17.1" };
    store.step.value = "connect";
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(store.device.value.status).toBe("none"));
    expect(store.notice.value).toBeNull();
  });
});

describe("Place step", () => {
  it("searching Ronse and picking the first result sets the anchor and the prefix", () => {
    render(<Place />);
    const box = screen.getByRole("combobox", { name: "Search a place" });
    fireEvent.input(box, { target: { value: "Ronse" } });
    fireEvent.click(screen.getAllByRole("option")[0]);
    const plan = store.plan.value;
    expect(plan.anchor?.mode).toBe("city");
    expect(plan.anchor?.place?.city_code).toBe("beron");
    expect(plan.location).toEqual({ lat: RONSE.lat, lon: RONSE.lon });
    expect(plan.regions?.rows.some((r) => r.code === "beron")).toBe(true);
    cleanup();
    render(<Name />);
    expect(screen.getByText("BE-RON-")).toBeTruthy();
  });

  it("picking the municipality the pin is already in keeps the precise location", () => {
    store.plan.value = { ...store.plan.value, location: { lat: 50.745, lon: 3.6 } };
    render(<Place />);
    fireEvent.input(screen.getByRole("combobox", { name: "Search a place" }), { target: { value: "Ronse" } });
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(store.plan.value.anchor?.place?.city_code).toBe("beron");
    expect(store.plan.value.location).toEqual({ lat: 50.745, lon: 3.6 });
  });

  it("on blur the search shows the chosen place again", () => {
    act(() => setLocation({ lat: 50.745, lon: 3.6 }));
    render(<Place />);
    const box = screen.getByRole("combobox", { name: "Search a place" }) as HTMLInputElement;
    fireEvent.input(box, { target: { value: "Gen" } });
    fireEvent.blur(box);
    expect(box.value).toBe("Ronse");
  });

  it("typed coordinates (comma decimals) move the pin and resolve the place", () => {
    render(<Place />);
    const lat = screen.getByRole("textbox", { name: "Latitude" });
    const lon = screen.getByRole("textbox", { name: "Longitude" });
    fireEvent.input(lat, { target: { value: "50,745" } });
    fireEvent.change(lat, { target: { value: "50,745" } });
    expect(store.plan.value.location).toBeNull();
    fireEvent.input(lon, { target: { value: "3.6" } });
    fireEvent.change(lon, { target: { value: "3.6" } });
    expect(store.plan.value.location).toEqual({ lat: 50.745, lon: 3.6 });
    expect(store.plan.value.anchor?.place?.city_code).toBe("beron");
  });

  it("invalid typed coordinates show an error and keep the pin", () => {
    act(() => setLocation({ lat: 50.745, lon: 3.6 }));
    render(<Place />);
    const lat = screen.getByRole("textbox", { name: "Latitude" });
    fireEvent.input(lat, { target: { value: "95" } });
    fireEvent.change(lat, { target: { value: "95" } });
    expect(screen.getByText("Enter valid coordinates.")).toBeTruthy();
    expect(store.plan.value.location).toEqual({ lat: 50.745, lon: 3.6 });
  });

  it("Clear removes the coordinates and keeps the place", () => {
    act(() => setLocation({ lat: 50.745, lon: 3.6 }));
    render(<Place />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(store.plan.value.location).toBeNull();
    expect(store.plan.value.anchor?.place?.city_code).toBe("beron");
  });

  it("with Fixed position, Clear location flags Place and blocks Apply until a position is set", async () => {
    act(() => setLocation({ lat: 50.745, lon: 3.6 }));
    store.plan.value = { ...store.plan.value, nameSuffix: "Kluisberg", advertLoc: "prefs" };
    const { link } = await connectedLink();
    store.device.value = { status: "connected", link, firmware: "v1.17.1" };
    expect(canApply.value.ok).toBe(true);
    render(<Place />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(canApply.value.ok).toBe(false);
    expect(canApply.value.reasons).toEqual([{ key: "error.coordsRequired" }]);
    expect(screen.getByText(/with Fixed position the advert sends the stored coordinates/)).toBeTruthy();
    store.step.value = "send";
    expect(stepStatus("place")).toBe("attention");
    act(() => void (store.plan.value = { ...store.plan.value, advertLoc: "none" }));
    expect(canApply.value.ok).toBe(true);
  });

  it("a pin set before the borders load gets its place once they arrive", () => {
    store.data.value = { failed: new Set(), places: PLACES };
    act(() => setLocation({ lat: 50.745, lon: 3.6 }));
    expect(store.plan.value.anchor).toBeNull();
    act(() => {
      store.data.value = { ...store.data.value, municipalities: MUNIS };
    });
    expect(store.plan.value.anchor?.place?.city_code).toBe("beron");
    expect(store.plan.value.location).toEqual({ lat: 50.745, lon: 3.6 });
  });

  it("says the borders didn't load and points to the search", () => {
    store.data.value = { failed: new Set(["municipalities"]), places: PLACES };
    render(<Place />);
    expect(screen.getByText(/borders didn't load. Use the search/)).toBeTruthy();
  });

  it("a map pick outside Belgium keeps the location, leaves the anchor null and says so", () => {
    render(
      <>
        <MapView />
        <Place />
      </>,
    );
    act(() => ofKind("map")[0].fire("click", { latlng: { lat: 51.6, lng: 2.5 } }));
    expect(store.plan.value.location).toEqual({ lat: 51.6, lon: 2.5 });
    expect(store.plan.value.anchor).toBeNull();
    expect(screen.getByText(/outside Belgium/)).toBeTruthy();
  });

  it("a map pick inside a municipality resolves it as the anchor", () => {
    render(<Place />);
    act(() => setLocation({ lat: 50.745, lon: 3.6 }));
    expect(store.plan.value.anchor?.place?.city_code).toBe("beron");
    expect(store.plan.value.regions).not.toBeNull();
    expect(screen.getByText(/Ronse, Oost-Vlaanderen/)).toBeTruthy();
    expect(screen.queryByText(/outside Belgium/)).toBeNull();
  });

  it("the advert-location segment edits the plan", () => {
    render(<Place />);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(store.plan.value.advertLoc).toBe("none");
  });

  it("hides Use my location on a secure origin without geolocation", () => {
    vi.stubGlobal("isSecureContext", true);
    render(<Place />);
    expect(screen.queryByRole("button", { name: "Use my location" })).toBeNull();
  });

  it("hides Use my location with geolocation on an insecure origin", () => {
    vi.stubGlobal("isSecureContext", false);
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: vi.fn() }, configurable: true });
    try {
      render(<Place />);
      expect(screen.queryByRole("button", { name: "Use my location" })).toBeNull();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).geolocation;
    }
  });

  it("drops a location that arrives after the user left the step", () => {
    vi.stubGlobal("isSecureContext", true);
    let answer: PositionCallback = () => {};
    const getCurrentPosition = vi.fn((ok: PositionCallback) => void (answer = ok));
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
    try {
      render(<Place />);
      fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
      store.step.value = "name";
      answer({ coords: { latitude: 50.745, longitude: 3.6 } } as GeolocationPosition);
      expect(store.plan.value.location).toBeNull();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).geolocation;
    }
  });

  it("offers Use my location only on a secure origin with geolocation", () => {
    const { unmount } = render(<Place />);
    expect(screen.queryByRole("button", { name: "Use my location" })).toBeNull();
    unmount();
    vi.stubGlobal("isSecureContext", true);
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude: 50.74500049, longitude: 3.6000001 } } as GeolocationPosition),
    );
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
    try {
      render(<Place />);
      fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
      // Rounded to 6 decimals, as the old page did.
      expect(store.plan.value.location).toEqual({ lat: 50.745, lon: 3.6 });
      expect(store.plan.value.anchor?.place?.city_code).toBe("beron");
    } finally {
      delete (navigator as unknown as Record<string, unknown>).geolocation;
    }
  });
});

describe("Place step: coordinates required", () => {
  it("is not shown on a fresh plan, but is after going to Name and back", () => {
    store.plan.value = { ...store.plan.value, advertLoc: "prefs" };
    render(<Place />);
    expect(screen.queryByText(/with Fixed position the advert sends the stored coordinates/)).toBeNull();
    act(() => void (store.step.value = "name"));
    act(() => void (store.step.value = "place"));
    expect(screen.getByText(/with Fixed position the advert sends the stored coordinates/)).toBeTruthy();
  });
});

describe("Place step: latches", () => {
  it("resetPlan clears both", () => {
    act(() => setLocation({ lat: 50.745, lon: 3.6 }));
    store.step.value = "name";
    expect(placeChosen.value).toBe(true);
    expect(placeLeft.value).toBe(true);
    resetPlan(defaultPlan());
    expect(placeChosen.value).toBe(false);
    expect(placeLeft.value).toBe(false);
  });
});

describe("Name step", () => {
  beforeEach(() => {
    store.step.value = "name";
  });

  it("a suffix that makes a 24-byte name with a location turns the counter red and blocks Apply", () => {
    act(() => setLocation({ lat: 50.745, lon: 3.6 }));
    render(<Name />);
    fireEvent.input(screen.getByRole("textbox", { name: "Name after the prefix" }), {
      target: { value: "Kluisberg-Noord-1" },
    });
    const counter = screen.getByText("24 / 23 bytes");
    expect(counter.classList.contains("bad")).toBe(true);
    expect(canApply.value.ok).toBe(false);
    expect(canApply.value.reasons).toContainEqual({ key: "error.nameTooLong" });
  });

  it("shows an error for characters the firmware rejects", () => {
    render(<Name />);
    fireEvent.input(screen.getByRole("textbox", { name: "Name after the prefix" }), { target: { value: "a:b" } });
    expect(screen.getByText(/cannot contain/)).toBeTruthy();
  });

  it("warns when a node within 25 km already uses the name", () => {
    store.data.value = { ...store.data.value, nodes: [node("BE-RON-Kluisberg", 50.76, 3.61)] };
    act(() => setLocation({ lat: 50.745, lon: 3.6 }));
    store.plan.value = { ...store.plan.value, nameSuffix: "Kluisberg", power: "🌞" };
    render(<Name />);
    expect(screen.getByText(/already used nearby/)).toBeTruthy();
  });

  it("does not count the own repeater (public key read in capitals) as a nearby name", () => {
    store.data.value = { ...store.data.value, nodes: [{ ...node("BE-RON-Kluisberg", 50.76, 3.61), public_key: "3f5a9c0e" }] };
    store.snapshot.value = { settings: {}, missing: [], publicKey: "3F5A9C0E" };
    act(() => setLocation({ lat: 50.745, lon: 3.6 }));
    store.plan.value = { ...store.plan.value, nameSuffix: "Kluisberg", power: "🌞" };
    render(<Name />);
    expect(screen.queryByText(/already used nearby/)).toBeNull();
    expect(screen.getByText(/No node within 25 km/)).toBeTruthy();
  });

  it("ignores both the old and the new key after a key write", () => {
    store.snapshot.value = { settings: {}, missing: [], publicKey: "NEWKEY", previousPublicKeys: ["OLDKEY"] };
    act(() => setLocation({ lat: 50.745, lon: 3.6 }));
    store.plan.value = { ...store.plan.value, nameSuffix: "Kluisberg", power: "🌞" };
    for (const key of ["oldkey", "newkey"]) {
      store.data.value = { ...store.data.value, nodes: [{ ...node("BE-RON-Kluisberg", 50.76, 3.61), public_key: key }] };
      render(<Name />);
      expect(screen.queryByText(/already used nearby/)).toBeNull();
      cleanup();
    }
  });

  it("says when nearby names could not be checked", () => {
    store.data.value = { ...store.data.value, failed: new Set(["nodes"]) };
    act(() => setLocation({ lat: 50.745, lon: 3.6 }));
    store.plan.value = { ...store.plan.value, nameSuffix: "Kluisberg" };
    render(<Name />);
    expect(screen.getByText(/couldn't check nearby names/i)).toBeTruthy();
  });

  it("the power buttons edit the plan", () => {
    render(<Name />);
    fireEvent.click(screen.getByRole("button", { name: /Solar/ }));
    expect(store.plan.value.power).toBe("🌞");
  });

  it("shows owner info below power, counted in the | form with its byte limit", () => {
    render(<Name />);
    // One label: the field's own, no heading above it.
    expect(screen.queryByRole("heading", { name: "Owner info" })).toBeNull();
    expect(screen.getByText("Owner info").tagName).toBe("LABEL");
    expect(screen.getByText("0 / 119 bytes")).toBeTruthy();
    type("Owner info", "a\r\nb");
    expect(screen.getByText("3 / 119 bytes")).toBeTruthy();
    type("Owner info", "x".repeat(120));
    expect(screen.getByText("Too long. Owner info allows 119 bytes.")).toBeTruthy();
    expect(stepStatus("name")).toBe("current");
    store.step.value = "send";
    expect(stepStatus("name")).toBe("attention");
  });

  it("asks for owner info as recommended, with a public-contact hint and a Belgian example", () => {
    render(<Name />);
    const field = document.querySelector('.field[data-key="ownerInfo"]') as HTMLElement;
    expect(within(field).getByText("recommended").classList.contains("badge")).toBe(true);
    const help = field.querySelector(".help")!.textContent!;
    expect(help).toMatch(/callsign/);
    expect(help).toMatch(/email/);
    expect(help).toMatch(/public/i);
    expect(help).not.toMatch(/antenna|power|supply/i);
    expect((screen.getByLabelText("Owner info") as HTMLTextAreaElement).placeholder).toMatch(/ON4XYZ/);
  });

  it("asks for owner info on a read repeater too", async () => {
    await connectUsb({ requestPort: async () => new FakePort(read), timing: FAST });
    await act(() => readDevice());
    expect(store.snapshot.value).not.toBeNull();
    render(<Name />);
    expect(within(document.querySelector('.field[data-key="ownerInfo"]') as HTMLElement).getByText("recommended")).toBeTruthy();
  });

  it("the owner info counter counts what is sent (trimmed), as the Apply gate does", () => {
    render(<Name />);
    type("Owner info", `  ${"x".repeat(119)}  `);
    expect(screen.getByText("119 / 119 bytes")).toBeTruthy();
    expect(screen.queryByText("Too long. Owner info allows 119 bytes.")).toBeNull();
    expect(planErrors(store.plan.value).some((e) => e.key === "ownerInfo")).toBe(false);
  });
});
