/** Step 5: the planned changes, the exact command script (copy, download, console) and Apply. */
import { useState } from "preact/hooks";
import { Console } from "../app/Console";
import { Dialog } from "../app/Dialog";
import { Notice, type NoticeKind } from "../app/Notice";
import { buildScript, commandLines, scriptText, type ScriptGroup } from "../core/cli";
import { REGION_DEF_MIN_TEXT } from "../core/firmware";
import { planName, summarize, type Change } from "../core/plan";
import { hasWebSerial, MAX_LINE_LEN } from "../device/serial";
import { t } from "../i18n/t";
import { answerReboot, applyPlan, cancelApply, connectUsb } from "../state/device";
import { busy, canApply, prefs, store, type ApplyState } from "../state/store";

export const INCLUDE_DEFAULTS_PREF = "configurator.includeDefaults";
export const SCRIPT_FILE = "bemesh-repeater-commands.txt";

/** The left column's groups, in the spec's order. */
const GROUPS: { key: string; of: Change["group"][] }[] = [
  { key: "nameLocation", of: ["name", "location"] },
  { key: "regions", of: ["regions"] },
  { key: "settings", of: ["settings"] },
];

const groupTitle = (k: ScriptGroup["titleKey"]) => t(`script.group.${k}`);

/** A control character as its visible Unicode picture (CR as ␍), so the shown script hides nothing. */
const visible = (line: string) =>
  line.replace(/[\x00-\x1f\x7f]/g, (c) => (c === "\x7f" ? "\u2421" : String.fromCharCode(0x2400 + c.charCodeAt(0))));

function Changes() {
  const { changes, adminPassword } = summarize(store.plan.value, store.snapshot.value ?? undefined);
  return (
    <div class="review-changes">
      <div class="card review-table">
        {changes.length ? (
          GROUPS.map((g) => {
            const rows = changes.filter((c) => g.of.includes(c.group));
            if (!rows.length) return null;
            return (
              <section key={g.key} class="rv-group">
                <h3 class="rv-head">{t(`review.group.${g.key}`)}</h3>
                {rows.map((c) => (
                  <div key={`${c.group}-${c.labelKey}`} class="rv-row">
                    <span class="rv-label">{t(`summary.${c.labelKey}`)}</span>
                    {c.from !== undefined ? <s class="rv-from">{c.from || t("review.notSet")}</s> : null}
                    <span class="rv-to">{c.to}</span>
                  </div>
                ))}
              </section>
            );
          })
        ) : (
          <p class="sub rv-empty">{t("review.empty")}</p>
        )}
      </div>
      <Notice kind="ok">{`🔒 ${t(`summary.adminPassword.${adminPassword}`)}`}</Notice>
    </div>
  );
}

/** The script with its `#` group headers as comments. */
function Script({ text }: { text: string }) {
  if (!text) return <pre class="script empty">{t("review.scriptEmpty")}</pre>;
  return (
    <pre class="script">
      {text.split("\n").map((line, i) => [
        i ? "\n" : "",
        <span key={i} class={line.startsWith("#") ? "c" : undefined}>
          {line}
        </span>,
      ])}
    </pre>
  );
}

function Progress({ state }: { state: ApplyState }) {
  if (state.phase === "checking") return <p class="sub progress-text">{t("apply.checking")}</p>;
  const at =
    state.phase === "sending"
      ? { sent: state.sent, total: state.total, text: t("apply.progress", { sent: state.sent, total: state.total }) }
      : state.phase === "done"
        ? { sent: state.total, total: state.total, text: t("apply.sent", { total: state.total }) }
        : state.phase === "failed"
          ? { sent: state.failedAt, total: state.total, text: "" }
          : null;
  if (!at) return null;
  return (
    <div class={`progress ${state.phase}`}>
      <div
        class="progress-bar"
        role="progressbar"
        aria-label={t("apply.progressLabel")}
        aria-valuemin={0}
        aria-valuemax={at.total}
        aria-valuenow={at.sent}
      >
        <span style={{ width: `${at.total ? (100 * at.sent) / at.total : 0}%` }} />
      </div>
      {at.text ? <p class="sub progress-text">{at.text}</p> : null}
    </div>
  );
}

async function copy(text: string, done: (kind: NoticeKind, text: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    done("ok", t("review.copied"));
  } catch (err) {
    done("error", t("review.copyFailed", { reason: err instanceof Error ? err.message : String(err) }));
  }
}

function download(text: string) {
  const url = URL.createObjectURL(new Blob([`${text}\n`], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = SCRIPT_FILE;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function readIncludeDefaults(): boolean {
  return prefs.get(INCLUDE_DEFAULTS_PREF) === "1";
}

export function Review() {
  const [includeDefaults, setIncludeDefaults] = useState(readIncludeDefaults);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [flash, setFlash] = useState<{ kind: NoticeKind; text: string } | null>(null);
  const plan = store.plan.value;
  const places = store.data.value.places ?? [];
  const device = store.deviceRegions.value;
  const shown = buildScript(plan, places, { includeDefaults, device });
  const text = scriptText(
    shown.map((g) => ({ ...g, lines: g.lines.map(visible) })),
    groupTitle,
  );
  // Apply sends the full script, unchanged defaults included, as the old page did.
  const applyCount = commandLines(includeDefaults ? shown : buildScript(plan, places, { includeDefaults: true, device })).length;
  const shownCount = commandLines(shown).length;
  const state = store.apply.value;
  const gate = canApply.value;
  const locked = busy.value;
  const name = planName(plan);
  const say = (kind: NoticeKind, msg: string) => setFlash({ kind, text: msg });
  const status = store.device.value.status;

  return (
    <div class="panel-body step-review">
      <h2>{name ? t("review.title", { name }) : t("review.titleNoName")}</h2>
      <p class="sub">{t("review.sub")}</p>
      <div class="review-layout">
        <Changes />
        <div class="review-send">
          <label class="toggle">
            <input
              type="checkbox"
              checked={includeDefaults}
              onChange={(e) => {
                const on = (e.currentTarget as HTMLInputElement).checked;
                setIncludeDefaults(on);
                prefs.set(INCLUDE_DEFAULTS_PREF, on ? "1" : "0");
              }}
            />
            {t("review.includeDefaults")}
          </label>
          <Script text={text} />
          {applyCount > shownCount ? <p class="sub">{t("review.applyFull", { count: applyCount })}</p> : null}
          <Progress state={state} />
          {state.phase === "old" ? (
            <Notice kind="error">{t("apply.firmwareOld", { version: state.version, min: REGION_DEF_MIN_TEXT })}</Notice>
          ) : null}
          {state.phase === "failed" ? (
            <Notice kind="error">
              <p>{t("apply.stopped", { n: state.failedAt, total: state.total, command: state.command })}</p>
              <p>{state.error}</p>
              <p>{t("apply.readAgain")}</p>
              <button
                type="button"
                class="btn small"
                onClick={() => void copy([state.command, ...state.remaining].join("\n"), say)}
              >
                {t("apply.copyRemaining")}
              </button>
              <p class="sub">{t("apply.copyRemainingHint")}</p>
            </Notice>
          ) : null}
          {state.phase === "error" ? <Notice kind="error">{t("apply.error", { reason: state.reason })}</Notice> : null}
          {state.phase === "empty" ? <Notice kind="error">{t("apply.empty")}</Notice> : null}
          {state.phase === "tooLong" ? (
            <Notice kind="error">
              <p>{t("apply.tooLong", { max: MAX_LINE_LEN })}</p>
              <ul class="reasons">
                {state.lines.map((l) => (
                  <li key={l}>
                    <code>{l}</code>
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {!gate.ok && !locked ? (
            <Notice kind="warn">
              <ul class="reasons">
                {[...new Set(gate.reasons)].map((r) => (
                  <li key={r}>{t(r)}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <div class="review-actions">
            <button type="button" class="btn" disabled={!text} onClick={() => void copy(text, say)}>
              {t("review.copy")}
            </button>
            <button type="button" class="btn" disabled={!text} onClick={() => download(text)}>
              {t("review.download")}
            </button>
            <button type="button" class="btn" onClick={() => setConsoleOpen(true)}>
              {t("review.console")}
            </button>
            <span class="spacer" />
            <button type="button" class="btn" disabled={locked} onClick={() => (store.step.value = 4)}>
              {t("step.back")}
            </button>
            {status !== "connected" && hasWebSerial() ? (
              <button
                type="button"
                class="btn primary"
                disabled={status === "connecting"}
                onClick={() => void connectUsb()}
              >
                {status === "connecting" ? t("connect.connecting") : t("connect.button")}
              </button>
            ) : null}
            <button
              type="button"
              class="btn primary"
              disabled={!gate.ok || locked}
              onClick={() => {
                setFlash(null);
                void applyPlan();
              }}
            >
              {store.applying.value ? t("apply.sending") : t("apply.button")}
            </button>
          </div>
          {flash ? <Notice kind={flash.kind}>{flash.text}</Notice> : null}
        </div>
      </div>
      <Console open={consoleOpen} onClose={() => setConsoleOpen(false)} />
      <Dialog
        open={state.phase === "unknown"}
        title={t("apply.unknownTitle")}
        onClose={cancelApply}
        actions={
          <>
            <button type="button" class="btn" onClick={cancelApply}>
              {t("apply.cancel")}
            </button>
            <button type="button" class="btn primary" onClick={() => void applyPlan({ skipFirmwareCheck: true })}>
              {t("apply.continueAnyway")}
            </button>
          </>
        }
      >
        <p>{t("apply.unknownBody", { min: REGION_DEF_MIN_TEXT })}</p>
      </Dialog>
      <Dialog
        open={state.phase === "done" && state.offerReboot}
        title={t("reboot.title")}
        onClose={() => void answerReboot(false)}
        actions={
          <>
            <button type="button" class="btn" onClick={() => void answerReboot(false)}>
              {t("reboot.later")}
            </button>
            <button
              type="button"
              class="btn primary"
              disabled={store.device.value.status !== "connected"}
              onClick={() => void answerReboot(true)}
            >
              {t("reboot.now")}
            </button>
          </>
        }
      >
        <p>{t("reboot.ask")}</p>
        {state.phase === "done" && state.radioChanged ? <p class="sub">{t("reboot.radioHint")}</p> : null}
      </Dialog>
    </div>
  );
}
