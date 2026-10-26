/** Advanced step (optional): the four setting blocks with their recommendation and undo, the radio preset, and the live "what will change" column. */
import { Fragment, type ComponentChildren } from "preact";
import { stepName } from "../app/Stepper";
import {
  allowanceOf,
  BLOCKS,
  blockChanges,
  isBlockRecommended,
  rawOf,
  recommendedFor,
  recommendedForAll,
  same,
  undoBlock,
  type Block,
} from "../core/blocks";
import { checkOwnerInfo, OWNER_INFO_MAX } from "../core/naming";
import { summarize, type Plan } from "../core/plan";
import { FLOOD_ALLOWANCE, SETTINGS, validateSetting, type SettingDef, type SettingKey } from "../core/settings";
import { t } from "../i18n/t";
import { busy, store, type Step } from "../state/store";
import { AccessList } from "./settings/AccessList";
import { MiniMap } from "./settings/MiniMap";
import { RadioFields } from "./settings/RadioFields";
import { RepeaterValue } from "./settings/RepeaterValue";
import { SiteChoices } from "./Site";

// Owner info is on the Name step and the passwords on Send; only the four blocks are here.
const keysOf = (block: Block) => SETTINGS.filter((d) => d.card === block);

const setSetting = (key: SettingKey, value: string | number) => {
  const plan = store.plan.peek();
  store.plan.value = { ...plan, settings: { ...plan.settings, [key]: value } };
};

/** Differs from the start plan; the admin password counts as soon as it holds text (it is never read). */
function isChanged(plan: Plan, start: Plan, key: SettingKey): boolean {
  if (key === "adminPassword") return rawOf(plan, key).trim() !== "";
  return !same(rawOf(plan, key), rawOf(start, key));
}

type CardState = { kind: "unchanged" } | { kind: "recommended" } | { kind: "changes"; count: number };

/** A block's badge: changes counted against the start plan, "recommended" when its button would change nothing. */
function blockState(plan: Plan, start: Plan, block: Block): CardState {
  const count = blockChanges(plan, start, block);
  if (count === 0) return { kind: "unchanged" };
  return isBlockRecommended(plan, block) ? { kind: "recommended" } : { kind: "changes", count };
}

function Badge({ state }: { state: CardState }) {
  if (state.kind === "unchanged") return <span class="badge">{t("settings.badge.unchanged")}</span>;
  if (state.kind === "recommended") return <span class="badge ok">{t("settings.badge.recommended")}</span>;
  return <span class="badge warn">{t("changes", { count: state.count })}</span>;
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

/** `control` swaps the input for a custom one (given whether the field is invalid); the label line, errors and help stay. */
export function SettingField({ def, control }: { def: SettingDef; control?: (invalid: boolean) => ComponentChildren }) {
  const plan = store.plan.value;
  const raw = rawOf(plan, def.key);
  const snapshot = store.snapshot.value;
  const result = validateSetting(def.key, raw);
  // The counter and the error count what is sent (trimmed, newlines as '|'), as the Apply gate does.
  const owner = def.key === "ownerInfo" ? checkOwnerInfo(result.ok ? String(result.value) : raw.trim()) : null;
  const ownerBad = !!owner && result.ok && !owner.ok;
  const error = !result.ok ? t(`error.${result.errorKey}`) : ownerBad ? t("error.ownerInfoTooLong") : null;
  const was = snapshot?.settings[def.key];
  const showWas = def.key !== "adminPassword" && was !== undefined && !same(raw, was);
  const changed = isChanged(plan, store.startPlan.value, def.key);
  return (
    <div class={`field${changed ? " changed" : ""}${error ? " invalid" : ""}`} data-key={def.key}>
      <div class="label-line">
        <label class="field-label" for={`set-${def.key}`} id={`lbl-${def.key}`}>
          {t(`setting.${def.key}`)}
        </label>
        {showWas ? <RepeaterValue value={String(was)} onRestore={() => setSetting(def.key, was!)} /> : null}
      </div>
      {control ? control(!!error) : <Control def={def} raw={raw} invalid={!!error} />}
      {owner ? (
        <span class={`sub counter${owner.ok ? "" : " over"}`}>
          {t("settings.ownerInfo.bytes", {
            bytes: owner.bytes,
            max: OWNER_INFO_MAX,
          })}
        </span>
      ) : null}
      {error ? <span class="field-error">{error}</span> : null}
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
      {current === "tight" ? <span class="sub help">{t("help.allowance.tight")}</span> : null}
    </div>
  );
}

function TimingPills() {
  return (
    <div class="field">
      <span class="field-label">{t("settings.timing")}</span>
      <SiteChoices compact />
    </div>
  );
}

function BlockCard({ block }: { block: Block }) {
  const plan = store.plan.value;
  const start = store.startPlan.value;
  const changes = blockChanges(plan, start, block);
  const name = t(`settings.card.${block}`);
  const undo = t("settings.undo", { block: name });
  return (
    <section class={`card card-${block}`}>
      <header class="card-head">
        <h3>{name}</h3>
        <Badge state={blockState(plan, start, block)} />
        {changes > 0 ? (
          <button
            type="button"
            class="icon undo"
            aria-label={undo}
            title={undo}
            onClick={() => (store.plan.value = undoBlock(store.plan.peek(), store.startPlan.peek(), block))}
          >
            ↺
          </button>
        ) : null}
      </header>
      {block === "radio" ? <RadioFields /> : null}
      {keysOf(block).map((d) => (
        <Fragment key={d.key}>
          {d.key === "floodMaxUnscoped" ? <Pills /> : null}
          {d.key === "txdelay" ? <TimingPills /> : null}
          <SettingField def={d} />
        </Fragment>
      ))}
      <button
        type="button"
        class="btn small"
        onClick={() => (store.plan.value = recommendedFor(store.plan.peek(), block))}
      >
        {t("settings.recommend")}
      </button>
    </section>
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

const goto = (s: Step) => (store.step.value = s);

export function Advanced() {
  const locked = busy.value;
  return (
    <div class="panel-body step-settings">
      <div class="step-head">
        <h2>{t("settings.title")}</h2>
        <button
          type="button"
          class="btn small"
          onClick={() => (store.plan.value = recommendedForAll(store.plan.peek()))}
        >
          {t("settings.recommendAll")}
        </button>
      </div>
      <p class="sub">{t("settings.sub")}</p>
      <div class="settings-layout">
        <div class="settings-main">
          <div class="card-grid">
            {BLOCKS.map((b) => (
              <BlockCard key={b} block={b} />
            ))}
          </div>
          <AccessList />
        </div>
        <aside class="settings-side">
          <MiniMap />
          <Summary />
          <div class="side-nav">
            <button type="button" class="btn" disabled={locked} onClick={() => goto("regions")}>
              {t("step.back")}
            </button>
            <button type="button" class="btn primary" disabled={locked} onClick={() => goto("send")}>
              {t("step.nextButton", { name: stepName("send") })}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
