import { afterEach, describe, expect, it, vi } from "vitest";
import { settleAfterKeyboard } from "../../../src/shared/viewport-settle.js";

class FakeViewport extends EventTarget {
  height = 800;
  resize(h: number) {
    this.height = h;
    this.dispatchEvent(new Event("resize"));
  }
}

const win = window as unknown as { visualViewport?: FakeViewport };

afterEach(() => {
  delete win.visualViewport;
  vi.restoreAllMocks();
});

describe("settleAfterKeyboard", () => {
  it("re-measures the map on every viewport change", () => {
    const vv = (win.visualViewport = new FakeViewport());
    const onResize = vi.fn();
    settleAfterKeyboard(onResize);
    vv.resize(500);
    vv.resize(800);
    expect(onResize).toHaveBeenCalledTimes(2);
  });

  it("scrolls the page back to the top when the keyboard closes and left it shifted", () => {
    const vv = (win.visualViewport = new FakeViewport());
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    settleAfterKeyboard(() => {});
    vv.resize(500); // keyboard opens
    Object.defineProperty(window, "scrollY", { value: 120, configurable: true });
    vv.resize(800); // keyboard closes, page still shifted
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });

  it("leaves the page alone while the keyboard is open", () => {
    const vv = (win.visualViewport = new FakeViewport());
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    Object.defineProperty(window, "scrollY", { value: 120, configurable: true });
    settleAfterKeyboard(() => {});
    vv.resize(500);
    expect(scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });

  it("stops listening when undone", () => {
    const vv = (win.visualViewport = new FakeViewport());
    const onResize = vi.fn();
    settleAfterKeyboard(onResize)();
    vv.resize(500);
    expect(onResize).not.toHaveBeenCalled();
  });
});
