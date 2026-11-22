/* The device hub (device-hub.html): the site's other tools load it from the map's address in a
 * hidden frame, so tools on other addresses share the device convention with the configurator.
 *
 * From the page that framed it: a message counts only from an origin in the site's tool list
 * (GET /api/v1/site-tools) or the map's own. Device messages go onto this address's
 * BroadcastChannel "bemesh-device" (a "held" one is also kept as the last device); getLast and
 * setLast read and write this address's localStorage "bemesh.device.last". From the channel, every device message goes to that page,
 * once the hub knows its origin from its first valid message.
 *
 * It also tells a listed tool whether someone is signed in on the map ("bemesh.account.query" →
 * "bemesh.account" {signedIn, name}): the display name only, never an id or anything to sign in
 * with, and only to its direct parent from a visible listed origin. It says it again when the state
 * changes: on the record "bemesh.account.seen" another tab's hub (or map page) writes, and when the
 * page comes back into view.
 *
 * To the configurator on an address of its own (the listed "configurator" entry, shown, on another
 * origin than the hub's) it hands the configurator's settings kept on the map's address
 * ("bemesh.configurator.prefs.query" → "bemesh.configurator.prefs"), so the configurator can take
 * them over once. The message list is in DEPLOYMENT.md. */
import { readPrefs } from "./shared/configurator-prefs.js";
import { CHANNEL, isDeviceMessage, LAST_KEY, lastFromInput, readLast } from "./shared/device-message.js";
import { isToolUrl } from "./shared/site-urls.js";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Adds the listed tools' origins to `origins`, and the configurator's own (when it is on another
 * origin than `here`) to `configurator`. */
function addToolOrigins(origins, list, here, configurator) {
  for (const tool of Array.isArray(list) ? list : []) {
    if (!tool || tool.hidden || !isToolUrl(tool.url)) continue;
    try {
      const origin = new URL(tool.url, here).origin;
      origins.add(origin);
      if (tool.key === "configurator" && origin !== new URL(here).origin) configurator.add(origin);
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
export const ACCOUNT_KEY = "bemesh.account.seen";

/** {signedIn, name} from the account check, or signed out for anything else. */
function accountState(raw) {
  if (isObject(raw) && raw.signedIn === true) {
    return { signedIn: true, name: typeof raw.name === "string" && raw.name ? raw.name.slice(0, 64) : null };
  }
  return { signedIn: false, name: null };
}

/** The map's /auth/me as {signedIn, name}: the person's display name, nothing else. */
export async function mapAccount(fetchFn = fetch) {
  const r = await fetchFn("/auth/me", { credentials: "same-origin", cache: "no-store" });
  const me = r.ok ? await r.json() : null;
  if (!me || me.authenticated !== true || !isObject(me.user)) return { signedIn: false, name: null };
  return { signedIn: true, name: me.user.global_name || me.user.username || null };
}

export function startHub({ win, channel, storage, tools, now = Date.now, waitMs = 1500, account = null, accountMs = 3000 }) {
  const origins = new Set([new URL(win.location.href).origin]);
  const configurator = new Set();
  const listed = Promise.resolve(tools)
    .catch(() => [])
    .then((list) => addToolOrigins(origins, list, win.location.href, configurator));
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

  // Who is signed in: asked by the tool, then told again on every change.
  let asked = false;
  let told = null;
  const checkAccount = async () => {
    let timer;
    const state = accountState(
      await Promise.race([
        Promise.resolve()
          .then(() => (account ? account() : null))
          .catch(() => null),
        new Promise((r) => (timer = setTimeout(() => r(null), accountMs))),
      ]),
    );
    clearTimeout(timer);
    const key = JSON.stringify(state);
    if (asked && key !== told) {
      told = key;
      toParent({ kind: "bemesh.account", v: 1, ...state });
    }
    try {
      const seen = JSON.stringify({ signedIn: state.signedIn });
      if (storage?.getItem(ACCOUNT_KEY) !== seen) storage?.setItem(ACCOUNT_KEY, seen);
    } catch {
      /* blocked storage: the other tabs learn it when they look again */
    }
  };
  win.addEventListener("storage", (e) => {
    if (asked && e && e.key === ACCOUNT_KEY) void checkAccount();
  });
  win.document?.addEventListener?.("visibilitychange", () => {
    if (asked && win.document.visibilityState === "visible") void checkAccount();
  });

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
    } else if (isObject(data) && data.v === 1 && data.kind === "bemesh.account.query") {
      parentOrigin = e.origin;
      asked = true;
      told = null; // a query always gets an answer
      await checkAccount();
    } else if (isObject(data) && data.v === 1 && data.kind === "bemesh.configurator.prefs.query") {
      if (!configurator.has(e.origin)) return;
      parentOrigin = e.origin;
      toParent({ kind: "bemesh.configurator.prefs", v: 1, values: readPrefs(storage) });
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
    account: () => mapAccount(),
  });
}
