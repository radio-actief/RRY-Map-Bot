import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n/t";
import { busy, store, type Step } from "../state/store";
import { disconnectUsb } from "../state/device";
import { Connect } from "../steps/Connect";
import { PlaceName } from "../steps/PlaceName";
import { Regions } from "../steps/Regions";
import { Review } from "../steps/Review";
import { Settings } from "../steps/Settings";
import { Notice } from "./Notice";
import { Stepper, stepName } from "./Stepper";

const NARROW = "(max-width: 767px)";

/** Tracks a media query; false where matchMedia does not exist. */
export function useMediaQuery(query: string): boolean {
  const read = () => (typeof matchMedia === "function" ? matchMedia(query).matches : false);
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [query]);
  return matches;
}

const SHEET_NEXT = { peek: "half", half: "full", full: "peek" } as const;

function StepBody({ step }: { step: Step }) {
  if (step === 1) return <Connect />;
  if (step === 2) return <PlaceName />;
  if (step === 3) return <Regions />;
  if (step === 4) return <Settings />;
  return <Review />;
}

export function Panel() {
  const step = store.step.value;
  const sheet = useMediaQuery(NARROW);
  const wide = step >= 4 && !sheet;
  const height = step >= 4 ? "full" : store.sheet.value;
  const mode = sheet ? `sheet ${height}` : wide ? "wide" : "docked";
  const next = step < 5 ? ((step + 1) as Step) : null;
  const notice = store.notice.value;
  const locked = busy.value;
  return (
    <section class={`panel ${mode}`}>
      {sheet ? (
        <button
          type="button"
          class="grab"
          aria-label={t("sheet.handle")}
          onClick={() => (store.sheet.value = SHEET_NEXT[store.sheet.value])}
        />
      ) : null}
      <header class="panel-head">
        <Stepper wide={wide} />
      </header>
      {notice ? (
        <div class="panel-notice">
          <Notice kind={notice.kind}>
            {notice.text}
            <button
              type="button"
              class="icon small"
              aria-label={t("dialog.close")}
              onClick={() => (store.notice.value = null)}
            >
              ✕
            </button>
          </Notice>
        </div>
      ) : null}
      <StepBody step={step} />
      {/* Steps 4 and 5 carry their own Back / Next. */}
      {step >= 4 ? null : (
        <footer class="panel-foot">
          {step > 1 ? (
            <button
              type="button"
              class="btn"
              disabled={locked}
              onClick={() => (store.step.value = (step - 1) as Step)}
            >
              {t("step.back")}
            </button>
          ) : store.device.value.status === "connected" ? (
            <button type="button" class="btn" onClick={() => void disconnectUsb()}>
              {t("connect.disconnect")}
            </button>
          ) : (
            <span />
          )}
          {next ? (
            <button type="button" class="btn primary" disabled={locked} onClick={() => (store.step.value = next)}>
              {t("step.nextButton", { name: stepName(next) })}
            </button>
          ) : null}
        </footer>
      )}
    </section>
  );
}
