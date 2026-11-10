/** Timing: the current band, counting the repeater's neighbours to pick one, and how many repeaters the map shows near. */
import { nodesWithin, NEIGHBOR_RADIUS_KM } from "../../core/geo";
import { bandFor, bandTiming, siteOf, timingOf, withTiming, type SiteProfile } from "../../core/site";
import { t } from "../../i18n/t";
import { cancelCount, countNeighbours } from "../../state/device";
import { busy, store, type TuneState } from "../../state/store";

function nearbyText(): string | null {
  const { location } = store.plan.value;
  const data = store.data.value;
  if (data.failed.has("nodes")) return null;
  if (!location) return t("site.nearbyNone");
  if (!data.nodes) return null;
  const count = nodesWithin(data.nodes, location, NEIGHBOR_RADIUS_KM).filter((n) => n.type === 2).length;
  return t("site.nearby", { count, km: NEIGHBOR_RADIUS_KM });
}

/** Listening: the round, the seconds left as text and bar, and Cancel. */
function Counting({ state }: { state: Extract<TuneState, { phase: "counting" }> }) {
  const done = state.total - state.left;
  return (
    <div class="progress tune-progress">
      <div
        class="progress-bar"
        role="progressbar"
        aria-label={t("tune.count")}
        aria-valuemin={0}
        aria-valuemax={state.total}
        aria-valuenow={done}
      >
        <span style={{ width: `${state.total ? (100 * done) / state.total : 0}%` }} />
      </div>
      <p class="sub progress-text">
        {t("tune.round", { round: state.round, rounds: state.rounds, left: state.left })}{" "}
        <button type="button" class="btn tiny" onClick={cancelCount}>
          {t("tune.cancel")}
        </button>
      </p>
    </div>
  );
}

/** The count, its band, and the button that puts the band's timing in the plan. */
function Result({ heard, atLeast }: { heard: number; atLeast: boolean }) {
  const band = bandFor(heard);
  const timing = timingOf(store.plan.value);
  const isBand = (b: SiteProfile) => siteOf(timing) === b && timing.rxdelay === 0;
  const use = (b: SiteProfile) => (store.plan.value = withTiming(store.plan.peek(), bandTiming(b)));
  // Over USB the table lists about 8 at most: a cut one at Foothills may well be Hilltop.
  const mayBeHilltop = atLeast && band === "foothills";
  return (
    <>
      <p class="tune-result">
        {t(atLeast ? "tune.resultAtLeast" : "tune.result", { count: heard, band: t(`site.${band}`) })}{" "}
        <button type="button" class="btn tiny" disabled={isBand(band)} onClick={() => use(band)}>
          {t("tune.use")}
        </button>
      </p>
      {mayBeHilltop ? (
        <p class="sub tune-result">
          {t("tune.mayBeMore")}{" "}
          <button type="button" class="btn tiny" disabled={isBand("hilltop")} onClick={() => use("hilltop")}>
            {t("tune.useBand", { band: t("site.hilltop") })}
          </button>
        </p>
      ) : null}
    </>
  );
}

export function TimingPreset() {
  const current = siteOf(timingOf(store.plan.value));
  const tune = store.tune.value;
  const connected = store.device.value.status === "connected";
  const nearby = nearbyText();
  return (
    <div class="field">
      <span class="field-label" id="lbl-timing">
        {t("settings.timing")}
      </span>
      <strong class="timing-band" aria-describedby="lbl-timing">
        {t(`site.${current}`)}
      </strong>
      {tune.phase === "counting" ? (
        <Counting state={tune} />
      ) : (
        <div>
          <button type="button" class="btn small" disabled={!connected || busy.value} onClick={() => void countNeighbours()}>
            {t("tune.count")}
          </button>
        </div>
      )}
      {tune.phase === "done" ? <Result heard={tune.heard} atLeast={tune.atLeast} /> : null}
      {tune.phase === "failed" ? <span class="field-error">{t("tune.failed", { reason: tune.error })}</span> : null}
      <span class="sub help">{connected ? t("tune.hint") : `${t("tune.needDevice")} ${t("tune.hint")}`}</span>
      {nearby ? <span class="sub help">{nearby}</span> : null}
    </div>
  );
}
