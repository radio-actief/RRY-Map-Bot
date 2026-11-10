import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { importBackup } from "../src/core/backup";
import { buildScript, commandLines } from "../src/core/cli";
import { handoffFromPlan, isHandoffMessage, regionsFromLines, snapshotFromHandoff, type HandoffMessage } from "../src/core/handoff";
import { planFromSnapshot, type Plan } from "../src/core/plan";
import type { Place } from "../src/core/search";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(process.cwd(), "data/be-locode.json"), "utf8"));
const PARITY = resolve(__dirname, "fixtures/parity");
const plan = (name: string): Plan => importBackup(JSON.parse(readFileSync(resolve(PARITY, `${name}.backup.json`), "utf8")), PLACES);
const KEY = "ab".repeat(32);

/** The lines that travel: the full script without passwords and without the gps advert line. */
const travelling = (p: Plan) =>
  commandLines(buildScript(p, PLACES, { includeDefaults: true })).filter((l) => !/^(set )?(password|guest\.password) /.test(l) && !l.startsWith("gps advert"));

describe("settings hand-off", () => {
  it.each(["ronse-solar", "brussels", "border-deny", "neighbour-deny", "advanced-all", "admin-password"])(
    "%s: what is sent comes back as the same script",
    (name) => {
      const p = plan(name);
      const msg = handoffFromPlan(p, PLACES, "configurator", new Date("2026-11-10T12:00:00Z"));
      expect(isHandoffMessage(msg)).toBe(true);
      const { snapshot, skipped } = snapshotFromHandoff(msg);
      expect(skipped).toEqual([]);
      expect(travelling(planFromSnapshot(snapshot, PLACES))).toEqual(travelling(p));
    },
  );

  it("carries a setting only some boards have when the last Read had it", () => {
    const p = plan("brussels");
    p.settings = { ...p.settings, radioFemRxgain: "off" };
    expect(handoffFromPlan(p, PLACES).settings["radio.fem.rxgain"]).toBeUndefined();
    const board = { settings: { radioFemRxgain: "on" }, missing: [] } as never;
    expect(handoffFromPlan(p, PLACES, "configurator", new Date(), board).settings["radio.fem.rxgain"]).toBe("off");
  });

  it("takes radio.fem.rxgain from NodeBook, but sends it only to a board whose own Read answered", () => {
    const msg = handoffFromPlan(plan("brussels"), PLACES);
    msg.settings["radio.fem.rxgain"] = "off";
    const p = planFromSnapshot(snapshotFromHandoff(msg).snapshot, PLACES);
    expect(p.settings.radioFemRxgain).toBe("off");
    const lines = (board?: object) => commandLines(buildScript(p, PLACES, { includeDefaults: true, board: board as never }));
    expect(lines()).not.toContain("set radio.fem.rxgain off");
    expect(lines({ settings: {}, missing: ["get radio.fem.rxgain"] })).not.toContain("set radio.fem.rxgain off");
    expect(lines({ settings: { radioFemRxgain: "on" }, missing: [] })).toContain("set radio.fem.rxgain off");
  });

  it("never carries passwords, the private key or the clock", () => {
    const p = plan("admin-password");
    const msg = handoffFromPlan(p, PLACES);
    expect(Object.keys(msg.settings)).not.toContain("password");
    expect(Object.keys(msg.settings)).not.toContain("guest.password");
    expect(JSON.stringify(msg)).not.toMatch(/prv\.key|"time"/);
    expect(msg.regions.some((l) => l.startsWith("region remove"))).toBe(false);
  });

  it("sends regions as plain put lines, parents first, never removals", () => {
    const msg = handoffFromPlan(plan("brussels"), PLACES);
    expect(msg.regions.every((l) => /^region (put|allowf|denyf|home|default|save)\b/.test(l))).toBe(true);
    const seen = new Set<string>();
    for (const l of msg.regions.filter((x) => x.startsWith("region put "))) {
      const [, , name, parent] = l.split(" ");
      if (parent) expect(seen.has(parent)).toBe(true);
      seen.add(name);
    }
    expect(msg.regions.at(-1)).toBe("region save");
  });

  it("lists names it does not know, and secrets, as skipped", () => {
    const msg: HandoffMessage = {
      kind: "bemesh.settings",
      v: 1,
      source: "nodebook",
      public_key: KEY,
      at: "2026-11-10T12:00:00Z",
      settings: { name: "BE-GEN-Test", tx: "22", "made.up": "1", password: "secret" },
      regions: ["region put be", "region put be-vov be", "region frobnicate be", "region save"],
    };
    const { snapshot, skipped } = snapshotFromHandoff(msg);
    expect(snapshot.name).toBe("BE-GEN-Test");
    expect(snapshot.publicKey).toBe(KEY);
    expect(skipped).toEqual(["set made.up 1", "set password …", "region frobnicate be"]);
    expect(snapshot.regions?.parents).toEqual({ be: null, "be-vov": "be" });
  });

  it("reads region def the way the firmware does: the cursor follows each name, name|jump moves it", () => {
    const { regions, skipped } = regionsFromLines([
      "region def eu be be-vov|be be-vwv",
      "region allowf *",
      "region denyf be-vwv",
      "region home be-vov",
      "region default be",
      "region save",
    ]);
    expect(skipped).toEqual([]);
    expect(regions).toEqual({
      parents: { eu: null, be: "eu", "be-vov": "be", "be-vwv": "be" },
      allowed: ["*", "eu", "be", "be-vov"],
      denied: ["be-vwv"],
      home: "be-vov",
      default: "be",
    });
  });

  it("skips a region line that names an unknown region", () => {
    expect(regionsFromLines(["region put be-vov nowhere", "region home nowhere"]).skipped).toEqual(["region put be-vov nowhere", "region home nowhere"]);
  });

  it("rejects messages of another kind, with control characters, or too big", () => {
    const ok = handoffFromPlan(plan("brussels"), PLACES);
    expect(isHandoffMessage({ ...ok, kind: "other" })).toBe(false);
    expect(isHandoffMessage({ ...ok, v: 2 })).toBe(false);
    expect(isHandoffMessage({ ...ok, settings: { name: "a\rset password x" } })).toBe(false);
    expect(isHandoffMessage({ ...ok, regions: ["region put a\nregion put b"] })).toBe(false);
    expect(isHandoffMessage({ ...ok, public_key: "not-a-key" })).toBe(false);
    expect(isHandoffMessage({ ...ok, regions: Array(201).fill("region save") })).toBe(false);
  });
});
