/* The device hub (device-hub.html): the site's other tools load it from the map's address in a
 * hidden frame, so tools on other addresses share the device convention with the configurator.
 *
 * From the page that framed it: a message counts only from an origin in the site's tool list
 * (GET /api/v1/site-tools) or the map's own. Device messages go onto this address's
 * BroadcastChannel "bemesh-device"; getLast and setLast read and write this address's
 * localStorage "bemesh.device.last". From the channel, every device message goes to that page,
 * once the hub knows its origin from its first valid message. The message list is in DEPLOYMENT.md. */
import { CHANNEL, isDeviceMessage, LAST_KEY, lastFromInput, readLast } from "./shared/device-message.js";
import { isToolUrl } from "./shared/site-urls.js";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** The origins a framing page may have: the listed tools' and the map's own. */
function allowedOrigins(list, here) {
  const origins = new Set([new URL(here).origin]);
  for (const tool of Array.isArray(list) ? list : []) {
    if (!tool || !isToolUrl(tool.url)) continue;
    try {
      origins.add(new URL(tool.url, here).origin);
    } catch {
      /* not an address */
    }
  }
  return origins;
}

/**
 * Starts the hub. `tools` is a promise of the site's tool list; `win`, `channel` and `storage`
 * are the frame's window, its BroadcastChannel and its localStorage. Resolves once it listens.
 */
export function startHub({ win, channel, storage, tools, now = Date.now }) {
  const allowed = Promise.resolve(tools)
    .catch(() => [])
    .then((list) => allowedOrigins(list, win.location.href));
  let parentOrigin = null;
  const toParent = (data) => {
    if (parentOrigin) win.parent.postMessage(data, parentOrigin);
  };

  win.addEventListener("message", async (e) => {
    if (!e || e.source !== win.parent || win.parent === win) return;
    const origins = await allowed;
    if (!origins.has(e.origin) || (parentOrigin && e.origin !== parentOrigin)) return;
    const data = e.data;
    if (isDeviceMessage(data)) {
      parentOrigin = e.origin;
      try {
        channel.postMessage(data);
      } catch {
        /* channel closed */
      }
    } else if (isObject(data) && data.v === 1 && data.kind === "bemesh.device.getLast") {
      parentOrigin = e.origin;
      toParent({ kind: "bemesh.device.last", v: 1, last: readLast(storage, now()) });
    } else if (isObject(data) && data.v === 1 && data.kind === "bemesh.device.setLast") {
      const last = lastFromInput(data.last, now());
      if (!last) return;
      parentOrigin = e.origin;
      try {
        storage?.setItem(LAST_KEY, JSON.stringify(last));
      } catch {
        /* blocked storage: nothing remembered */
      }
    }
  });
  channel.onmessage = (e) => {
    if (isDeviceMessage(e.data)) toParent(e.data);
  };
  return allowed.then(() => undefined);
}

if (typeof document !== "undefined" && document.documentElement.hasAttribute("data-device-hub")) {
  let storage = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  startHub({
    win: window,
    channel: new BroadcastChannel(CHANNEL),
    storage,
    tools: fetch("/api/v1/site-tools").then((r) => (r.ok ? r.json() : [])),
  });
}
