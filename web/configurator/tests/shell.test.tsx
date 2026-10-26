import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { Dialog } from "../src/app/Dialog";
import { Notice } from "../src/app/Notice";
import { defaultPlan } from "../src/core/plan";
import { store, visited } from "../src/state/store";

function stubWidth(px: number) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: /max-width:\s*(\d+)px/.test(q) ? px <= Number(/(\d+)px/.exec(q)![1]) : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const ronse = {
  mode: "city" as const,
  province_code: "BE-VOV",
  place: { nis5: "1", plaats: "Ronse", gemeente: "Ronse", province_code: "BE-VOV", city_code: "beron", lat: 50.7, lon: 3.6 },
};

beforeEach(() => stubWidth(1280));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  store.plan.value = defaultPlan();
  store.step.value = "connect";
  visited.value = new Set(["connect"]);
  store.device.value = { status: "none", link: null, firmware: null };
  store.drawerOpen.value = false;
  store.snapshot.value = null;
});

describe("app shell", () => {
  it("clicking the Settings segment goes to Settings and hides the map", () => {
    const { container } = render(<App />);
    const map = container.querySelector(".map-container") as HTMLElement;
    expect(map.hidden).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: /^5 Settings|^Settings/ })[0]);
    expect(store.step.value).toBe("settings");
    expect(map.hidden).toBe(true);
    expect(container.querySelector(".panel")?.classList.contains("wide")).toBe(true);
  });

  it("shows the place chip on Settings and Send, and clicking it returns to Place", () => {
    store.plan.value = { ...defaultPlan(), anchor: ronse, nameSuffix: "Kluisberg" };
    store.step.value = "settings";
    render(<App />);
    const chip = screen.getByRole("button", { name: /BE-RON-Kluisberg · Ronse/ });
    fireEvent.click(chip);
    expect(store.step.value).toBe("place");
    act(() => void (store.step.value = "send"));
    expect(screen.getByRole("button", { name: /BE-RON-Kluisberg · Ronse/ })).toBeTruthy();
  });

  it("the Not connected chip opens the USB port picker", async () => {
    const requestPort = vi.fn(() => Promise.reject(Object.assign(new Error("closed"), { name: "NotFoundError" })));
    vi.stubGlobal("navigator", { ...navigator, serial: { requestPort } });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Not connected — connect over USB" }));
    expect(requestPort).toHaveBeenCalledTimes(1);
  });

  it("the connected chip shows the repeater name, the USB device and the firmware", () => {
    store.device.value = {
      status: "connected",
      link: null,
      firmware: "v1.17.1 (Build: 01-Oct-2026)",
      usb: { usbVendorId: 0x239a, usbProductId: 0x8029 },
    };
    store.snapshot.value = { name: "BE-RON-Kluisberg" } as never;
    const { container } = render(<App />);
    const chip = container.querySelector(".topbar .chip.conn") as HTMLElement;
    expect(chip.textContent).toBe("BE-RON-Kluisberg · RAK4631 · v1.17.1");
    // The USB ids only in the tooltip.
    expect(chip.getAttribute("title")).toBe("BE-RON-Kluisberg · RAK4631 (239a:8029) · v1.17.1");
    expect(screen.queryByRole("button", { name: /connect over USB/ })).toBeNull();
  });

  it("leaves the name out of the connected chip while the place chip shows it", () => {
    store.device.value = {
      status: "connected",
      link: null,
      firmware: "v1.17.1 (Build: 01-Oct-2026)",
      usb: { usbVendorId: 0x239a, usbProductId: 0x8029 },
    };
    store.snapshot.value = { name: "BE-RON-Kluisberg", settings: {} } as never;
    store.plan.value = { ...defaultPlan(), anchor: ronse, nameSuffix: "Kluisberg" };
    store.step.value = "settings";
    const { container } = render(<App />);
    expect((container.querySelector(".topbar .chip.conn") as HTMLElement).textContent).toBe("RAK4631 · v1.17.1");
    expect(screen.getByRole("button", { name: /BE-RON-Kluisberg · Ronse/ })).toBeTruthy();
  });

  it("hides the place chip on the steps beside the map", () => {
    store.plan.value = { ...defaultPlan(), anchor: ronse, nameSuffix: "Kluisberg" };
    store.step.value = "regions";
    render(<App />);
    expect(screen.queryByText(/BE-RON-Kluisberg/)).toBeNull();
    act(() => void (store.step.value = "name"));
    expect(screen.queryByText(/BE-RON-Kluisberg/)).toBeNull();
  });

  it("marks the Regions segment as attention when there is no anchor", () => {
    store.step.value = "regions";
    store.step.value = "connect";
    const { container } = render(<App />);
    expect(container.querySelectorAll(".stepper .seg")[3].classList.contains("attention")).toBe(true);
  });

  it("renders a bottom sheet with a grab handle under 768 px", () => {
    stubWidth(500);
    const { container } = render(<App />);
    expect(container.querySelector(".panel.sheet")).not.toBeNull();
    expect(container.querySelector(".grab")).not.toBeNull();
  });

  it("cycles the sheet height from the grab handle", () => {
    stubWidth(500);
    const { container } = render(<App />);
    store.sheet.value = "half";
    fireEvent.click(container.querySelector(".grab")!);
    expect(store.sheet.value).toBe("full");
  });

  it("forces the sheet to full height on Settings and Send and restores the user's height after", () => {
    stubWidth(500);
    store.sheet.value = "peek";
    const { container } = render(<App />);
    const panel = () => container.querySelector(".panel")!;
    expect(panel().classList.contains("peek")).toBe(true);
    act(() => {
      store.step.value = "settings";
    });
    expect(panel().classList.contains("full")).toBe(true);
    act(() => {
      store.step.value = "place";
    });
    expect(panel().classList.contains("peek")).toBe(true);
    act(() => {
      store.step.value = "send";
    });
    expect(panel().classList.contains("full")).toBe(true);
    act(() => {
      store.step.value = "regions";
    });
    expect(panel().classList.contains("peek")).toBe(true);
    store.sheet.value = "half";
  });

  it("lets the top bar chips shrink at 360 px", () => {
    stubWidth(360);
    store.plan.value = { ...defaultPlan(), anchor: ronse, nameSuffix: "Kluisberg" };
    store.step.value = "settings";
    const { container } = render(<App />);
    const chips = container.querySelectorAll(".topbar .chip");
    expect(chips.length).toBe(2);
    chips.forEach((c) => expect(c.classList.contains("trunc")).toBe(true));
  });

  it("exposes step status to assistive tech", () => {
    store.step.value = "regions";
    store.step.value = "connect";
    const { container } = render(<App />);
    expect(container.querySelectorAll(".stepper .seg")[3].textContent).toContain("Regions — needs attention");
  });

  it("shows connection state and toggles the drawer and theme", () => {
    render(<App />);
    expect(screen.getByText("Not connected")).toBeTruthy();
    act(() => {
      store.device.value = { status: "connected", link: null, firmware: "v1.17.1 (Build: 14 Aug 2026)" };
    });
    expect(screen.getByText("USB · v1.17.1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Device tools" }));
    expect(store.drawerOpen.value).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Theme/ }));
    expect(store.theme.value).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: /Theme/ }));
    expect(store.theme.value).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: /Theme/ }));
    expect(store.theme.value).toBe("system");
  });

  it("Back and Next move between steps", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: "← Back" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next: Place →" }));
    expect(store.step.value).toBe("place");
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(store.step.value).toBe("connect");
  });
});

describe("Notice and Dialog", () => {
  it("Notice carries its kind", () => {
    const { container } = render(<Notice kind="warn">Careful</Notice>);
    expect(container.querySelector(".notice.warn")?.textContent).toContain("Careful");
  });

  it("Dialog opens, shows title and actions and reports close", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open title="Sure?" onClose={onClose} actions={<button>Go</button>}>
        Body
      </Dialog>,
    );
    const d = container.querySelector("dialog")!;
    expect(d.hasAttribute("open")).toBe(true);
    expect(screen.getByText("Sure?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Dialog stays closed when open is false", () => {
    const { container } = render(<Dialog open={false} title="x" onClose={() => {}} actions={null} />);
    expect(container.querySelector("dialog")!.hasAttribute("open")).toBe(false);
  });
});

describe("index.html", () => {
  it("has the #BEmesh title and the site favicon served at the root", () => {
    const doc = new DOMParser().parseFromString(readFileSync(resolve(__dirname, "../index.html"), "utf8"), "text/html");
    expect(doc.title).toBe("#BEmesh configurator");
    expect(doc.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/favicon.ico");
  });
});
