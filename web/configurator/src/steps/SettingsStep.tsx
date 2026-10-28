/** Settings step: the setting blocks with their recommendation and undo, the radio preset, and the live "what will change" column. */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { stepName } from "../app/Stepper";
import {
  allowanceOf,
  BLOCKS,
  blockChanges,
  isBlockRecommended,
  followHops,
  rawOf,
  recommendedFor,
  recommendedForAll,
  same,
  setFloodMaxFollow,
  undoBlock,
  withAllowance,
  type Block,
} from "../core/blocks";
import { checkOwnerInfo, OWNER_INFO_MAX } from "../core/naming";
import { summarize, type Plan } from "../core/plan";
import { FLOOD_ALLOWANCE, SETTINGS, validateSetting, type SettingDef, type SettingKey } from "../core/settings";
import { siteOf, timingOf } from "../core/site";
import { hasText, t } from "../i18n/t";
import { busy, store, type Step } from "../state/store";
import { AccessList } from "./settings/AccessList";
import { ChangesBadge } from "./settings/ChangesBadge";
import { MiniMap } from "./settings/MiniMap";
import { RadioFields } from "./settings/RadioFields";
import { RepeaterValue } from "./settings/RepeaterValue";
import { TimingPreset } from "./settings/TimingPreset";

// Owner info is on the Name step and the passwords on Send; only the blocks are here.
const keysOf = (block: Block) => SETTINGS.filter((d) => d.card === block);

/** Hop limits typed onto a preset carry max flood hops along when it follows; a max flood hops of its own stops following. */
const setSetting = (key: SettingKey, value: string | number) => {
  const plan = store.plan.peek();
  const next = { ...plan, settings: { ...plan.settings, [key]: value } };
  store.plan.value = key === "floodMax" ? { ...next, floodMaxFollow: false } : followHops(next);
};

/** Differs from the start plan; the admin password counts as soon as it holds text (it is never read). */
function isChanged(plan: Plan, start: Plan, key: SettingKey): boolean {
  if (key === "adminPassword") return rawOf(plan, key).trim() !== "";
  return !same(rawOf(plan, key), rawOf(start, key));
}

/** "#BEmesh Recommended": green and off when it would change nothing, orange when it would. */
function RecommendButton({ done, label, onApply }: { done: boolean; label: string; onApply: () => void }) {
  return (
    <button type="button" class={`btn tiny rec ${done ? "done" : "todo"}`} disabled={done} onClick={onApply}>
      {label}
    </button>
  );
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

/**
 * `control` swaps the input for a custom one (given whether the field is invalid); the label line, errors and help stay.
 * `recommended` adds a "recommended" tag after the label.
 */
export function SettingField({
  def,
  control,
  recommended,
}: {
  def: SettingDef;
  control?: (invalid: boolean) => ComponentChildren;
  recommended?: boolean;
}) {
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
  const more = `${def.helpKey}.more`;
  const [open, setOpen] = useState(false);
  const label = t(`setting.${def.key}`);
  return (
    <div class={`field${changed ? " changed" : ""}${error ? " invalid" : ""}`} data-key={def.key}>
      <div class="label-line">
        <label class="field-label" for={`set-${def.key}`} id={`lbl-${def.key}`}>
          {label}
        </label>
        {recommended ? <span class="badge ok">{t("setting.recommended")}</span> : null}
        {hasText(more) ? (
          <button
            type="button"
            class="icon info"
            aria-expanded={open}
            aria-controls={`more-${def.key}`}
            aria-label={t("settings.more", { label })}
            onClick={() => setOpen(!open)}
          >
            ⓘ
          </button>
        ) : null}
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
      {open ? (
        <span class="sub help more" id={`more-${def.key}`}>
          {t(more)}
        </span>
      ) : null}
    </div>
  );
}

/** Fine-tune fold: the fields behind a preset, with their values in the summary; open when no preset matches. */
function FineTune({ open, keys, children }: { open: boolean; keys: SettingKey[]; children: ComponentChildren }) {
  const plan = store.plan.value;
  const changed = keys.some((k) => isChanged(plan, store.startPlan.value, k));
  return (
    <details class={`fine-tune${changed ? " changed" : ""}`} open={open}>
      <summary>
        {t("settings.fineTune")} <span class="sub">{keys.map((k) => rawOf(plan, k)).join(" / ")}</span>
      </summary>
      {children}
    </details>
  );
}

const HOPS: SettingKey[] = ["floodMaxUnscoped", "floodMaxAdvert"];
const TIMING: SettingKey[] = ["txdelay", "directTxdelay", "rxdelay"];

function BlockFields({ block }: { block: Block }) {
  const plan = store.plan.value;
  const defs = keysOf(block);
  const fields = (keys: SettingKey[]) =>
    defs.filter((d) => keys.includes(d.key)).map((d) => <SettingField key={d.key} def={d} />);
  if (block === "advertising") {
    return (
      <>
        {fields(["floodAdvertHours", "advertIntervalMinutes"])}
        <Pills />
        <FineTune open={allowanceOf(plan) === null} keys={HOPS}>
          {fields(HOPS)}
        </FineTune>
        <FloodMaxField def={defs.find((d) => d.key === "floodMax")!} />
      </>
    );
  }
  if (block === "timing") {
    return (
      <>
        <TimingPreset />
        <FineTune open={siteOf(timingOf(plan)) === "custom"} keys={TIMING}>
          {fields(TIMING)}
        </FineTune>
      </>
    );
  }
  return (
    <>
      {block === "radio" ? <RadioFields /> : null}
      {defs.map((d) => (
        <SettingField key={d.key} def={d} />
      ))}
    </>
  );
}

/** Max flood hops with its "Follow hop preset" switch; while it follows, the field shows the preset's value. */
function FloodMaxField({ def }: { def: SettingDef }) {
  const plan = store.plan.value;
  const follow = !!plan.floodMaxFollow;
  return (
    <SettingField
      def={def}
      control={(invalid) => (
        <>
          <input
            id="set-floodMax"
            type="text"
            inputMode="decimal"
            aria-invalid={invalid || undefined}
            readOnly={follow}
            value={rawOf(plan, "floodMax")}
            onInput={(e) => setSetting("floodMax", e.currentTarget.value)}
          />
          <label class="toggle">
            <input
              type="checkbox"
              role="switch"
              checked={follow}
              onChange={(e) => (store.plan.value = setFloodMaxFollow(store.plan.peek(), e.currentTarget.checked))}
            />
            {t("settings.floodMaxFollow")}
          </label>
        </>
      )}
    />
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
            onClick={() => (store.plan.value = withAllowance(store.plan.peek(), k))}
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
        <RecommendButton
          done={isBlockRecommended(plan, block)}
          label={t("settings.recommend")}
          onApply={() => (store.plan.value = recommendedFor(store.plan.peek(), block))}
        />
        <ChangesBadge count={changes} />
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
      <BlockFields block={block} />
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

export function SettingsStep() {
  const locked = busy.value;
  return (
    <div class="panel-body step-settings">
      <div class="step-head">
        <h2>{t("settings.title")}</h2>
        <RecommendButton
          done={BLOCKS.every((b) => isBlockRecommended(store.plan.value, b))}
          label={t("settings.recommendAll")}
          onApply={() => (store.plan.value = recommendedForAll(store.plan.peek()))}
        />
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
