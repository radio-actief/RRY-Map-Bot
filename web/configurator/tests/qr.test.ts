import { describe, expect, it } from "vitest";
import { qrCode, qrPath } from "../src/core/qr";

const LINK = "meshcore://channel/add?name=%23bemesh&secret=4e92675e10b4a5b3df305e86a6f4f8fa&region_scope=be";

describe("qrCode", () => {
  it("encodes a channel link in a square of modules with the three finder patterns", () => {
    const qr = qrCode(LINK);
    expect(qr.size).toBeGreaterThanOrEqual(21);
    expect((qr.size - 17) % 4).toBe(0);
    // Each finder pattern: a dark 7×7 ring, light ring inside, dark 3×3 core.
    for (const [r, c] of [
      [0, 0],
      [0, qr.size - 7],
      [qr.size - 7, 0],
    ]) {
      expect(qr.dark(r, c)).toBe(true);
      expect(qr.dark(r + 6, c + 6)).toBe(true);
      expect(qr.dark(r + 1, c + 1)).toBe(false);
      expect(qr.dark(r + 3, c + 3)).toBe(true);
    }
  });

  it("gives a different code for a different link", () => {
    const a = qrPath(qrCode(LINK));
    const b = qrPath(qrCode(LINK.replace("be", "be-vwv")));
    expect(a).not.toEqual(b);
  });
});

describe("qrPath", () => {
  it("draws one unit square per dark module", () => {
    const qr = qrCode("x");
    let dark = 0;
    for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) if (qr.dark(r, c)) dark++;
    expect(qrPath(qr).match(/h1v1h-1z/g)?.length).toBe(dark);
  });
});
