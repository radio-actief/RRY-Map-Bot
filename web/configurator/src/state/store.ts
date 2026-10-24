/** App-wide state: Preact signals, step status, apply gate, theme and safe preference storage. */
import { computed, effect, signal } from "@preact/signals";
import { municipalityAt, type LatLon, type MeshNode, type MunicipalityFeature } from "../core/geo";
import type { LocationChoice, Place } from "../core/search";
import { parseVersion, supportsRegionDef } from "../core/firmware";
import { defaultPlan, planErrors, type DeviceSnapshot, type Plan } from "../core/plan";
import { anchorCenter, anchorFromChoice, policyFor, type Anchor, type DeviceRegions } from "../core/regions";
import type { SerialLink } from "../device/serial";
import type { GeoJsonCollection } from "../core/data";
import type { NoticeKind } from "../app/Notice";

const memory = new Map<string, string>();

/** localStorage that never throws; falls back to memory for this session. */
export const prefs = {
  get(key: string): string | null {
    const written = memory.get(key);
    if (written !== undefined) return written;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    memory.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};

export type Step = 1 | 2 | 3 | 4 | 5;
export type Theme = "system" | "light" | "dark";
export type StepStatus = "done" | "current" | "attention" | "todo";

export const THEME_PREF = "configurator.theme";

export type DeviceState = {
  status: "none" | "connecting" | "connected";
  link: SerialLink | null;
  firmware: string | null;
};

export type AppData = {
  places?: Place[];
  municipalities?: MunicipalityFeature[] | GeoJsonCollection;
  provinces?: GeoJsonCollection;
  gewesten?: GeoJsonCollection;
  nodes?: MeshNode[];
  failed: Set<string>;
};

function storedTheme(): Theme {
  const v = prefs.get(THEME_PREF);
  return v === "light" || v === "dark" ? v : "system";
}

export const LAYERS_PREF = "configurator.layers";

function storedLayers(): { nodes: boolean; borders: boolean } {
  try {
    const v = JSON.parse(prefs.get(LAYERS_PREF) ?? "null");
    if (v && typeof v.nodes === "boolean" && typeof v.borders === "boolean") return { nodes: v.nodes, borders: v.borders };
  } catch {
    /* unreadable preference */
  }
  return { nodes: true, borders: true };
}

/** A message shown above the step body, whatever the step (e.g. the repeater was unplugged). */
export type AppNotice = { kind: NoticeKind; text: string };

/** The last Read: how many commands answered and which did not, or why it failed. */
export type LastRead = { ok: true; count: number; missing: string[] } | { ok: false; reason: string };

/**
 * Where Apply stands: refused before sending (no commands, a line over the length limit), checking
 * `ver`, stopped by old or unreadable firmware, sending (progress), stopped at a failed command,
 * failed unexpectedly, or done (with the reboot offer still open or answered).
 */
export type ApplyState =
  | { phase: "idle" }
  | { phase: "empty" }
  | { phase: "tooLong"; lines: string[] }
  | { phase: "checking" }
  | { phase: "old"; version: string }
  | { phase: "unknown" }
  | { phase: "sending"; sent: number; total: number }
  | { phase: "failed"; failedAt: number; total: number; command: string; error: string; remaining: string[] }
  | { phase: "error"; reason: string }
  | { phase: "done"; total: number; offerReboot: boolean; radioChanged: boolean };

/** One line of the command log: a command, a reply, a note, or the separator before an Apply. */
export type LogLine = { text: string; kind: "cmd" | "ok" | "error" | "muted" | "sep" };

const initialPlan = defaultPlan();

export const store = {
  plan: signal<Plan>(initialPlan),
  /** The plan as the last default or Read left it; any other plan counts as edited. */
  planBase: signal<Plan>(initialPlan),
  snapshot: signal<DeviceSnapshot | null>(null),
  /** Region state of the device at the last Read, for the script's removals. */
  deviceRegions: signal<DeviceRegions | undefined>(undefined),
  notice: signal<AppNotice | null>(null),
  /** A Read is running: step navigation and Read are disabled. */
  reading: signal(false),
  lastRead: signal<LastRead | null>(null),
  /** Apply is running: like `reading`, step navigation, Read and device actions are disabled. */
  applying: signal(false),
  apply: signal<ApplyState>({ phase: "idle" }),
  /** A console command or the reboot is in flight (until the link has settled). */
  commandBusy: signal(false),
  /** The session's command log (Apply, the console, and Read when "Show command log" is on). */
  log: signal<LogLine[]>([]),
  device: signal<DeviceState>({ status: "none", link: null, firmware: null }),
  step: signal<Step>(1),
  sheet: signal<"peek" | "half" | "full">("half"),
  layers: signal(storedLayers()),
  theme: signal<Theme>(storedTheme()),
  data: signal<AppData>({ failed: new Set() }),
  drawerOpen: signal(false),
};

export const visited = signal<ReadonlySet<Step>>(new Set<Step>([store.step.peek()]));

effect(() => {
  const s = store.step.value;
  if (!visited.peek().has(s)) visited.value = new Set([...visited.peek(), s]);
});

let firstThemeRun = true;
effect(() => {
  const theme = store.theme.value;
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  if (firstThemeRun) firstThemeRun = false;
  else prefs.set(THEME_PREF, theme);
});

let firstLayersRun = true;
effect(() => {
  const layers = store.layers.value;
  if (firstLayersRun) firstLayersRun = false;
  else prefs.set(LAYERS_PREF, JSON.stringify(layers));
});

export function stepStatus(n: Step): StepStatus {
  const errors = planErrors(store.plan.value);
  const has = (...keys: string[]) => errors.some((e) => keys.includes(e.key));
  let attention = false;
  if (n === 2) attention = has("name", "location");
  else if (n === 3) attention = store.plan.value.anchor === null;
  else if (n === 4) attention = errors.some((e) => e.key !== "name" && e.key !== "location");
  if (store.step.value === n) return "current";
  const seen = visited.value;
  if (attention) return seen.has(n) || seen.has(5) ? "attention" : "todo";
  return seen.has(n) ? "done" : "todo";
}

export const canApply = computed(() => {
  const reasons: string[] = [];
  const { status, firmware } = store.device.value;
  if (status !== "connected") reasons.push("apply.noDevice");
  if (!store.plan.value.anchor) reasons.push("apply.noLocation");
  for (const e of planErrors(store.plan.value)) reasons.push(`error.${e.errorKey}`);
  const version = parseVersion(firmware);
  if (version && !supportsRegionDef(version)) reasons.push("apply.firmwareTooOld");
  return { ok: reasons.length === 0, reasons };
});

/** A Read, an Apply, a console command or the reboot is talking to the device: the UI that could interfere is locked. */
export const busy = computed(() => store.reading.value || store.applying.value || store.commandBusy.value);

/** True once the plan differs from what the last default or Read gave. */
export const dirty = computed(() => store.plan.value !== store.planBase.value);

/** Replace the plan with a fresh one (default or Read) that does not count as edited. */
export function resetPlan(plan: Plan): void {
  store.plan.value = plan;
  store.planBase.value = plan;
}

/** The municipality polygons, whether loaded as a list or a FeatureCollection. */
export const municipalities = computed<MunicipalityFeature[]>(() => {
  const m = store.data.value.municipalities;
  return Array.isArray(m) ? m : ((m?.features ?? []) as MunicipalityFeature[]);
});

const deviceCodes = () => store.deviceRegions.peek()?.named ?? [];

const sameAnchor = (a: Anchor | null, b: Anchor | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.mode === b.mode &&
    a.province_code === b.province_code &&
    (a.place?.city_code ?? null) === (b.place?.city_code ?? null));

/** The municipality at a point as a city anchor; null outside every municipality, undefined while the data is missing. */
export function anchorAt(p: LatLon): Anchor | null | undefined {
  const places = store.data.peek().places;
  const munis = municipalities.peek();
  if (!places?.length || !munis.length) return undefined;
  const f = municipalityAt(p, munis);
  const place = f ? places.find((x) => x.city_code === f.properties.city_code) : undefined;
  return place ? { mode: "city", province_code: place.province_code, place } : null;
}

/** A pin set before the borders loaded; its anchor is resolved once they arrive. */
let unresolved: LatLon | null = null;

/**
 * Move the pin (map click or drag, typed coordinates, "Use my location"); null clears it and
 * keeps the anchor. The anchor follows the municipality under the pin, and the region policy is
 * rebuilt when it changes; outside every municipality the anchor is cleared and the location
 * kept. Before the borders have loaded only the pin moves, and the anchor follows when they arrive.
 */
export function setLocation(p: LatLon | null): void {
  const plan = store.plan.peek();
  const anchor = p ? anchorAt(p) : undefined;
  unresolved = p && anchor === undefined ? p : null;
  if (anchor === undefined || sameAnchor(anchor, plan.anchor)) {
    store.plan.value = { ...plan, location: p };
    return;
  }
  const places = store.data.peek().places ?? [];
  store.plan.value = {
    ...plan,
    location: p,
    anchor,
    regions: anchor ? policyFor(anchor, places, deviceCodes()) : null,
  };
}

effect(() => {
  void store.data.value;
  void municipalities.value;
  const p = unresolved;
  if (!p || store.plan.peek().location !== p || anchorAt(p) === undefined) return;
  setLocation(p);
});

/** Whether a point lies in the chosen municipality, province or (any municipality) Belgium. */
function insideAnchor(p: LatLon, anchor: Anchor): boolean {
  const f = municipalityAt(p, municipalities.peek());
  if (!f) return false;
  if (anchor.mode === "city") return f.properties.city_code === anchor.place?.city_code;
  if (anchor.mode === "province") return f.properties.province_code === anchor.province_code;
  return true;
}

/**
 * A search result: its anchor, fresh regions and its prefix level. The pin moves to the place
 * (or the province / country centre) unless it already lies inside the chosen area, so precise
 * coordinates (e.g. read from the device) are kept.
 */
export function chooseLocation(choice: LocationChoice): void {
  const places = store.data.peek().places ?? [];
  const plan = store.plan.peek();
  const anchor = anchorFromChoice(choice);
  const keep = plan.location && insideAnchor(plan.location, anchor);
  if (!keep) unresolved = null;
  store.plan.value = {
    ...plan,
    anchor,
    location: keep ? plan.location : anchorCenter(anchor, places),
    regions: policyFor(anchor, places, deviceCodes()),
    prefixFormat: anchor.mode,
  };
}
