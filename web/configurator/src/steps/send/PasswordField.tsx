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
 * the user sets one or ticks "Don't set a password". A read repeater keeps its password when the
 * field is empty. The tick is never set by default; ticking it empties and disables the field, so
 * no password command goes out, and a warning says what that means on this repeater.
 */
export function PasswordField() {
  const [shown, setShown] = useState(false);
  const plan = store.plan.value;
  const read = !!store.snapshot.value;
  const skip = !!plan.adminPasswordSkip;
  const setSkip = (on: boolean) => {
    const p = store.plan.peek();
    editPlan({ adminPasswordSkip: on, settings: on ? { ...p.settings, adminPassword: "" } : p.settings });
    if (on) setShown(false);
  };
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
            aria-describedby={skip ? "pw-skip-warn" : undefined}
            disabled={skip}
            {...(shown ? { type: "text" as const } : { type: "password" as const })}
            autocomplete="new-password"
            value={rawOf(store.plan.value, "adminPassword")}
            placeholder={t(skip ? "settings.adminPassword.placeholderSkip" : read ? "settings.adminPassword.placeholder" : "settings.adminPassword.placeholderNew")}
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
            disabled={skip}
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
        <label class="check-line pw-skip">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip((e.currentTarget as HTMLInputElement).checked)} />
          <span>{t("settings.adminPassword.skip")}</span>
        </label>
        {skip ? (
          <p id="pw-skip-warn" class="pw-warn" role="status">
            <span class="pw-warn-icon" aria-hidden="true">
              ⚠
            </span>
            <span>{t(read ? "settings.adminPassword.skipWarnRead" : "settings.adminPassword.skipWarn")}</span>
          </p>
        ) : null}
        </>
      )}
    />
  );
}
