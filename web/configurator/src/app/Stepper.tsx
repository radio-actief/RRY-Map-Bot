import { t } from "../i18n/t";
import { busy, stepStatus, store, type Step } from "../state/store";

export const STEPS: Step[] = [1, 2, 3, 4, 5];

export function stepName(n: Step): string {
  return t(`step.${n}`);
}

/** Five coloured segments. Docked: "N / 5", the name and what is next. Wide: every label, ✓ on done. */
export function Stepper({ wide }: { wide: boolean }) {
  const current = store.step.value;
  const next = current < 5 ? ((current + 1) as Step) : null;
  return (
    <div class={`stepper${wide ? " wide" : ""}`} role="group" aria-label={t("step.progress")}>
      <div class="segs">
        {STEPS.map((n) => {
          const status = stepStatus(n);
          return (
            <button
              type="button"
              key={n}
              class={`seg ${status}`}
              aria-current={n === current ? "step" : undefined}
              disabled={busy.value}
              onClick={() => (store.step.value = n)}
            >
              {wide ? <span class="seg-label" aria-hidden="true">{`${status === "done" ? "✓" : n} ${stepName(n)}`}</span> : null}
              <span class="sr">{stepName(n) + t(`status.${status}`)}</span>
            </button>
          );
        })}
      </div>
      {wide ? null : (
        <div class="stepper-line">
          <span>{t("step.of", { n: current })}</span>
          <b>{stepName(current)}</b>
          <span>{next ? t("step.next", { name: stepName(next) }) : ""}</span>
        </div>
      )}
    </div>
  );
}
