/* The device hub (device-hub.html): the site's other tools load it from the map's address in a
 * hidden frame, so tools on other addresses share the device convention with the configurator.
 *
 * From the page that framed it: a message counts only from an origin in the site's tool list
 * (GET /api/v1/site-tools) or the map's own. Device messages go onto this address's
 * BroadcastChannel "bemesh-device" (a "held" one is also kept as the last device); getLast and
 * setLast read and write this address's localStorage "bemesh.device.last". From the channel, every device message goes to that page,
 * once the hub knows its origin from its first valid message. The message list is in DEPLOYMENT.md. */
import { CHANNEL, isDeviceMessage, LAST_KEY, lastFromInput, readLast } from "./shared/device-message.js";
import { isToolUrl } from "./shared/site-urls.js";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Adds the listed tools' origins to `origins`. */
function addToolOrigins(origins, list, here) {
  for (const tool of Array.isArray(list) ? list : []) {
    if (!tool || !isToolUrl(tool.url)) continue;
    try {
      origins.add(new URL(tool.url, here).origin);
    } catch {
      /* not an address */
    }
  }
}

/**
 * Starts the hub. `tools` is a promise of the site's tool list; `win`, `channel` and `storage`
 * are the frame's window, its BroadcastChannel and its localStorage. A message from an origin not
 * known yet waits at most `waitMs` for the list, so every answer comes within 2 s. Resolves once
 * the list is in.
 */
export function startHub({ win, channel, storage, tools, now = Date.now, waitMs = 1500 }) {
  const origins = new Set([new URL(win.location.href).origin]);
  const listed = Promise.resolve(tools)
    .catch(() => [])
    .then((list) => addToolOrigins(origins, list, win.location.href));
  const known = async (origin) => {
    if (origins.has(origin)) return true;
    let timer;
    await Promise.race([listed, new Promise((r) => (timer = setTimeout(r, waitMs)))]);
    clearTimeout(timer);
    return origins.has(origin);
  };
  const remember = (last) => {
    if (!last) return;
    try {
      storage?.setItem(LAST_KEY, JSON.stringify(last));
    } catch {
      /* blocked storage: nothing remembered */
    }
  };
  let parentOrigin = null;
  const toParent = (data) => {
    if (parentOrigin) win.parent.postMessage(data, parentOrigin);
  };

  win.addEventListener("message", async (e) => {
    if (!e || e.source !== win.parent || win.parent === win) return;
    if (!(await known(e.origin)) || (parentOrigin && e.origin !== parentOrigin)) return;
    const data = e.data;
    if (isDeviceMessage(data)) {
      parentOrigin = e.origin;
      // A tool that holds a device: it is the last device, as writeLast would keep it.
      if (data.type === "held") remember(lastFromInput(data, now()));
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
      remember(last);
    }
  });
  channel.onmessage = (e) => {
    if (isDeviceMessage(e.data)) toParent(e.data);
  };
  return listed.then(() => undefined);
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
