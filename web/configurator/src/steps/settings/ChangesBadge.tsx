/** A card's badge: Unchanged, or the changes counted against the start plan. Only a label. */
import { t } from "../../i18n/t";

export function ChangesBadge({ count }: { count: number }) {
  return count ? (
    <span class="badge changed">{t("settings.badge.changes", { count })}</span>
  ) : (
    <span class="badge">{t("settings.badge.unchanged")}</span>
  );
}
