/**
 * The repeater's neighbour table (`neighbors`): the repeaters it has heard, newest first. Each
 * line is `<first 4 key bytes in hex>:<seconds since heard>:<SNR × 4>`; `-none-` when it heard
 * none. The firmware cuts the reply at about 134 bytes, so a busy repeater lists its newest only.
 */
import type { MeshNode } from "./geo";

export type Neighbour = { prefix: string; agoS: number; snr: number };

const LINE = /^([0-9a-f]{8}):(\d+):(-?\d+)$/i;

/** The neighbours in the reply; [] for `-none-`, null when nothing in it could be read. */
export function parseNeighbours(reply: string): Neighbour[] | null {
  const text = reply.trim();
  if (text === "-none-") return [];
  const out: Neighbour[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line.trim());
    if (m) out.push({ prefix: m[1].toLowerCase(), agoS: Number(m[2]), snr: Number(m[3]) / 4 });
  }
  return out.length ? out : null;
}

/** The name of the one node whose key starts with `prefix`; null when none or several match. */
export function neighbourName(prefix: string, nodes: MeshNode[] | undefined): string | null {
  const matches = (nodes ?? []).filter((n) => n.public_key?.toLowerCase().startsWith(prefix));
  return matches.length === 1 ? matches[0].adv_name : null;
}
