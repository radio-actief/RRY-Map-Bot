import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n/t";
import { store, type Step } from "../state/store";
import { Connect, disconnectUsb } from "../steps/Connect";
import { PlaceName } from "../steps/PlaceName";
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

/** Steps 3-5 arrive in later tasks. */
function StepBody({ step }: { step: Step }) {
  if (step === 1) return <Connect />;
  if (step === 2) return <PlaceName />;
  return (
    <div class="panel-body">
      <h2>{stepName(step)}</h2>
      <p class="sub">{t("step.placeholder")}</p>
    </div>
  );
}

export function Panel() {
  const step = store.step.value;
  const sheet = useMediaQuery(NARROW);
  const wide = step >= 4 && !sheet;
  const height = step >= 4 ? "full" : store.sheet.value;
  const mode = sheet ? `sheet ${height}` : wide ? "wide" : "docked";
  const next = step < 5 ? ((step + 1) as Step) : null;
  const notice = store.notice.value;
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
            <button type="button" class="icon small" aria-label={t("dialog.close")} onClick={() => (store.notice.value = null)}>
              ✕
            </button>
          </Notice>
        </div>
      ) : null}
      <StepBody step={step} />
      <footer class="panel-foot">
        {step > 1 ? (
          <button type="button" class="btn" onClick={() => (store.step.value = (step - 1) as Step)}>
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
          <button type="button" class="btn primary" onClick={() => (store.step.value = next)}>
            {t("step.nextButton", { name: stepName(next) })}
          </button>
        ) : null}
      </footer>
    </section>
  );
}
