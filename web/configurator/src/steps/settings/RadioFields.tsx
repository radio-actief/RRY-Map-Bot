/** The radio card's preset select and the four custom radio fields. */
import { useState } from "preact/hooks";
import { withPreset } from "../../core/blocks";
import { parseRadioField, presetForRadio, RADIO_PRESETS, type RadioFieldId } from "../../core/presets";
import { t } from "../../i18n/t";
import { store } from "../../state/store";
import { RepeaterValue } from "./RepeaterValue";

const CUSTOM = "custom";
const FIELDS: { id: RadioFieldId; label: string }[] = [
  { id: "freq", label: "settings.radio.freq" },
  { id: "bw", label: "settings.radio.bw" },
  { id: "sf", label: "settings.radio.sf" },
  { id: "cr", label: "settings.radio.cr" },
];

/** The field back to a valid value, dropping its invalid text. */
function restoreField(id: RadioFieldId, value: number): void {
  const plan = store.plan.peek();
  const { [id]: _drop, ...others } = plan.radioText ?? {};
  store.plan.value = {
    ...plan,
    radio: { ...plan.radio, [id]: value },
    radioText: Object.keys(others).length ? others : undefined,
  };
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
  const startRadio = store.startPlan.value.radio;
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
          const changed = invalid || radio[id] !== startRadio[id];
          const was = snapshotRadio && (invalid || radio[id] !== snapshotRadio[id]) ? snapshotRadio[id] : null;
          return (
            <div key={id} class={`field${changed ? " changed" : ""}${invalid ? " invalid" : ""}`}>
              <div class="label-line">
                <label class="field-label" for={`set-radio-${id}`}>
                  {t(label)}
                </label>
                {was !== null ? (
                  <RepeaterValue
                    value={String(was)}
                    onRestore={() => {
                      setDraft({});
                      restoreField(id, was);
                    }}
                  />
                ) : null}
              </div>
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
            </div>
          );
        })}
      </div>
    </>
  );
}
