/** The radio card's preset select and the four custom radio fields. */
import { useState } from "preact/hooks";
import { defaultPlan, type Plan } from "../../core/plan";
import {
  BEMESH_PRESET_TITLE,
  parseRadioField,
  presetForRadio,
  RADIO_PRESETS,
  type RadioFieldId,
  type RadioPreset,
} from "../../core/presets";
import { RECOMMENDED_SETTINGS } from "../../core/settings";
import { t } from "../../i18n/t";
import { store } from "../../state/store";

const CUSTOM = "custom";
const FIELDS: { id: RadioFieldId; label: string }[] = [
  { id: "freq", label: "settings.radio.freq" },
  { id: "bw", label: "settings.radio.bw" },
  { id: "sf", label: "settings.radio.sf" },
  { id: "cr", label: "settings.radio.cr" },
];
const DEFAULT_RADIO = defaultPlan().radio;
export const BEMESH_RADIO = RADIO_PRESETS.find((p) => p.title === BEMESH_PRESET_TITLE)!;

/** The plan with a preset's values and no custom state. */
function withPreset(plan: Plan, p: RadioPreset): Plan {
  const { radioText: _text, radioCustom: _custom, ...rest } = plan;
  return { ...rest, radio: { freq: p.freq, sf: p.sf, bw: p.bw, cr: p.cr } };
}

export function applyRecommendedRadio(): void {
  const plan = withPreset(store.plan.peek(), BEMESH_RADIO);
  store.plan.value = { ...plan, settings: { ...plan.settings, dutycycle: RECOMMENDED_SETTINGS.dutycycle } };
}

/** Valid text updates the radio; invalid text is kept raw in the plan so its error survives blur and navigation. */
function editField(id: RadioFieldId, text: string): void {
  const plan = store.plan.peek();
  const value = parseRadioField(id, text);
  const { [id]: _drop, ...others } = plan.radioText ?? {};
  const radioText = value === null ? { ...others, [id]: text } : others;
  store.plan.value = {
    ...plan,
    radio: value === null ? plan.radio : { ...plan.radio, [id]: value },
    radioText: Object.keys(radioText).length ? radioText : undefined,
    radioCustom: true,
  };
}

export function RadioFields() {
  const { radio, radioText, radioCustom } = store.plan.value;
  const snapshotRadio = store.snapshot.value?.radio;
  // Text being typed (kept while valid so "868." can become "868.1"); cleared on blur.
  const [draft, setDraft] = useState<Partial<Record<RadioFieldId, string>>>({});
  const preset = presetForRadio(radio);
  const selected = radioCustom || radioText || !preset ? CUSTOM : preset.title;
  const pick = (value: string) => {
    setDraft({});
    if (value === CUSTOM) store.plan.value = { ...store.plan.peek(), radioCustom: true };
    else store.plan.value = withPreset(store.plan.peek(), RADIO_PRESETS.find((x) => x.title === value)!);
  };
  return (
    <>
      <div class="field">
        <label class="field-label" for="set-preset">
          {t("settings.preset")}
        </label>
        <select id="set-preset" value={selected} onChange={(e) => pick(e.currentTarget.value)}>
          {RADIO_PRESETS.map((p) => (
            <option key={p.title} value={p.title}>
              {t("settings.preset.option", { title: p.title, freq: p.freq })}
            </option>
          ))}
          <option value={CUSTOM}>{t("settings.preset.custom")}</option>
        </select>
        <span class="sub help">{t("settings.radio.help")}</span>
      </div>
      <div class="field-grid">
        {FIELDS.map(({ id, label }) => {
          const invalid = radioText?.[id] !== undefined;
          const baseline = snapshotRadio?.[id] ?? DEFAULT_RADIO[id];
          const changed = invalid || radio[id] !== baseline;
          const was = snapshotRadio && (invalid || radio[id] !== snapshotRadio[id]) ? snapshotRadio : null;
          return (
            <div key={id} class={`field${changed ? " changed" : ""}${invalid ? " invalid" : ""}`}>
              <label class="field-label" for={`set-radio-${id}`}>
                {t(label)}
              </label>
              <input
                id={`set-radio-${id}`}
                type="text"
                inputMode="decimal"
                aria-invalid={invalid || undefined}
                value={draft[id] ?? radioText?.[id] ?? String(radio[id])}
                onInput={(e) => {
                  setDraft({ ...draft, [id]: e.currentTarget.value });
                  editField(id, e.currentTarget.value);
                }}
                onBlur={() => setDraft({})}
              />
              {invalid ? <span class="field-error">{t(`settings.radio.invalid.${id}`)}</span> : null}
              {was ? <span class="sub was">{t("settings.radio.was", { value: String(was[id]) })}</span> : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
