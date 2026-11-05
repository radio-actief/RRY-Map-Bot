import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../../../src/shared/clipboard.js";

const nav = navigator as unknown as { clipboard?: { writeText(s: string): Promise<void> } };
const doc = document as unknown as { execCommand(cmd: string): boolean };

function stubExec(result: boolean) {
  const seen: string[] = [];
  doc.execCommand = vi.fn((cmd: string) => {
    seen.push(`${cmd}:${(document.activeElement as HTMLTextAreaElement | null)?.value ?? ""}`);
    return result;
  });
  return seen;
}

afterEach(() => {
  delete nav.clipboard;
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("copies through a selected textarea when the page has no clipboard API (plain http)", async () => {
    const seen = stubExec(true);
    expect(await copyText("meshcore://abc")).toBe(true);
    expect(seen).toEqual(["copy:meshcore://abc"]);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports a failed copy instead of pretending it worked", async () => {
    stubExec(false);
    expect(await copyText("abc")).toBe(false);
  });

  it("reports a failure when the browser throws on copy", async () => {
    doc.execCommand = vi.fn(() => {
      throw new Error("not allowed");
    });
    expect(await copyText("abc")).toBe(false);
  });

  it("uses the clipboard API when it is there, without the fallback", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    nav.clipboard = { writeText };
    const seen = stubExec(true);
    expect(await copyText("key")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("key");
    expect(seen).toEqual([]);
  });

  it("falls back when the clipboard API refuses", async () => {
    nav.clipboard = { writeText: () => Promise.reject(new Error("denied")) };
    const seen = stubExec(true);
    expect(await copyText("key")).toBe(true);
    expect(seen).toEqual(["copy:key"]);
  });

  it("gives focus back to what had it", async () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    stubExec(true);
    await copyText("x");
    expect(document.activeElement).toBe(button);
    button.remove();
  });
});
