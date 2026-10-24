import { t } from "../i18n/t";
import { busy, NUMBERED, stepNumber, stepStatus, STEPS, store, type Step } from "../state/store";

export function stepName(s: Step): string {
  return t(`step.${s}`);
}

/** The numbered step after this one; Advanced, a side step, goes on to Send. */
export function nextStep(s: Step): Step | null {
  if (s === "advanced") return "send";
  return NUMBERED[NUMBERED.indexOf(s) + 1] ?? null;
}

/** Seven coloured segments, Advanced a narrower optional one. Docked: "N / 6", the name and what is next. Wide: every label, ✓ on done. */
export function Stepper({ wide }: { wide: boolean }) {
  const current = store.step.value;
  const next = nextStep(current);
  const number = stepNumber(current);
  return (
    <div class={`stepper${wide ? " wide" : ""}`} role="group" aria-label={t("step.progress")}>
      <div class="segs">
        {STEPS.map((s) => {
          const status = stepStatus(s);
          const n = stepNumber(s);
          const mark = status === "done" ? "✓ " : n ? `${n} ` : "";
          return (
            <button
              type="button"
              key={s}
              class={`seg${n ? "" : " optional"} ${status}`}
              aria-current={s === current ? "step" : undefined}
              disabled={busy.value}
              onClick={() => (store.step.value = s)}
            >
              {wide ? <span class="seg-label" aria-hidden="true">{`${mark}${stepName(s)}`}</span> : null}
              <span class="sr">{stepName(s) + t(`status.${status}`)}</span>
            </button>
          );
        })}
      </div>
      {wide ? null : (
        <div class="stepper-line">
          <span>{number ? t("step.of", { n: number }) : ""}</span>
          <b>{stepName(current)}</b>
          <span>{next ? t("step.next", { name: stepName(next) }) : ""}</span>
        </div>
      )}
    </div>
  );
}
