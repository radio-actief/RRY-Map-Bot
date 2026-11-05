/** The command log and the interactive CLI console (old serial terminal), in a dialog. */
import { useEffect, useRef, useState } from "preact/hooks";
import { CLI_COMMANDS } from "../core/cli-commands";
import { lineBytes, MAX_LINE_LEN } from "../device/serial";
import { t } from "../i18n/t";
import { clearLog, sendConsole, SHOW_COMMAND_LOG_PREF } from "../state/device";
import { busy, prefs, store } from "../state/store";
import { Dialog } from "./Dialog";

/** How many console commands ArrowUp can recall (old SERIAL_CONSOLE_HISTORY_MAX). */
export const HISTORY_MAX = 50;

/** Console history for this page session, kept while the dialog is closed. */
const history: string[] = [];

/** A private key typed with `set prv.key` is never kept. */
const SECRET_LINE = /^set\s+prv\.key\b/i;

function remember(cmd: string): void {
  if (SECRET_LINE.test(cmd) || history[history.length - 1] === cmd) return;
  history.push(cmd);
  if (history.length > HISTORY_MAX) history.shift();
}

export function Console({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [browse, setBrowse] = useState(-1);
  const [showLog, setShowLog] = useState(() => prefs.get(SHOW_COMMAND_LOG_PREF) === "1");
  const logRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lines = store.log.value;
  const disabled = store.device.value.status !== "connected" || busy.value;

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  async function submit(e: Event) {
    e.preventDefault();
    const cmd = value.trim();
    setValue("");
    setBrowse(-1);
    if (!cmd) return;
    if (lineBytes(cmd) <= MAX_LINE_LEN) remember(cmd);
    await sendConsole(cmd);
    inputRef.current?.focus({ preventScroll: true });
  }

  /** ArrowUp / ArrowDown walk the history (old onSerialConsoleKeydown). */
  function keydown(e: KeyboardEvent) {
    if (!history.length) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const i = browse < 0 ? history.length - 1 : Math.max(0, browse - 1);
      setBrowse(i);
      setValue(history[i]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (browse < 0) return;
      const i = browse + 1;
      setBrowse(i >= history.length ? -1 : i);
      setValue(i >= history.length ? "" : history[i]);
    }
  }

  return (
    <Dialog
      open={open}
      title={t("console.title")}
      onClose={onClose}
      actions={
        <>
          <button type="button" class="btn" disabled={!lines.length} onClick={clearLog}>
            {t("console.clear")}
          </button>
          <button type="button" class="btn primary" onClick={onClose}>
            {t("dialog.close")}
          </button>
        </>
      }
    >
      <label class="toggle" title={t("console.showLogHint")}>
        <input
          type="checkbox"
          checked={showLog}
          onChange={(e) => {
            const on = (e.currentTarget as HTMLInputElement).checked;
            setShowLog(on);
            prefs.set(SHOW_COMMAND_LOG_PREF, on ? "1" : "0");
          }}
        />
        {t("console.showLog")}
      </label>
      <div class="terminal">
        <pre class="console-log" ref={logRef} aria-live="polite">
          {lines.length
            ? lines.map((l, i) => (
                <div key={i} class={`log-line ${l.kind}`}>
                  {l.text}
                </div>
              ))
            : <div class="log-line muted">{t("console.empty")}</div>}
        </pre>
        <form class="console-form" onSubmit={(e) => void submit(e)}>
          <span class="prompt" aria-hidden="true">
            {">"}
          </span>
          <input
            ref={inputRef}
            type="text"
            aria-label={t("console.input")}
            placeholder={t("console.placeholder")}
            title={t("console.inputHint", { max: MAX_LINE_LEN })}
            list="console-commands"
            maxLength={MAX_LINE_LEN}
            autocomplete="off"
            spellcheck={false}
            disabled={disabled}
            value={value}
            onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={keydown}
          />
          <button type="submit" class="btn small" disabled={disabled}>
            {t("console.send")}
          </button>
        </form>
        <datalist id="console-commands">
          {CLI_COMMANDS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
    </Dialog>
  );
}
