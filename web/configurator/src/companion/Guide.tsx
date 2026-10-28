/**
 * "View this first": four steps to regions on a phone, each with a small drawn phone screen whose
 * highlight moves (CSS only; still when reduced motion is asked).
 */
import { useState } from "preact/hooks";
import { t } from "../i18n/t";

const STEPS = ["discover", "default", "add", "wayBack"] as const;
type GuideStep = (typeof STEPS)[number];

/** A phone screen: a title bar and rows; the row marked `hot` is the one the step is about. */
function Phone({ title, rows, hot, anim }: { title: string; rows: string[]; hot: number; anim: string }) {
  return (
    <svg class={`guide-phone ${anim}`} viewBox="0 0 120 150" aria-hidden="true">
      <rect class="frame" x="8" y="2" width="104" height="146" rx="12" />
      <rect class="bar" x="16" y="12" width="88" height="18" rx="4" />
      <text class="bar-text" x="22" y="25">
        {title}
      </text>
      {rows.map((r, i) => (
        <g key={r} class={`row${i === hot ? " hot" : ""}`} style={{ "--i": i }}>
          <rect x="16" y={38 + i * 24} width="88" height="19" rx="4" />
          <text x="22" y={51 + i * 24}>
            {r}
          </text>
        </g>
      ))}
      <circle class="tap" cx="92" cy={47 + hot * 24} r="5" />
    </svg>
  );
}

/** The app's own labels (MeshCore app 1.50) stay as the app shows them, in English. */
const SCREENS: Record<GuideStep, { title: string; rows: string[]; hot: number }> = {
  discover: { title: "Discover Regions", rows: ["be-vwv", "be", "eu"], hot: 1 },
  default: { title: "Settings", rows: ["Radio", "Default Region Scope", "be"], hot: 2 },
  add: { title: "Channels", rows: ["Public", "#bemesh", "#oostende"], hot: 2 },
  wayBack: { title: "Settings", rows: ["Default Region Scope", "none"], hot: 1 },
};

export function Guide() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const screen = SCREENS[step];
  if (!open) {
    return (
      <button type="button" class="guide-open" onClick={() => setOpen(true)}>
        <span class="guide-mark" aria-hidden="true">
          !
        </span>
        <span>
          <b>{t("companion.guide.openStrong")}</b> {t("companion.guide.openRest")}
        </span>
      </button>
    );
  }
  return (
    <section class="guide" aria-label={t("companion.guide.title")}>
      <header class="guide-head">
        <h3>{t("companion.guide.title")}</h3>
        <span class="sub">{t("companion.guide.count", { n: i + 1, total: STEPS.length })}</span>
      </header>
      <div class="guide-step" key={step}>
        <Phone title={screen.title} rows={screen.rows} hot={screen.hot} anim={`anim-${step}`} />
        <div>
          <h4>{t(`companion.guide.${step}.title`)}</h4>
          <p>{t(`companion.guide.${step}.body`)}</p>
        </div>
      </div>
      <div class="guide-dots" aria-hidden="true">
        {STEPS.map((s, n) => (
          <span key={s} class={n === i ? "on" : ""} />
        ))}
      </div>
      <footer class="guide-foot">
        {i > 0 ? (
          <button type="button" class="btn small" onClick={() => setI(i - 1)}>
            {t("companion.guide.back")}
          </button>
        ) : (
          <button type="button" class="btn small" onClick={() => setOpen(false)}>
            {t("companion.guide.close")}
          </button>
        )}
        {i < STEPS.length - 1 ? (
          <button type="button" class="btn small primary" onClick={() => setI(i + 1)}>
            {t("companion.guide.next")}
          </button>
        ) : (
          <button type="button" class="btn small primary" onClick={() => setOpen(false)}>
            {t("companion.guide.done")}
          </button>
        )}
      </footer>
    </section>
  );
}
