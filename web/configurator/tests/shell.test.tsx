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
  store.step.value = 1;
  visited.value = new Set([1]);
  store.device.value = { status: "none", link: null, firmware: null };
  store.drawerOpen.value = false;
});

describe("app shell", () => {
  it("clicking segment 4 goes to step 4 and hides the map", () => {
    const { container } = render(<App />);
    const map = container.querySelector(".map-container") as HTMLElement;
    expect(map.hidden).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: /Settings/ })[0]);
    expect(store.step.value).toBe(4);
    expect(map.hidden).toBe(true);
    expect(container.querySelector(".panel")?.classList.contains("wide")).toBe(true);
  });

  it("shows the place chip on step 4 and clicking it returns to step 2", () => {
    store.plan.value = { ...defaultPlan(), anchor: ronse, nameSuffix: "Kluisberg" };
    store.step.value = 4;
    render(<App />);
    const chip = screen.getByRole("button", { name: /BE-RON-Kluisberg · Ronse/ });
    fireEvent.click(chip);
    expect(store.step.value).toBe(2);
  });

  it("hides the place chip on steps 1 to 3", () => {
    store.plan.value = { ...defaultPlan(), anchor: ronse, nameSuffix: "Kluisberg" };
    store.step.value = 3;
    render(<App />);
    expect(screen.queryByText(/BE-RON-Kluisberg/)).toBeNull();
  });

  it("marks segment 3 as attention when there is no anchor", () => {
    store.step.value = 3;
    store.step.value = 1;
    const { container } = render(<App />);
    expect(container.querySelectorAll(".stepper .seg")[2].classList.contains("attention")).toBe(true);
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
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next: Place & name" }));
    expect(store.step.value).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(store.step.value).toBe(1);
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
