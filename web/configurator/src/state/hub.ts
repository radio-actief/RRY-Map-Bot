/**
 * The map's device hub (device-hub.html on the map's address) in a hidden frame, for the
 * configurator on an address of its own: through it the configurator shares the device convention
 * (state/devicebus.ts) with the tools on the map's address, as NodeBook and MeshMate do, and takes
 * its settings over once (state/moved.ts). Opened only when the server names the hub for this page
 * (SITE.hub: the configurator shown on its own address); on the map's own address there is none.
 */

export type Hub = {
  /** Posts a message to the hub (held back until the frame has loaded). */
  send(data: unknown): void;
  /** Calls `fn` with every message the hub posts to this page; returns the way to stop. */
  listen(fn: (data: unknown) => void): () => void;
  /** Sends `data` and resolves the first answer of `kind`, or null after `ms`. */
  ask(data: unknown, kind: string, ms?: number): Promise<Record<string, unknown> | null>;
  close(): void;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Opens the hub at `url` in a hidden frame of `doc`. */
export function openHub(url: string, doc: Document = document, win: Window = window): Hub {
  const origin = new URL(url).origin;
  const frame = doc.createElement("iframe");
  frame.src = url;
  frame.hidden = true;
  frame.title = "#BEmesh device hub";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  let loaded = false;
  const queue: unknown[] = [];
  const listeners = new Set<(data: unknown) => void>();
  const deliver = (data: unknown) => {
    try {
      frame.contentWindow?.postMessage(data, origin);
    } catch {
      /* frame gone */
    }
  };
  frame.addEventListener("load", () => {
    loaded = true;
    for (const data of queue.splice(0)) deliver(data);
  });
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== origin || !frame.contentWindow || e.source !== frame.contentWindow) return;
    for (const fn of Array.from(listeners)) fn(e.data);
  };
  win.addEventListener("message", onMessage);
  doc.body.appendChild(frame);
  const hub: Hub = {
    send(data) {
      if (loaded) deliver(data);
      else queue.push(data);
    },
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    ask(data, kind, ms = 5000) {
      return new Promise((resolve) => {
        const done = (v: Record<string, unknown> | null) => {
          clearTimeout(timer);
          stop();
          resolve(v);
        };
        const stop = hub.listen((m) => {
          if (isObject(m) && m.v === 1 && m.kind === kind) done(m);
        });
        const timer = setTimeout(() => done(null), ms);
        hub.send(data);
      });
    },
    close() {
      win.removeEventListener("message", onMessage);
      listeners.clear();
      frame.remove();
    },
  };
  return hub;
}
