/**
 * Settings handed between the configurator and another tool of the site (NodeBook), which may be on
 * another address, in the address fragment of a new tab: the configurator opens
 * `<nodebook url>#/handoff?d=<data>` and receives `<configurator url>#handoff=<data>`, where <data>
 * is the message as URL-safe base64 of its UTF-8 JSON, without padding. A fragment never reaches a
 * server. The receiver shows what arrived and asks before using it. Nothing is stored.
 *
 * `settings` holds the script's `set <name> <value>` lines as {name: value}; `regions` the full
 * region set as CLI lines, written as for a repeater without regions (no removals). Passwords,
 * the private key and the clock never travel.
 */
import { buildScript, commandLines } from "./cli";
import { hasControlChars } from "./naming";
import { snapshotFromReplies, type DeviceSnapshot, type Plan } from "./plan";
import type { Place } from "./search";
import { SETTINGS } from "./settings";

export const SETTINGS_KIND = "bemesh.settings";
/** The longest link a hand-off may make; a longer one is refused rather than cut off on the way. */
export const HANDOFF_MAX_LINK = 16 * 1024;

export type HandoffMessage = {
  kind: typeof SETTINGS_KIND;
  v: 1;
  source: string;
  public_key: string | null;
  at: string;
  settings: Record<string, string>;
  regions: string[];
};

/** `set` names that never travel. */
const SECRET = new Set(["password", "guest.password", "prv.key"]);
const MAX_LINES = 200;
const MAX_TEXT = 300;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const plainText = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.length <= max && !hasControlChars(v);

/** Whether `data` is a settings hand-off this page can read. */
export function isHandoffMessage(data: unknown): data is HandoffMessage {
  if (!isObject(data) || data.kind !== SETTINGS_KIND || data.v !== 1) return false;
  if (!plainText(data.source, 40) || !plainText(data.at, 40)) return false;
  if (data.public_key !== null && !(typeof data.public_key === "string" && /^[0-9a-f]{64}$/i.test(data.public_key))) return false;
  if (!isObject(data.settings) || Object.keys(data.settings).length > MAX_LINES) return false;
  if (!Object.entries(data.settings).every(([k, v]) => plainText(k, 40) && plainText(v))) return false;
  return Array.isArray(data.regions) && data.regions.length <= MAX_LINES && data.regions.every((l) => plainText(l));
}

/** The message as URL-safe base64 of its UTF-8 JSON, without padding. */
export function encodeHandoff(msg: HandoffMessage): string {
  const bytes = new TextEncoder().encode(JSON.stringify(msg));
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What a base64url text holds as JSON; null when it is not base64url of UTF-8 JSON. Check it with isHandoffMessage. */
export function decodeHandoff(text: string): unknown {
  if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

/** NodeBook's page for a hand-off (`url` ends in "/"); null when the link would be too long. */
export function handoffLink(url: string, msg: HandoffMessage): string | null {
  const link = `${url}#/handoff?d=${encodeHandoff(msg)}`;
  return link.length > HANDOFF_MAX_LINK ? null : link;
}

/** The hand-off for a plan: every setting of the full script (also firmware defaults) and its region set. */
export function handoffFromPlan(
  plan: Plan,
  places: Place[],
  source = "configurator",
  now = new Date(),
  board?: DeviceSnapshot | null,
): HandoffMessage {
  // `board` (the last Read) lets a setting only some boards have go along, as in the script.
  const lines = commandLines(buildScript(plan, places, { includeDefaults: true, board: board ?? undefined }));
  const settings: Record<string, string> = {};
  const regions: string[] = [];
  for (const line of lines) {
    if (line.startsWith("region ")) {
      regions.push(line);
      continue;
    }
    const m = /^set (\S+) (.*)$/.exec(line);
    if (m && !SECRET.has(m[1])) settings[m[1]] = m[2];
  }
  const key = plan.nodeKey && /^[0-9a-f]{64}$/i.test(plan.nodeKey) ? plan.nodeKey.toLowerCase() : null;
  return { kind: SETTINGS_KIND, v: 1, source, public_key: key, at: now.toISOString(), settings, regions: plainRegionLines(regions) };
}

/**
 * The same region set as plain lines: one `region put <name> [<parent>]` per region, parents
 * first, then the flood lines, home, default and save. Any tool can read these without knowing
 * the firmware's compact `region def` form.
 */
export function plainRegionLines(lines: string[]): string[] {
  const { regions } = regionsFromLines(lines);
  if (!regions) return [];
  const parents = regions.parents ?? {};
  const out: string[] = [];
  const done = new Set<string>();
  const put = (name: string, depth = 0) => {
    if (done.has(name) || depth > 32) return;
    const parent = parents[name];
    if (parent) put(parent, depth + 1);
    done.add(name);
    out.push(parent ? `region put ${name} ${parent}` : `region put ${name}`);
  };
  Object.keys(parents).forEach((n) => put(n));
  if (regions.allowed.includes("*")) out.push("region allowf *");
  for (const n of regions.denied) out.push(`region denyf ${n}`);
  if (regions.home) out.push(`region home ${regions.home}`);
  if (regions.default) out.push(`region default ${regions.default}`);
  out.push("region save");
  return out;
}

type Regions = NonNullable<DeviceSnapshot["regions"]>;

/**
 * The regions a repeater without regions would end up with after these lines, as a Read reports
 * them; lines that are not a region definition, flood setting, home, default or save are skipped.
 * `region def` follows the firmware: each name goes under the cursor (starting at *), and
 * `name|jump` moves the cursor to `jump` instead of to `name`.
 */
export function regionsFromLines(lines: string[]): { regions: Regions | undefined; skipped: string[] } {
  const parents: Record<string, string | null> = {};
  const deny = new Set<string>();
  let home: string | undefined;
  let def: string | undefined;
  let star: "allow" | "deny" | undefined;
  const skipped: string[] = [];
  const known = (n: string) => n === "*" || Object.prototype.hasOwnProperty.call(parents, n);
  const define = (name: string, parent: string) => {
    parents[name] = parent === "*" ? null : parent;
    deny.delete(name);
  };

  for (const raw of lines) {
    const line = raw.trim();
    const parts = line.split(/\s+/);
    if (parts[0] !== "region") {
      skipped.push(line);
      continue;
    }
    const [, verb, a, b] = parts;
    if (verb === "def" && parts.length > 2) {
      let cursor = "*";
      let ok = true;
      for (const tok of parts.slice(2)) {
        const [name, jump] = tok.split("|");
        if (!name || name === "*" || (jump !== undefined && !(jump === name || known(jump)))) {
          ok = false;
          break;
        }
        define(name, cursor);
        cursor = jump ?? name;
      }
      if (!ok) skipped.push(line);
    } else if (verb === "put" && a && a !== "*" && parts.length <= 4 && (!b || known(b))) {
      define(a, b ?? "*");
    } else if ((verb === "allowf" || verb === "denyf") && a && known(a) && parts.length === 3) {
      if (a === "*") star = verb === "allowf" ? "allow" : "deny";
      else if (verb === "denyf") deny.add(a);
      else deny.delete(a);
    } else if (verb === "home" && a && known(a) && parts.length === 3) {
      home = a;
    } else if (verb === "default" && a && (a === "<null>" || known(a)) && parts.length === 3) {
      def = a;
    } else if (verb === "save" && parts.length === 2) {
      /* the receiver saves when it sends */
    } else {
      skipped.push(line);
    }
  }

  const names = Object.keys(parents);
  if (!names.length && star === undefined && home === undefined && def === undefined) return { regions: undefined, skipped };
  const allowed = names.filter((n) => !deny.has(n));
  const denied = names.filter((n) => deny.has(n));
  if (star === "allow") allowed.unshift("*");
  if (star === "deny") denied.unshift("*");
  return {
    regions: { allowed, denied, parents, ...(home ? { home } : {}), ...(def ? { default: def } : {}) },
    skipped,
  };
}

/**
 * What a hand-off holds, as if read from a repeater: name, radio, position and every known
 * setting, plus its regions. Names the configurator does not know, and secrets, are skipped.
 */
export function snapshotFromHandoff(msg: HandoffMessage): { snapshot: DeviceSnapshot; skipped: string[] } {
  const replies: Record<string, string> = {};
  const skipped: string[] = [];
  const readOf = new Map(SETTINGS.filter((d) => d.readCmd).map((d) => [d.cliKey, d.readCmd!]));
  for (const [name, value] of Object.entries(msg.settings)) {
    if (name === "name" || name === "radio" || name === "lat" || name === "lon") replies[`get ${name}`] = value;
    else if (!SECRET.has(name) && readOf.has(name)) replies[readOf.get(name)!] = value;
    else skipped.push(`set ${name} ${SECRET.has(name) ? "…" : value}`);
  }
  const snapshot = snapshotFromReplies(replies);
  const r = regionsFromLines(msg.regions);
  if (r.regions) snapshot.regions = r.regions;
  if (msg.public_key) snapshot.publicKey = msg.public_key.toLowerCase();
  return { snapshot, skipped: [...skipped, ...r.skipped] };
}
