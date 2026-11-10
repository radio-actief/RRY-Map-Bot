import { describe, expect, it } from "vitest";
import { heardWell, neighbourName, neighboursCut, parseNeighbours } from "../src/core/neighbours";
import type { MeshNode } from "../src/core/geo";

const node = (adv_name: string, public_key: string): MeshNode => ({ adv_name, public_key, type: 2, adv_lat: 50.7, adv_lon: 3.6 });

describe("parseNeighbours", () => {
  it("reads each line: key prefix, seconds since heard, SNR (the firmware sends SNR × 4)", () => {
    expect(parseNeighbours("a1b2c3d4:300:28\n5E6F7A8B:7200:-10")).toEqual([
      { prefix: "a1b2c3d4", agoS: 300, snr: 7 },
      { prefix: "5e6f7a8b", agoS: 7200, snr: -2.5 },
    ]);
  });

  it("-none- is an empty table", () => {
    expect(parseNeighbours("-none-")).toEqual([]);
  });

  it("skips lines it cannot read and gives null when nothing could be read", () => {
    expect(parseNeighbours("a1b2c3d4:300:28\ngarbage\n")).toEqual([{ prefix: "a1b2c3d4", agoS: 300, snr: 7 }]);
    expect(parseNeighbours("Unknown command")).toBeNull();
    expect(parseNeighbours("")).toBeNull();
  });
});

describe("neighbourName", () => {
  const nodes = [node("BE-RON-Proefberg", "A1B2C3D4ffff"), node("BE-GNT-Twin1", "99887766aaaa"), node("BE-GNT-Twin2", "99887766bbbb")];

  it("names a neighbour from the node list by its key prefix, in any case", () => {
    expect(neighbourName("a1b2c3d4", nodes)).toBe("BE-RON-Proefberg");
  });

  it("gives null when no node or more than one node matches", () => {
    expect(neighbourName("00000000", nodes)).toBeNull();
    expect(neighbourName("99887766", nodes)).toBeNull();
    expect(neighbourName("a1b2c3d4", undefined)).toBeNull();
  });
});

describe("heardWell", () => {
  it("keeps the key prefixes heard with an SNR above 0", () => {
    const list = parseNeighbours("a1b2c3d4:300:28\n5e6f7a8b:7200:-10\n11223344:5:0\n99887766:9:1")!;
    expect(heardWell(list)).toEqual(["a1b2c3d4", "99887766"]);
  });
});

describe("neighboursCut", () => {
  const line = (i: number) => `${String(i).padStart(8, "0")}:1234:20`;

  it("a reply that reached the firmware's 134 bytes may leave out older neighbours", () => {
    const long = Array.from({ length: 8 }, (_, i) => line(i)).join("\n");
    expect(long.length).toBeGreaterThanOrEqual(134);
    expect(neighboursCut(long)).toBe(true);
  });

  it("a shorter reply is the whole table", () => {
    expect(neighboursCut(Array.from({ length: 3 }, (_, i) => line(i)).join("\n"))).toBe(false);
    expect(neighboursCut("-none-")).toBe(false);
  });
});
