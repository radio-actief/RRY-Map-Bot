/** Timing preset: the four sites and Custom, what the chosen one means, and how many repeaters are near. */
import { nodesWithin, NEIGHBOR_RADIUS_KM } from "../../core/geo";
import { siteOf, siteReference, SITE_PROFILES, timingOf, withTiming, type SiteChoice, type SiteProfile } from "../../core/site";
import { t } from "../../i18n/t";
import { store } from "../../state/store";

const CHOICES: SiteChoice[] = [...(Object.keys(SITE_PROFILES) as SiteProfile[]), "custom"];

/** Custom puts back the repeater's timing (the firmware's without a Read); the fields stay editable. */
function pick(choice: SiteChoice) {
  const timing = choice === "custom" ? siteReference(store.snapshot.value) : SITE_PROFILES[choice];
  store.plan.value = withTiming(store.plan.peek(), timing);
}

function nearbyText(): string | null {
  const { location } = store.plan.value;
  const data = store.data.value;
  if (data.failed.has("nodes")) return null;
  if (!location) return t("site.nearbyNone");
  if (!data.nodes) return null;
  const count = nodesWithin(data.nodes, location, NEIGHBOR_RADIUS_KM).filter((n) => n.type === 2).length;
  return t("site.nearby", { count, km: NEIGHBOR_RADIUS_KM });
}

export function TimingPreset() {
  const current = siteOf(timingOf(store.plan.value));
  const desc = current === "custom" ? t("site.custom.desc") : `${t(`site.${current}.desc`)} ${t(`site.${current}.range`)}`;
  const nearby = nearbyText();
  return (
    <div class="field">
      <span class="field-label" id="lbl-timing">
        {t("settings.timing")}
      </span>
      <div class="pills" role="group" aria-labelledby="lbl-timing">
        {CHOICES.map((c) => (
          <button type="button" class="pill" key={c} aria-pressed={current === c} onClick={() => pick(c)}>
            {t(`site.${c}`)}
          </button>
        ))}
      </div>
      <span class="sub help">{desc}</span>
      {nearby ? <span class="sub help">{nearby}</span> : null}
    </div>
  );
}
