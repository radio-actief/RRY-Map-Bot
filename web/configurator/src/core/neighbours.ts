/**
 * The repeater's neighbour table (`neighbors`): the repeaters it has heard, newest first. Each
 * line is `<first 4 key bytes in hex>:<seconds since heard>:<SNR × 4>`; `-none-` when it heard
 * none. The firmware cuts the reply at about 134 bytes, so a busy repeater lists its newest only.
 */
import type { MeshNode } from "./geo";

export type Neighbour = { prefix: string; agoS: number; snr: number };

/**
 * One line of the table. The firmware prints the seconds with `%d` from an unsigned difference, so
 * after its clock was set back they come out negative; a line may also carry the console's `>` or
 * `->` and stray spaces. The key prefix is 4 bytes today; longer even-length prefixes are read too.
 */
const LINE = /^(?:-?>\s*)?((?:[0-9a-f]{2}){4,32})\s*:\s*(-?\d+)\s*:\s*(-?\d+)$/i;

/** How well a neighbour is heard, from its SNR: see snrQuality. */
export type SignalQuality = "good" | "fair" | "weak";

/** From this SNR (dB) up a link is good: a clear margin above the noise. */
export const SNR_GOOD_DB = 5;

/**
 * The quality word for an SNR in dB: good from SNR_GOOD_DB, fair above 0 dB, weak at 0 dB or
 * below. Above 0 is what heardWell counts for the timing. LoRa still decodes below 0 (down to
 * about −10 dB at SF8, the #BEmesh radio), but such a link loses packets as soon as the noise rises.
 */
export function snrQuality(snr: number): SignalQuality {
  if (snr >= SNR_GOOD_DB) return "good";
  if (snr > 0) return "fair";
  return "weak";
}

/** The firmware stops adding lines once the reply reaches this many bytes. */
export const NEIGHBOURS_REPLY_LIMIT = 134;

/** The reply reached the firmware's limit, so older neighbours may be left out. */
export function neighboursCut(reply: string): boolean {
  return reply.trim().length >= NEIGHBOURS_REPLY_LIMIT;
}

/** The key prefixes of the neighbours heard with an SNR above 0, at most `maxAgoS` seconds ago. */
export function heardWell(list: Neighbour[], maxAgoS = Infinity): string[] {
  return list.filter((n) => n.snr > 0 && n.agoS <= maxAgoS).map((n) => n.prefix);
}

/** The neighbours in the reply; [] for `-none-`, null when nothing in it could be read. */
export function parseNeighbours(reply: string): Neighbour[] | null {
  const text = reply.trim();
  if (text === "-none-") return [];
  const out: Neighbour[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line.trim());
    if (m) out.push({ prefix: m[1].toLowerCase(), agoS: Math.max(0, Number(m[2])), snr: Number(m[3]) / 4 });
  }
  return out.length ? out : null;
}

/** The name of the one node whose key starts with `prefix`; null when none or several match. */
export function neighbourName(prefix: string, nodes: MeshNode[] | undefined): string | null {
  const matches = (nodes ?? []).filter((n) => n.public_key?.toLowerCase().startsWith(prefix));
  return matches.length === 1 ? matches[0].adv_name : null;
}
