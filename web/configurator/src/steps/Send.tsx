/** Send step: the planned changes, the exact command script (copy, download, console) and Apply. */
import { useState } from "preact/hooks";
import { Console } from "../app/Console";
import { Dialog } from "../app/Dialog";
import { Notice, type NoticeKind } from "../app/Notice";
import { rawOf } from "../core/blocks";
import { buildScript, commandLines, scriptText, unchangedCount, type ScriptGroup } from "../core/cli";
import { REGION_DEF_MIN_TEXT } from "../core/firmware";
import { planName, summarize, type Change, type DeviceSnapshot, type Plan } from "../core/plan";
import type { DeviceRegions } from "../core/regions";
import type { Place } from "../core/search";
import { presetForRadio } from "../core/presets";
import { SETTINGS } from "../core/settings";
import { hasWebSerial, MAX_LINE_LEN } from "../device/serial";
import { t } from "../i18n/t";
import { answerReboot, applyPlan, cancelApply, connectUsb } from "../state/device";
import { SettingField } from "./Advanced";
import { PasswordField } from "./send/PasswordField";
import { busy, canApply, prefs, store, type ApplyState } from "../state/store";

/** Pref: send every setting, also the ones the repeater already holds (the old "Include unchanged defaults"). */
export const SEND_ALL_PREF = "configurator.includeDefaults";
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

const GUEST = SETTINGS.find((d) => d.key === "guestPassword")!;

/** One read-only value with a link to where it is changed. */
function ReadOnlyLine({ text }: { text: string }) {
  return (
    <div class="ro-line">
      <span>{text}</span>
      <button type="button" class="btn small link" disabled={busy.value} onClick={() => (store.step.value = "advanced")}>
        {t("send.change")}
      </button>
    </div>
  );
}

function BeforeYouSend() {
  const plan = store.plan.value;
  const preset = presetForRadio(plan.radio);
  const duty = rawOf(plan, "dutycycle");
  const tx = rawOf(plan, "txPower").trim();
  return (
    <section class="card card-before">
      <header class="card-head">
        <h3>{t("send.before")}</h3>
      </header>
      <PasswordField />
      <SettingField def={GUEST} />
      <ReadOnlyLine text={t("send.radio", { preset: preset ? preset.title : t("settings.preset.custom") })} />
      <ReadOnlyLine text={t("send.dutycycle", { value: t(`opt.dutycycle.${duty}`) })} />
      <ReadOnlyLine text={t("send.txPower", { value: tx || t("send.txPowerKept") })} />
    </section>
  );
}

function Changes() {
  const { changes, adminPassword } = summarize(store.plan.value, store.snapshot.value ?? undefined);
  return (
    <div class="review-changes">
      <BeforeYouSend />
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
      : state.phase === "readBack"
        ? { sent: state.total, total: state.total, text: t("apply.readingBack", { total: state.total }) }
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

/**
 * The script the Send step shows and Apply sends: after a Read (`snapshot`) only the changes; with
 * `sendAll`, every setting, still with the access list changes against that Read.
 */
function sendScript(
  plan: Plan,
  places: Place[],
  device: DeviceRegions | undefined,
  snapshot: DeviceSnapshot | undefined,
  sendAll: boolean,
): ScriptGroup[] {
  const changes = buildScript(plan, places, { includeDefaults: true, device, snapshot });
  if (!snapshot || !sendAll) return changes;
  return [...buildScript(plan, places, { includeDefaults: true, device }), ...changes.filter((g) => g.titleKey === "acl")];
}

function readSendAll(): boolean {
  return prefs.get(SEND_ALL_PREF) === "1";
}

export function Send() {
  const [sendAll, setSendAll] = useState(readSendAll);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [flash, setFlash] = useState<{ kind: NoticeKind; text: string } | null>(null);
  const plan = store.plan.value;
  const places = store.data.value.places ?? [];
  const device = store.deviceRegions.value;
  const snapshot = store.snapshot.value ?? undefined;
  // Compared against a Read: only the changes go out. Apply sends what is shown.
  const against = sendAll ? undefined : snapshot;
  const script = sendScript(plan, places, device, snapshot, sendAll);
  const text = scriptText(
    script.map((g) => ({ ...g, lines: g.lines.map(visible) })),
    groupTitle,
  );
  const count = commandLines(script).length;
  const state = store.apply.value;
  const gate = canApply.value;
  const locked = busy.value;
  const name = planName(plan);
  const say = (kind: NoticeKind, msg: string) => setFlash({ kind, text: msg });
  const status = store.device.value.status;
  const saving = store.savingAcl.value;

  return (
    <div class="panel-body step-review">
      <h2>{name ? t("review.title", { name }) : t("review.titleNoName")}</h2>
      <p class="sub">{t("review.sub")}</p>
      <div class="review-layout">
        <Changes />
        <div class="review-send">
          <header class="send-head">
            <h3>{t(against ? "review.toSend" : "review.commands", { count })}</h3>
            {against ? <span class="badge">{t("review.unchanged", { count: unchangedCount(plan, places, against) })}</span> : null}
          </header>
          {snapshot ? (
            <label class="toggle">
              <input
                type="checkbox"
                role="switch"
                checked={sendAll}
                onChange={(e) => {
                  const on = (e.currentTarget as HTMLInputElement).checked;
                  setSendAll(on);
                  prefs.set(SEND_ALL_PREF, on ? "1" : "0");
                }}
              />
              {t("review.sendAll")}
            </label>
          ) : null}
          <Script text={text} />
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
                {gate.reasons
                  .filter((r, i, all) => all.findIndex((o) => o.key === r.key) === i)
                  .map((r) => (
                    <li key={r.key}>{t(r.key, r.params)}</li>
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
            <button type="button" class="btn" disabled={locked} onClick={() => (store.step.value = "regions")}>
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
              disabled={!gate.ok || locked || (!!against && !count)}
              onClick={() => {
                setFlash(null);
                void applyPlan(script);
              }}
            >
              {store.applying.value
                ? t("apply.sending")
                : !against
                  ? t("apply.button")
                  : count
                    ? t("apply.buttonChanges", { count })
                    : t("apply.nothing")}
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
            <button type="button" class="btn primary" onClick={() => void applyPlan(script, { skipFirmwareCheck: true })}>
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
            <button type="button" class="btn" disabled={saving} onClick={() => void answerReboot(false)}>
              {t("reboot.later")}
            </button>
            <button
              type="button"
              class="btn primary"
              disabled={saving || store.device.value.status !== "connected"}
              onClick={() => void answerReboot(true)}
            >
              {t("reboot.now")}
            </button>
          </>
        }
      >
        <p>{t("reboot.ask")}</p>
        {state.phase === "done" && state.radioChanged ? <p class="sub">{t("reboot.radioHint")}</p> : null}
        {saving ? <p class="sub">{t("reboot.savingAcl")}</p> : null}
      </Dialog>
    </div>
  );
}
