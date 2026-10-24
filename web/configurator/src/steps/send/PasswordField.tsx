/** The admin password field on Send: the shared setting field with a hold-to-show eye, never a toggle. */
import { useState } from "preact/hooks";
import { SETTINGS } from "../../core/settings";
import { rawOf } from "../../core/blocks";
import { t } from "../../i18n/t";
import { store } from "../../state/store";
import { SettingField } from "../Advanced";

const DEF = SETTINGS.find((d) => d.key === "adminPassword")!;

export function PasswordField() {
  const [shown, setShown] = useState(false);
  const show = () => setShown(true);
  const hide = () => setShown(false);
  const holdKey = (e: KeyboardEvent) => e.key === " " || e.key === "Enter";
  return (
    <SettingField
      def={DEF}
      control={(invalid) => (
        <div class="pw-row">
          <input
            id="set-adminPassword"
            aria-invalid={invalid || undefined}
            {...(shown ? { type: "text" as const } : { type: "password" as const })}
            autocomplete="new-password"
            value={rawOf(store.plan.value, "adminPassword")}
            placeholder={t("settings.adminPassword.placeholder")}
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
            class="icon eye"
            aria-label={t("send.showPassword")}
            title={t("send.showPassword")}
            aria-pressed={shown}
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
      )}
    />
  );
}
