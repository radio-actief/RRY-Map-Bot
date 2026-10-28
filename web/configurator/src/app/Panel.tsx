import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n/t";
import { busy, isWide, NUMBERED, setTask, store, type Step, type Task } from "../state/store";
import { disconnectUsb } from "../state/device";
import { Connect } from "../steps/Connect";
import { Name } from "../steps/Name";
import { Place } from "../steps/Place";
import { Regions } from "../steps/Regions";
import { Send } from "../steps/Send";
import { SettingsStep } from "../steps/SettingsStep";
import { useLazy } from "./lazy";
import { Notice } from "./Notice";
import { nextStep, Stepper, stepName } from "./Stepper";

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
  if (step === "connect") return <Connect />;
  if (step === "place") return <Place />;
  if (step === "name") return <Name />;
  if (step === "regions") return <Regions />;
  if (step === "settings") return <SettingsStep />;
  return <Send />;
}

const TASKS: Task[] = ["repeater", "companion"];

/** Repeater (the six steps) or Companion (one page for a phone); the address follows (#companion). */
function TaskTabs() {
  const task = store.task.value;
  return (
    <div class="task-tabs" role="tablist" aria-label={t("task.tablist")}>
      {TASKS.map((k) => (
        <button
          type="button"
          role="tab"
          key={k}
          aria-selected={task === k}
          disabled={busy.value && task !== k}
          onClick={() => setTask(k)}
        >
          {t(`task.${k}`)}
        </button>
      ))}
    </div>
  );
}

/** The Companion page (and its QR encoder) loads when it is first opened. */
function CompanionBody() {
  const Page = useLazy(() => import("../companion/Companion").then((m) => m.Companion));
  return Page ? <Page /> : <div class="panel-body" />;
}

export function Panel() {
  const step = store.step.value;
  const companion = store.task.value === "companion";
  const sheet = useMediaQuery(NARROW);
  const stepWide = isWide(step) && !companion;
  const wide = stepWide && !sheet;
  const height = stepWide ? "full" : store.sheet.value;
  const mode = sheet ? `sheet ${height}` : wide ? "wide" : "docked";
  const back = NUMBERED[NUMBERED.indexOf(step) - 1];
  const next = nextStep(step);
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
        <TaskTabs />
        {companion ? null : <Stepper wide={wide} />}
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
      {/* Keyed by step: each step opens at its top in a fresh scroll box. */}
      {companion ? <CompanionBody /> : <StepBody key={step} step={step} />}
      {/* Settings and Send carry their own Back / Next; the Companion page has none. */}
      {companion || isWide(step) ? null : (
        <footer class="panel-foot">
          {back ? (
            <button type="button" class="btn" disabled={locked} onClick={() => (store.step.value = back)}>
              {t("step.back")}
            </button>
          ) : store.device.value.status === "connected" ? (
            <button type="button" class="btn" onClick={() => void disconnectUsb()}>
              {t("connect.disconnect")}
            </button>
          ) : (
            <span />
          )}
          <span class="foot-end">
            {next ? (
              <button type="button" class="btn primary" disabled={locked} onClick={() => (store.step.value = next)}>
                {t("step.nextButton", { name: stepName(next) })}
              </button>
            ) : null}
          </span>
        </footer>
      )}
    </section>
  );
}
