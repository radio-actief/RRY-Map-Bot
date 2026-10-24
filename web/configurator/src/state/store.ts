/** App-wide state: Preact signals, step status, apply gate, theme and safe preference storage. */
import { computed, effect, signal } from "@preact/signals";
import type { MeshNode, MunicipalityFeature } from "../core/geo";
import type { Place } from "../core/search";
import { parseVersion, supportsRegionDef } from "../core/firmware";
import { defaultPlan, planErrors, type DeviceSnapshot, type Plan } from "../core/plan";
import type { SerialLink } from "../device/serial";
import type { GeoJsonCollection } from "../core/data";

const memory = new Map<string, string>();

/** localStorage that never throws; falls back to memory for this session. */
export const prefs = {
  get(key: string): string | null {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) return v;
    } catch {
      /* storage unavailable */
    }
    return memory.get(key) ?? null;
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

export const store = {
  plan: signal<Plan>(defaultPlan()),
  snapshot: signal<DeviceSnapshot | null>(null),
  device: signal<DeviceState>({ status: "none", link: null, firmware: null }),
  step: signal<Step>(1),
  sheet: signal<"peek" | "half" | "full">("half"),
  layers: signal({ nodes: true, borders: true }),
  theme: signal<Theme>(storedTheme()),
  data: signal<AppData>({ failed: new Set() }),
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
  for (const e of planErrors(store.plan.value)) reasons.push(`error.${e.errorKey}`);
  const version = parseVersion(firmware);
  if (version && !supportsRegionDef(version)) reasons.push("apply.firmwareTooOld");
  return { ok: reasons.length === 0, reasons };
});
