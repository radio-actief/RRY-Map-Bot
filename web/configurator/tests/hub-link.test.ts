import { afterEach, describe, expect, it, vi } from "vitest";
import { openHub } from "../src/state/hub";

/** The map's device hub in a hidden frame (state/hub.ts), for the configurator on its own address. */

const URL_ = "https://map.example/device-hub.html";

afterEach(() => {
  document.body.innerHTML = "";
});

function frameOf() {
  const frame = document.querySelector("iframe")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
  return { frame, post };
}

describe("the hub frame", () => {
  it("is hidden, out of the tab order, and loads the map's hub", () => {
    openHub(URL_);
    const frame = document.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(URL_);
    expect(frame.hidden).toBe(true);
    expect(frame.tabIndex).toBe(-1);
    expect(frame.getAttribute("aria-hidden")).toBe("true");
  });

  it("holds messages until the frame has loaded, then posts them to the map's origin only", () => {
    const hub = openHub(URL_);
    const { frame, post } = frameOf();
    hub.send({ a: 1 });
    expect(post).not.toHaveBeenCalled();
    frame.dispatchEvent(new Event("load"));
    hub.send({ b: 2 });
    expect(post.mock.calls).toEqual([
      [{ a: 1 }, "https://map.example"],
      [{ b: 2 }, "https://map.example"],
    ]);
  });

  it("hears only its own frame from the map's origin", () => {
    const hub = openHub(URL_);
    const { frame } = frameOf();
    const heard: unknown[] = [];
    hub.listen((d) => heard.push(d));
    window.dispatchEvent(new MessageEvent("message", { data: 1, origin: "https://map.example", source: frame.contentWindow }));
    window.dispatchEvent(new MessageEvent("message", { data: 2, origin: "https://evil.example", source: frame.contentWindow }));
    window.dispatchEvent(new MessageEvent("message", { data: 3, origin: "https://map.example", source: window }));
    expect(heard).toEqual([1]);
  });

  it("answers an ask with the first message of that kind, or null in time", async () => {
    vi.useFakeTimers();
    try {
      const hub = openHub(URL_);
      const { frame } = frameOf();
      frame.dispatchEvent(new Event("load"));
      const answer = hub.ask({ kind: "q", v: 1 }, "a", 1000);
      window.dispatchEvent(new MessageEvent("message", { data: { kind: "other", v: 1 }, origin: "https://map.example", source: frame.contentWindow }));
      window.dispatchEvent(new MessageEvent("message", { data: { kind: "a", v: 1, x: 1 }, origin: "https://map.example", source: frame.contentWindow }));
      await expect(answer).resolves.toEqual({ kind: "a", v: 1, x: 1 });
      const none = hub.ask({ kind: "q", v: 1 }, "a", 1000);
      vi.advanceTimersByTime(1000);
      await expect(none).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is gone after close", () => {
    const hub = openHub(URL_);
    hub.close();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
