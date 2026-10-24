/** Site step: how high and open the repeater stands, as one of five timing choices. */
import { nodesWithin, NEIGHBOR_RADIUS_KM } from "../core/geo";
import { siteOf, siteReference, timingFor, timingOf, withTiming, type SiteChoice, type SiteProfile } from "../core/site";
import { t } from "../i18n/t";
import { store } from "../state/store";

const PROFILES: SiteProfile[] = ["hilltop", "foothills", "suburban", "local"];
const CHOICES: (SiteProfile | "own")[] = [...PROFILES, "own"];

function currentChoice(): SiteChoice {
  return siteOf(timingOf(store.plan.value), siteReference(store.snapshot.value));
}

function pick(choice: SiteProfile | "own") {
  const timing = timingFor(choice, siteReference(store.snapshot.value));
  store.plan.value = withTiming(store.plan.peek(), timing);
}

/** The five site choices as cards, or as compact pills (Advanced); Custom shows only while the timing is neither. */
export function SiteChoices({ compact }: { compact?: boolean }) {
  const current = currentChoice();

  if (compact) {
    return (
      <div class="pills" role="group" aria-label={t("settings.timing")}>
        {CHOICES.map((c) => (
          <button type="button" class="pill" key={c} aria-pressed={current === c} onClick={() => pick(c)}>
            {t(`site.${c}`)}
          </button>
        ))}
        {current === "custom" ? (
          <span class="pill" aria-current="true">
            {t("site.custom")}
          </span>
        ) : null}
      </div>
    );
  }

  const timing = timingOf(store.plan.value);
  return (
    <div class="site-cards">
      {CHOICES.map((c) => (
        <button type="button" class="site-card" key={c} aria-pressed={current === c} onClick={() => pick(c)}>
          <strong>{t(`site.${c}`)}</strong>
          <span class="sub">{t(`site.${c}.desc`)}</span>
          {c === "own" ? null : <span class="range">{t(`site.${c}.range`)}</span>}
        </button>
      ))}
      {current === "custom" ? (
        <div class="site-card" aria-current="true">
          <strong>{t("site.custom")}</strong>
          <span class="sub">
            {t("site.custom.desc", { tx: timing.txdelay, direct: timing.directTxdelay, rx: timing.rxdelay })}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function Site() {
  const { location } = store.plan.value;
  const data = store.data.value;
  let nearby: string | null = null;
  if (data.failed.has("nodes")) nearby = null;
  else if (!location) nearby = t("site.nearbyNone");
  else if (data.nodes) {
    const count = nodesWithin(data.nodes, location, NEIGHBOR_RADIUS_KM).filter((n) => n.type === 2).length;
    nearby = t("site.nearby", { count, km: NEIGHBOR_RADIUS_KM });
  }

  return (
    <div class="panel-body step-site">
      <h2>{t("site.title")}</h2>
      <p class="sub">{t("site.sub")}</p>
      <SiteChoices />
      {nearby ? <p class="sub">{nearby}</p> : null}
    </div>
  );
}
