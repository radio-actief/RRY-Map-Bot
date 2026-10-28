import { parseVersion, supportsRegionDef } from "../core/firmware";
import { regionNamesToAsk, snapshotFromReplies, type DeviceSnapshot } from "../core/plan";
import { isErrorReply, type SerialLink } from "./serial";

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
  "ver",
  "get role",
  "get public.key",
  "clock",
];

/** The reads Apply never changes: the identity, firmware version and clock. */
export const IDENTITY_READS = ["ver", "get role", "get public.key", "clock"];

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
      if (reply === "" || isErrorReply(reply)) missing.push(cmd);
      else replies[cmd] = reply;
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

export type ApplyResult =
  | { ok: true }
  | { ok: false; failedAt: number; command: string; error: string; remaining: string[] };

/**
 * Send the script line by line, stopping at the first failure (never retries). `onProgress(sent,
 * total)` is called as each line is about to go out, so the failing line is counted. `failedAt` is
 * the 1-based position of the failed line in `lines`; `remaining` are the lines after it.
 */
export async function apply(
  link: SerialLink,
  lines: string[],
  onProgress: (sent: number, total: number) => void,
): Promise<ApplyResult> {
  for (let i = 0; i < lines.length; i++) {
    const command = lines[i].trim();
    if (!command || command.startsWith("#")) continue;
    onProgress(i + 1, lines.length);
    let error = "";
    try {
      const reply = await link.command(command);
      if (isErrorReply(reply)) error = reply;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (error) return { ok: false, failedAt: i + 1, command, error, remaining: lines.slice(i + 1) };
  }
  return { ok: true };
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
