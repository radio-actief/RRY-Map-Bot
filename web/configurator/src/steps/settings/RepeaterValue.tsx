/** The tag at the right of a field's label line: what the repeater has, with ↺ to use it again. */
import { t } from "../../i18n/t";

export function RepeaterValue({ value, onRestore }: { value: string; onRestore: () => void }) {
  const label = t("settings.restore", { value });
  return (
    <span class="repeater-value">
      {t("settings.onRepeater")} <code>{value}</code>
      <button type="button" class="icon" aria-label={label} title={label} onClick={onRestore}>
        ↺
      </button>
    </span>
  );
}
