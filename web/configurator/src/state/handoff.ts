/**
 * The browser side of the settings hand-off (see core/handoff.ts): this page as the receiver
 * (opened by another tool at /configurator#handoff=<data>) or as the sender (it opens the other
 * tool at <url>#/handoff?d=<data> in a new tab).
 */
import { signal } from "@preact/signals";
import { decodeHandoff, handoffLink, HANDOFF_MAX_LINK, isHandoffMessage, snapshotFromHandoff, type HandoffMessage } from "../core/handoff";
import type { DeviceSnapshot } from "../core/plan";

/** Settings that arrived and wait for the person to use or drop them. */
export type Incoming = { msg: HandoffMessage; snapshot: DeviceSnapshot; skipped: string[] };
export const incoming = signal<Incoming | null>(null);

const PREFIX = "#handoff=";

/**
 * Reads a hand-off from this page's address once, at load: takes it out of the address (so a
 * reload or a shared link doesn't bring it back) and, when it is a valid message, shows it to the
 * person first. Other fragments (#companion) are left alone.
 */
export function receiveHandoff(win: Window = window): () => void {
  const hash = win.location.hash;
  if (!hash.startsWith(PREFIX)) return () => {};
  try {
    win.history.replaceState(win.history.state, "", win.location.pathname + win.location.search);
  } catch {
    /* the address keeps the fragment; it is read only once anyway */
  }
  const data = hash.length <= PREFIX.length + HANDOFF_MAX_LINK * 2 ? decodeHandoff(hash.slice(PREFIX.length)) : null;
  if (isHandoffMessage(data)) incoming.value = { msg: data, ...snapshotFromHandoff(data) };
  return () => {};
}

export type SendResult = "sent" | "tooLarge";

/**
 * Opens the other tool's hand-off page (`url` is the tool's address, ending in "/") in a new tab
 * without a link back to this one. There is no answer: the other tool asks the person there.
 */
export function sendHandoff(url: string, msg: HandoffMessage, win: Window = window): SendResult {
  const link = handoffLink(url, msg);
  if (!link) return "tooLarge";
  win.open(link, "_blank", "noopener");
  return "sent";
}
