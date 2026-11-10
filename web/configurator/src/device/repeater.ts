import { parseVersion, supportsRegionDef } from "../core/firmware";
import { regionNamesToAsk, snapshotFromReplies, type DeviceSnapshot } from "../core/plan";
import { SETTINGS } from "../core/settings";
import { expectsDeviceDisconnect, isErrorReply, type SerialLink } from "./serial";

/** What "Read from the device" asks, in this order (verbatim from the old page). */
export const READ_COMMANDS = [
  "get name",
  "get radio",
  "get repeat",
  "get owner.info",
  "get guest.password",
  "get dutycycle",
  "get flood.advert.interval",
  "get advert.interval",
  "get flood.max.unscoped",
  "get flood.max.advert",
  "get flood.max",
  "get path.hash.mode",
  "get loop.detect",
  "get txdelay",
  "get direct.txdelay",
  "get rxdelay",
  "get radio.rxgain",
  "get radio.fem.rxgain",
  "get tx",
  "get int.thresh",
  "get agc.reset.interval",
  "get multi.acks",
  "get lat",
  "get lon",
  "gps advert",
  "region home",
  "region default",
  "region list allowed",
  "region list denied",
  "region",
  "get acl",
  "neighbors",
  "ver",
  "get role",
  "get public.key",
  "clock",
];

/** Reads of settings only some boards have: a board without one answers an error, which is no missing read. */
export const OPTIONAL_READS = SETTINGS.filter((s) => s.onlyIfRead && s.readCmd).map((s) => s.readCmd!);

/** How many of `commands` the Read got an answer to (an optional read the board lacks does not count). */
export function readCount(snapshot: DeviceSnapshot, commands: string[] = READ_COMMANDS): number {
  const lacking = SETTINGS.filter((s) => s.onlyIfRead && s.readCmd && commands.includes(s.readCmd) && snapshot.settings[s.key] === undefined);
  return commands.length - snapshot.missing.length - lacking.filter((s) => !snapshot.missing.includes(s.readCmd!)).length;
}

/** The reads Apply never changes: the identity, firmware version, clock and the neighbour table. */
export const IDENTITY_READS = ["neighbors", "ver", "get role", "get public.key", "clock"];

/** What the read-back after Apply asks: every read Apply can change. */
export const READ_BACK_COMMANDS = READ_COMMANDS.filter((c) => !IDENTITY_READS.includes(c));

/**
 * Ask every read command (or `commands`). An error reply, a timeout (empty reply) or a lost link
 * puts the command in `missing`; only good replies reach the parser. Region replies the firmware
 * cut off are completed with `region get <name>` (see regionNamesToAsk); `candidates` names the
 * regions to check when the lists may be cut too.
 */
export async function readAll(
  link: SerialLink,
  commands: string[] = READ_COMMANDS,
  candidates: (partial: DeviceSnapshot) => string[] = () => [],
): Promise<DeviceSnapshot> {
  const replies: Record<string, string> = {};
  const missing: string[] = [];
  for (const cmd of commands) {
    if (!link.connected) {
      missing.push(cmd);
      continue;
    }
    try {
      const reply = await link.command(cmd);
      // A board without an optional setting answers an error; a timeout is still a missing read.
      if (reply === "" || isErrorReply(reply)) {
        if (reply === "" || !OPTIONAL_READS.includes(cmd)) missing.push(cmd);
      } else replies[cmd] = reply;
    } catch {
      missing.push(cmd);
    }
  }
  // The firmware cuts the region replies at 159 bytes: ask for the rest one region at a time.
  const ask = regionNamesToAsk(replies, candidates(snapshotFromReplies(replies, missing)));
  for (const name of ask) {
    if (!link.connected) break;
    try {
      const reply = await link.command(`region get ${name}`);
      if (reply && !isErrorReply(reply)) replies[`region get ${name}`] = reply;
    } catch {
      /* link lost: what was read stays */
    }
  }
  return snapshotFromReplies(replies, missing);
}

/**
 * `silent`: the lines that got no reply after every try. A stop after SILENT_STOP such lines in a
 * row has `silent` (that count) and an empty `error`.
 */
export type ApplyResult =
  | { ok: true; silent: string[] }
  | { ok: false; failedAt: number; command: string; error: string; remaining: string[]; silent?: number; silentLines?: string[] };

/** A line that gets no reply is sent up to this many times in all. */
export const APPLY_TRIES = 4;
/** Sending stops after this many lines in a row got no reply. */
export const SILENT_STOP = 3;

/**
 * Send the script line by line. A line that gets no reply is tried again (APPLY_TRIES in all);
 * an error reply or a lost link stops at once, never retried; SILENT_STOP lines in a row without
 * a reply stop too. `onProgress(sent, total)` is called as each line is about to go out, so the
 * failing line is counted. `failedAt` is the 1-based position of the failed line in `lines`;
 * `remaining` are the lines after it.
 */
export async function apply(
  link: SerialLink,
  lines: string[],
  onProgress: (sent: number, total: number) => void,
): Promise<ApplyResult> {
  const silent: string[] = [];
  let inRow = 0;
  for (let i = 0; i < lines.length; i++) {
    const command = lines[i].trim();
    if (!command || command.startsWith("#")) continue;
    onProgress(i + 1, lines.length);
    let error = "";
    let reply = "";
    let tries = 0;
    try {
      for (; tries < APPLY_TRIES && !reply; tries++) {
        reply = await link.command(command);
        // A line that drops the link on purpose answers nothing.
        if (expectsDeviceDisconnect(command)) break;
      }
      // A removal that errors only on a retry may answer a first try that did run (the region is
      // gone now): it counts as no reply. Any other error is a real one.
      if (isErrorReply(reply)) {
        if (tries > 1 && /^region remove /.test(command)) reply = "";
        else error = reply;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    // `gps advert` only exists on builds with GPS support; elsewhere the position lines already did the job.
    if (error && command.startsWith("gps advert ") && /^Unknown command/i.test(error)) continue;
    if (error) return { ok: false, failedAt: i + 1, command, error, remaining: lines.slice(i + 1) };
    if (reply || expectsDeviceDisconnect(command)) {
      inRow = 0;
      continue;
    }
    silent.push(command);
    if (++inRow === SILENT_STOP) {
      return { ok: false, failedAt: i + 1, command, error: "", remaining: lines.slice(i + 1), silent: inRow, silentLines: silent };
    }
  }
  return { ok: true, silent };
}

/**
 * What a stopped Apply left behind: how many of `lines` went through before the failed line
 * (`failedAt`, 1-based), and whether region changes went through without the `region save` that
 * keeps them (the firmware stores regions only on `region save`).
 */
export function stoppedApply(lines: string[], failedAt: number, silent: string[] = []): { done: number; regionsUnsaved: boolean } {
  const sent = lines.slice(0, failedAt - 1).map((l) => l.trim());
  // A region save that got no reply may not have saved anything.
  const saved = sent.includes("region save") && !silent.includes("region save");
  return { done: sent.length, regionsUnsaved: !saved && sent.some((l) => l.startsWith("region ")) };
}

/** One console command; returns the reply text. */
export function run(link: SerialLink, cmd: string): Promise<string> {
  return link.command(cmd);
}

export async function checkFirmware(
  link: SerialLink,
): Promise<{ state: "ok" | "old" | "unknown"; version: string | null }> {
  let reply = "";
  try {
    reply = await link.command("ver");
  } catch {
    /* link lost: unknown */
  }
  const v = parseVersion(reply);
  if (!v) return { state: "unknown", version: null };
  return { state: supportsRegionDef(v) ? "ok" : "old", version: v.text };
}
