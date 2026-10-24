/** Step 4: settings cards with help text and change markers, the radio preset, and the live "what will change" column. */
import { stepName } from "../app/Stepper";
import { checkOwnerInfo, OWNER_INFO_MAX } from "../core/naming";
import { defaultPlan, summarize, type Plan } from "../core/plan";
import {
  FLOOD_ALLOWANCE,
  RECOMMENDED_SETTINGS,
  SETTINGS,
  validateSetting,
  type SettingDef,
  type SettingKey,
} from "../core/settings";
import { t } from "../i18n/t";
import { store, type Step } from "../state/store";
import { MiniMap } from "./settings/MiniMap";
import { applyRecommendedRadio, BEMESH_RADIO, RadioFields } from "./settings/RadioFields";


type Card = "access" | "radio" | "advertising" | "owner" | "repeating";
const CARDS: Card[] = ["access", "radio", "advertising", "owner", "repeating"];
/** Expert settings the mockup folds away, besides the SETTINGS "advanced" card. */
const EXPERT_EXTRA: SettingKey[] = ["pathHashMode", "txdelay", "directTxdelay"];
const isExpert = (d: SettingDef) => d.card === "advanced" || EXPERT_EXTRA.includes(d.key);
const keysOf = (card: Card) => SETTINGS.filter((d) => d.card === card && !isExpert(d));
const EXPERT = SETTINGS.filter(isExpert);
const HOP_KEYS: SettingKey[] = ["floodMaxUnscoped", "floodMaxAdvert"];
const DEFAULTS = defaultPlan();

const BY_KEY = new Map(SETTINGS.map((d) => [d.key, d]));
const rawOf = (plan: Plan, key: SettingKey): string => String(plan.settings[key] ?? BY_KEY.get(key)!.formDefault ?? "");
const defaultOf = (key: SettingKey): string => String(DEFAULTS.settings[key] ?? "");

/** Equal as text, or as numbers when both are numeric ("12" and 12.0). */
function same(a: unknown, b: unknown): boolean {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  return x === y || (x !== "" && y !== "" && Number.isFinite(Number(x)) && Number(x) === Number(y));
}

const sameRadio = (a: Plan["radio"], b: Plan["radio"]) =>
  a.freq === b.freq && a.sf === b.sf && a.bw === b.bw && a.cr === b.cr;

const setSetting = (key: SettingKey, value: string | number) => {
  const plan = store.plan.peek();
  store.plan.value = { ...plan, settings: { ...plan.settings, [key]: value } };
};

/** The hop allowance pill whose pair the plan holds, if any. */
function allowanceOf(plan: Plan): keyof typeof FLOOD_ALLOWANCE | null {
  const found = (Object.keys(FLOOD_ALLOWANCE) as (keyof typeof FLOOD_ALLOWANCE)[]).find(
    (k) =>
      same(rawOf(plan, "floodMaxUnscoped"), FLOOD_ALLOWANCE[k][0]) &&
      same(rawOf(plan, "floodMaxAdvert"), FLOOD_ALLOWANCE[k][1]),
  );
  return found ?? null;
}

const RECOMMENDED: Partial<Record<SettingKey, string | number>> = {
  dutycycle: RECOMMENDED_SETTINGS.dutycycle,
  floodAdvertHours: RECOMMENDED_SETTINGS.floodAdvertHours,
  advertIntervalMinutes: RECOMMENDED_SETTINGS.advertIntervalMinutes,
  floodMax: RECOMMENDED_SETTINGS.floodMax,
  pathHashMode: RECOMMENDED_SETTINGS.pathHashMode,
  loopDetect: RECOMMENDED_SETTINGS.loopDetect,
};

/** How a field differs from what the repeater has (snapshot) or, without one, from the form default. */
function baselineOf(key: SettingKey): string {
  const was = store.snapshot.value?.settings[key];
  return was !== undefined ? String(was) : defaultOf(key);
}

function isChanged(plan: Plan, key: SettingKey): boolean {
  if (key === "adminPassword") return rawOf(plan, key).trim() !== "";
  return !same(rawOf(plan, key), baselineOf(key));
}

type CardState = { kind: "unchanged" } | { kind: "recommended" } | { kind: "changes"; count: number };

/** Badge for a group of fields, measured against the form defaults and the #BEmesh recommendation. */
function cardState(plan: Plan, defs: SettingDef[], withRadio: boolean): CardState {
  const differs = defs.filter((d) =>
    d.key === "adminPassword" ? rawOf(plan, d.key).trim() !== "" : !same(rawOf(plan, d.key), defaultOf(d.key)),
  );
  const radioDiffers = withRadio && !sameRadio(plan.radio, DEFAULTS.radio);
  const count = differs.length + (radioDiffers ? 1 : 0);
  if (count === 0) return { kind: "unchanged" };
  const hasHops = defs.some((d) => HOP_KEYS.includes(d.key));
  const matches = defs.every((d) => {
    if (HOP_KEYS.includes(d.key)) return allowanceOf(plan) !== null;
    return same(rawOf(plan, d.key), RECOMMENDED[d.key] ?? defaultOf(d.key));
  });
  const radioOk = !withRadio || sameRadio(plan.radio, BEMESH_RADIO);
  const hasRecommendation = withRadio || hasHops || defs.some((d) => d.key in RECOMMENDED);
  return matches && radioOk && hasRecommendation ? { kind: "recommended" } : { kind: "changes", count };
}

function Badge({ state }: { state: CardState }) {
  if (state.kind === "unchanged") return <span class="badge">{t("settings.badge.unchanged")}</span>;
  if (state.kind === "recommended") return <span class="badge ok">{t("settings.badge.recommended")}</span>;
  return <span class="badge warn">{t("changes", { count: state.count })}</span>;
}

function applyRecommendedSettings(): void {
  const plan = store.plan.peek();
  const pill = allowanceOf(plan) ?? "average";
  const [unscoped, advert] = FLOOD_ALLOWANCE[pill];
  store.plan.value = {
    ...plan,
    settings: {
      ...plan.settings,
      ...RECOMMENDED,
      dutycycle: RECOMMENDED_SETTINGS.dutycycle,
      floodMaxUnscoped: unscoped,
      floodMaxAdvert: advert,
    },
  };
}

function Segmented({ def, value }: { def: SettingDef; value: string }) {
  return (
    <div class="segmented" role="group" aria-labelledby={`lbl-${def.key}`}>
      {def.options!.map((o) => (
        <button type="button" key={o} aria-pressed={value === o} onClick={() => setSetting(def.key, o)}>
          {t(`opt.${def.key}.${o}`)}
        </button>
      ))}
    </div>
  );
}

function Control({ def, raw, invalid }: { def: SettingDef; raw: string; invalid: boolean }) {
  const id = `set-${def.key}`;
  const common = { id, "aria-invalid": invalid || undefined };
  const onInput = (e: Event) => setSetting(def.key, (e.currentTarget as HTMLInputElement).value);
  if (def.key === "ownerInfo") {
    return (
      <textarea {...common} rows={4} value={raw} placeholder={t("settings.ownerInfo.placeholder")} onInput={onInput} />
    );
  }
  if (def.key === "adminPassword") {
    return (
      <input
        {...common}
        type="password"
        autocomplete="new-password"
        value={raw}
        placeholder={t("settings.adminPassword.placeholder")}
        onInput={onInput}
      />
    );
  }
  if (def.key === "guestPassword") {
    return (
      <input
        {...common}
        type="text"
        autocomplete="off"
        value={raw}
        placeholder={t("settings.none")}
        onInput={onInput}
      />
    );
  }
  if (def.key === "dutycycle") {
    return (
      <select {...common} value={raw} onChange={onInput}>
        {def.options!.map((o) => (
          <option key={o} value={o}>
            {t(`opt.dutycycle.${o}`)}
          </option>
        ))}
      </select>
    );
  }
  if (def.options) return <Segmented def={def} value={raw} />;
  return (
    <input
      {...common}
      type="text"
      inputMode="decimal"
      value={raw}
      placeholder={String(def.formDefault ?? "")}
      onInput={onInput}
    />
  );
}

function SettingField({ def }: { def: SettingDef }) {
  const plan = store.plan.value;
  const raw = rawOf(plan, def.key);
  const snapshot = store.snapshot.value;
  const result = validateSetting(def.key, raw);
  const ownerBad = def.key === "ownerInfo" && result.ok && !checkOwnerInfo(raw).ok;
  const error = !result.ok ? t(`error.${result.errorKey}`) : ownerBad ? t("error.ownerInfoTooLong") : null;
  const was = snapshot?.settings[def.key];
  const showWas = def.key !== "adminPassword" && was !== undefined && !same(raw, was);
  const changed = isChanged(plan, def.key);
  const owner = def.key === "ownerInfo" ? checkOwnerInfo(raw) : null;
  return (
    <div class={`field${changed ? " changed" : ""}${error ? " invalid" : ""}`} data-key={def.key}>
      <label class="field-label" for={`set-${def.key}`} id={`lbl-${def.key}`}>
        {t(`setting.${def.key}`)}
      </label>
      <Control def={def} raw={raw} invalid={!!error} />
      {owner ? (
        <span class={`sub counter${owner.ok ? "" : " over"}`}>
          {t("settings.ownerInfo.bytes", {
            bytes: owner.bytes,
            max: OWNER_INFO_MAX,
          })}
        </span>
      ) : null}
      {error ? <span class="field-error">{error}</span> : null}
      {showWas ? <span class="sub was">{t("settings.was", { value: String(was) })}</span> : null}
      <span class="sub help">{t(def.helpKey)}</span>
    </div>
  );
}

function Pills() {
  const current = allowanceOf(store.plan.value);
  return (
    <div class="field">
      <span class="field-label" id="lbl-allowance">
        {t("settings.hopAllowance")}
      </span>
      <div class="pills" role="group" aria-labelledby="lbl-allowance">
        {(Object.keys(FLOOD_ALLOWANCE) as (keyof typeof FLOOD_ALLOWANCE)[]).map((k) => (
          <button
            type="button"
            class="pill"
            key={k}
            aria-pressed={current === k}
            onClick={() => {
              const [unscoped, advert] = FLOOD_ALLOWANCE[k];
              const plan = store.plan.peek();
              store.plan.value = {
                ...plan,
                settings: {
                  ...plan.settings,
                  floodMaxUnscoped: unscoped,
                  floodMaxAdvert: advert,
                },
              };
            }}
          >
            {t(`settings.allowance.${k}`, {
              pair: `${FLOOD_ALLOWANCE[k][0]}/${FLOOD_ALLOWANCE[k][1]}`,
            })}
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsCard({ card }: { card: Card }) {
  const plan = store.plan.value;
  const defs = keysOf(card);
  const state = cardState(plan, defs, card === "radio");
  return (
    <section class={`card card-${card}`}>
      <header class="card-head">
        <h3>{t(`settings.card.${card}`)}</h3>
        <Badge state={state} />
      </header>
      {card === "radio" ? <RadioFields /> : null}
      {card === "advertising" ? <Pills /> : null}
      {defs.map((d) => (
        <SettingField key={d.key} def={d} />
      ))}
      {card === "radio" || card === "advertising" ? (
        <button
          type="button"
          class="btn small"
          onClick={card === "radio" ? applyRecommendedRadio : applyRecommendedSettings}
        >
          {t("settings.recommend")}
        </button>
      ) : null}
    </section>
  );
}

function AdvancedBar() {
  const plan = store.plan.value;
  const changed = EXPERT.filter((d) => !same(rawOf(plan, d.key), defaultOf(d.key))).length;
  return (
    <details class="advanced">
      <summary>
        <strong>{t("settings.advanced")}</strong>
        <span class="sub"> · {t("settings.advanced.sub", { count: EXPERT.length })}</span>
        {changed ? (
          <span class="badge warn">{t("changes", { count: changed })}</span>
        ) : (
          <span class="badge ok">{t("settings.advanced.allRecommended")}</span>
        )}
      </summary>
      <div class="card-grid">
        {EXPERT.map((d) => (
          <SettingField key={d.key} def={d} />
        ))}
      </div>
    </details>
  );
}

function Summary() {
  const plan = store.plan.value;
  const { changes, adminPassword } = summarize(plan, store.snapshot.value ?? undefined);
  return (
    <section class="card summary">
      <h3 class="field-label">
        {`${t("settings.summary.title")} · ${changes.length}`}
      </h3>
      <ul class="summary-list">
        {changes.map((c) => (
          <li key={`${c.group}-${c.labelKey}`} class="sum-item">
            <span class="sum-label">{t(`summary.${c.labelKey}`)}</span>
            <span class="sub">{c.from !== undefined ? `${c.from} → ${c.to}` : `→ ${c.to}`}</span>
          </li>
        ))}
        <li class="sum-item kept">
          <span class="sum-label">{t(`summary.adminPassword.${adminPassword}`)}</span>
        </li>
      </ul>
    </section>
  );
}

const goto = (n: Step) => (store.step.value = n);

export function Settings() {
  const reading = store.reading.value;
  return (
    <div class="panel-body step-settings">
      <h2>{t("settings.title")}</h2>
      <p class="sub">{t("settings.sub")}</p>
      <div class="settings-layout">
        <div class="settings-main">
          <div class="card-grid">
            {CARDS.map((c) => (
              <SettingsCard key={c} card={c} />
            ))}
          </div>
          <AdvancedBar />
        </div>
        <aside class="settings-side">
          <MiniMap />
          <Summary />
          <div class="side-nav">
            <button type="button" class="btn" disabled={reading} onClick={() => goto(3)}>
              {t("step.back")}
            </button>
            <button type="button" class="btn primary" disabled={reading} onClick={() => goto(5)}>
              {t("step.nextButton", { name: stepName(5) })}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
