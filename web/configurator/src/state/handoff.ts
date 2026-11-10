/**
 * The browser side of the settings hand-off (see core/handoff.ts): this page as the receiver
 * (opened at /configurator?handoff=1 by another tool) or as the sender (it opens the other tool).
 * Messages only count from this site's origin and from the window at the other end.
 */
import { signal } from "@preact/signals";
import { isHandoffMessage, READY, RECEIVED, snapshotFromHandoff, type HandoffMessage } from "../core/handoff";
import type { DeviceSnapshot } from "../core/plan";

/** Settings that arrived and wait for the person to use or drop them. */
export type Incoming = { msg: HandoffMessage; snapshot: DeviceSnapshot; skipped: string[] };
export const incoming = signal<Incoming | null>(null);

const TIMEOUT_MS = 30_000;

/**
 * When this page was opened by another tool with ?handoff=1: says it is ready, takes the one
 * settings message from the opener and confirms it. Returns a stop function.
 */
export function receiveHandoff(win: Window = window): () => void {
  const opener = win.opener as Window | null;
  if (!opener || new URLSearchParams(win.location.search).get("handoff") !== "1") return () => {};
  const origin = win.location.origin;
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== origin || e.source !== opener || !isHandoffMessage(e.data)) return;
    win.removeEventListener("message", onMessage);
    incoming.value = { msg: e.data, ...snapshotFromHandoff(e.data) };
    opener.postMessage({ kind: RECEIVED, v: 1 }, origin);
  };
  win.addEventListener("message", onMessage);
  opener.postMessage({ kind: READY, v: 1 }, origin);
  return () => win.removeEventListener("message", onMessage);
}

export type SendResult = "sent" | "blocked" | "noAnswer";

/**
 * Opens `url` (a page on this site), waits for its `ready`, sends `msg` once and waits for
 * `received`. "blocked" when the browser would not open the window, "noAnswer" after 30 s.
 */
export function sendHandoff(url: string, msg: HandoffMessage, win: Window = window, timeoutMs = TIMEOUT_MS): Promise<SendResult> {
  const target = win.open(url, "_blank");
  if (!target) return Promise.resolve("blocked");
  const origin = win.location.origin;
  return new Promise((resolve) => {
    let sent = false;
    const done = (r: SendResult) => {
      win.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(r);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== target) return;
      const kind = (e.data as { kind?: unknown } | null)?.kind;
      if (kind === READY && !sent) {
        sent = true;
        target.postMessage(msg, origin);
      } else if (kind === RECEIVED && sent) {
        done("sent");
      }
    };
    const timer = setTimeout(() => done("noAnswer"), timeoutMs);
    win.addEventListener("message", onMessage);
  });
}
