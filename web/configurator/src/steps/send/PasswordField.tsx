/** The admin password field on Send: the shared setting field with a hold-to-show eye, never a toggle. */
import { useState } from "preact/hooks";
import { SETTINGS } from "../../core/settings";
import { rawOf } from "../../core/blocks";
import { t } from "../../i18n/t";
import { editPlan, store } from "../../state/store";
import { SettingField } from "../SettingsStep";

const DEF = SETTINGS.find((d) => d.key === "adminPassword")!;

/**
 * On a repeater that was not read (a new board) an empty field would leave the factory password:
 * the user sets one or ticks "Don't set a password", which warns. A read repeater keeps its
 * password when the field is empty.
 */
export function PasswordField() {
  const [shown, setShown] = useState(false);
  const plan = store.plan.value;
  const read = !!store.snapshot.value;
  const empty = !rawOf(plan, "adminPassword").trim();
  const show = () => setShown(true);
  const hide = () => setShown(false);
  const holdKey = (e: KeyboardEvent) => e.key === " " || e.key === "Enter";
  return (
    <SettingField
      def={DEF}
      control={(invalid) => (
        <>
        <div class="pw-row">
          <input
            id="set-adminPassword"
            aria-invalid={invalid || undefined}
            {...(shown ? { type: "text" as const } : { type: "password" as const })}
            autocomplete="new-password"
            value={rawOf(store.plan.value, "adminPassword")}
            placeholder={t(read ? "settings.adminPassword.placeholder" : "settings.adminPassword.placeholderNew")}
            onInput={(e) => {
              const plan = store.plan.peek();
              store.plan.value = {
                ...plan,
                settings: { ...plan.settings, adminPassword: (e.currentTarget as HTMLInputElement).value },
              };
            }}
          />
          <button
            type="button"
            class={`icon eye${shown ? " held" : ""}`}
            aria-label={t("send.showPassword")}
            title={t("send.showPassword")}
            onPointerDown={show}
            onPointerUp={hide}
            onPointerLeave={hide}
            onPointerCancel={hide}
            onKeyDown={(e) => {
              if (holdKey(e)) {
                e.preventDefault();
                show();
              }
            }}
            onKeyUp={(e) => holdKey(e) && hide()}
            onBlur={hide}
            onClick={(e) => e.preventDefault()}
          >
            <span aria-hidden="true">👁</span>
          </button>
        </div>
        {!read && empty ? (
          <label class="check-line pw-skip">
            <input
              type="checkbox"
              checked={!!plan.adminPasswordSkip}
              onChange={(e) => editPlan({ adminPasswordSkip: (e.currentTarget as HTMLInputElement).checked })}
            />
            <span>{t("settings.adminPassword.skip")}</span>
          </label>
        ) : null}
        {!read && empty && plan.adminPasswordSkip ? <p class="field-error pw-warn">{t("settings.adminPassword.skipWarn")}</p> : null}
        </>
      )}
    />
  );
}
