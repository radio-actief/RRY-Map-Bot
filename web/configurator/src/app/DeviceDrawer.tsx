/**
 * The 🛠 Device tools drawer (port of the old device tools card): clock, public key and adverts;
 * the private key and a vanity identity; backup export / import; reboot and OTA; factory reset.
 * Every device command goes through the busy lock in state/device.
 */
import nacl from "tweetnacl";
import { useEffect, useRef, useState } from "preact/hooks";
import { BackupError, exportBackup, importBackup } from "../core/backup";
import { isAllowedPrefix, searchVanity, VANITY_PREFIX, type VanityKey } from "../core/vanity";
import { t } from "../i18n/t";
import {
  deviceCommand,
  readPrivateKey,
  restartDevice,
  syncClock,
  writeIdentity,
  type RestartCommand,
} from "../state/device";
import { busy, store } from "../state/store";
import { Dialog } from "./Dialog";
import { Notice, type NoticeKind } from "./Notice";

/** The word the factory reset dialog asks for. */
const RESET_WORD = "RESET";
const BACKUP_FILE = "bemesh-repeater-config.json";
/** How long a Copy button says "Copied" (old flashButtonSpan). */
const FLASH_MS = 1600;
/** The vanity search works this long between yields to the UI, in ms. */
const VANITY_SLICE_MS = 25;
/** Keys tried per searchVanity call within a slice. */
const VANITY_BATCH = 32;

const MINUTE = 60_000;
const numbers = new Intl.NumberFormat("en");

/** The firmware's `clock` reply, "HH:MM - D/M/YYYY UTC", as a time; null when it does not parse. */
function parseClock(reply: string): number | null {
  const m = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(reply);
  if (!m) return null;
  const [h, min, d, mo, y] = m.slice(1).map(Number);
  return Date.UTC(y, mo - 1, d, h, min);
}

/**
 * How far the device clock was from this computer's when `reply` was read at `at` ("2 min behind",
 * "in sync"). The firmware reports whole minutes, so both sides are compared to the minute.
 */
export function clockOffset(reply: string, at: number): string | null {
  const device = parseClock(reply);
  if (device === null) return null;
  const minutes = Math.round((device - Math.floor(at / MINUTE) * MINUTE) / MINUTE);
  if (minutes === 0) return t("tools.clockInSync");
  const abs = Math.abs(minutes);
  const amount =
    abs < 120
      ? t("tools.minutes", { count: abs })
      : abs < 48 * 60
        ? t("tools.hours", { count: Math.floor(abs / 60) })
        : t("tools.days", { count: Math.floor(abs / (24 * 60)) });
  return t(minutes < 0 ? "tools.clockBehind" : "tools.clockAhead", { amount });
}

const reasonOf = (err: unknown) => (err instanceof Error && err.message ? err.message : String(err));

type Note = { kind: NoticeKind; text: string } | null;
type Modal = null | "reboot" | "ota" | "reset" | "vanity";

export function DeviceDrawer() {
  return store.drawerOpen.value ? <Drawer /> : null;
}

function Drawer() {
  const [note, setNote] = useState<Note>(null);
  const [modal, setModal] = useState<Modal>(null);
  /** The private key once read; it lives only while the drawer is open. */
  const [secret, setSecret] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [flash, setFlash] = useState<"pub" | "prv" | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { status, link } = store.device.value;
  const connected = status === "connected";
  const off = !connected || busy.value;
  const publicKey = store.snapshot.value?.publicKey;
  const clock = store.clock.value;

  const close = () => (store.drawerOpen.value = false);

  useEffect(() => {
    closeRef.current?.focus();
    return () => clearTimeout(flashTimer.current);
  }, []);

  // Escape closes the drawer; while a dialog is open, Escape belongs to the dialog.
  const modalOpen = modal !== null;
  useEffect(() => {
    if (modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  // Another (or no) device: forget its private key.
  useEffect(() => {
    setSecret(null);
    setShown(false);
  }, [link]);

  async function copy(text: string, which: "pub" | "prv") {
    try {
      await navigator.clipboard.writeText(text);
      setFlash(which);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
    } catch (err) {
      setNote({ kind: "error", text: t("tools.copyFailed", { reason: reasonOf(err) }) });
    }
  }

  async function sync() {
    setNote(null);
    const r = await syncClock();
    if (r) setNote(r.ok ? { kind: "ok", text: t("tools.synced") } : { kind: "error", text: t("tools.syncFailed", { reason: r.error }) });
  }

  async function advert(cmd: "advert.zerohop" | "advert") {
    setNote(null);
    const r = await deviceCommand(cmd);
    if (r) setNote(r.ok ? { kind: "ok", text: t("tools.advertSent") } : { kind: "error", text: t("tools.advertFailed", { reason: r.error }) });
  }

  /** The private key, read from the device on first use (old ensurePrivateKeyLoaded). */
  async function loadSecret(): Promise<string | null> {
    if (secret) return secret;
    setNote(null);
    const r = await readPrivateKey();
    if (!r) return null;
    if (!r.ok) {
      setNote({ kind: "error", text: t("tools.keyFailed", { reason: r.error }) });
      return null;
    }
    setSecret(r.reply);
    return r.reply;
  }

  async function reveal() {
    if (shown) setShown(false);
    else if (await loadSecret()) setShown(true);
  }

  async function copySecret() {
    const key = await loadSecret();
    if (key) await copy(key, "prv");
  }

  async function write(key: VanityKey) {
    setModal(null);
    setNote(null);
    const r = await writeIdentity(key);
    if (!r) return;
    if (!r.ok) setNote({ kind: "error", text: t("vanity.writeFailed", { reason: r.error }) });
    else if (r.confirmed) setNote({ kind: "ok", text: t("vanity.written", { key: key.publicKey }) });
    else
      setNote({
        kind: "warn",
        text: t("vanity.mismatch", { got: r.devicePub ?? t("vanity.noneInReply"), want: key.publicKey }),
      });
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(exportBackup(store.plan.peek()), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = BACKUP_FILE;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importJson(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setNote(null);
    try {
      const plan = importBackup(JSON.parse(await file.text()), store.data.peek().places ?? []);
      // An import is an edit: the plan now differs from what the last Read gave.
      store.plan.value = plan;
      store.notice.value = { kind: "ok", text: t("tools.imported") };
      close();
    } catch (err) {
      setNote({ kind: "error", text: t(err instanceof BackupError ? err.key : "backup.error.unknown") });
    }
  }

  function restart(cmd: RestartCommand) {
    setModal(null);
    close();
    void restartDevice(cmd);
  }

  return (
    <>
      <div class="drawer-backdrop" onClick={close} />
      <div class="drawer" role="dialog" aria-label={t("tools.title")}>
        <header class="drawer-head">
          <h2>{t("tools.title")}</h2>
          <button ref={closeRef} type="button" class="icon" aria-label={t("dialog.close")} onClick={close}>
            ✕
          </button>
        </header>
        {note ? <Notice kind={note.kind}>{note.text}</Notice> : null}

        <section class="drawer-section">
          <h3>{t("tools.device")}</h3>
          <div class="drawer-row">
            <span>{t("tools.clock")}</span>
            <span class="drawer-value" title={connected ? clock?.reply : undefined}>
              {connected && clock ? (clockOffset(clock.reply, clock.at) ?? clock.reply) : t("tools.clockUnknown")}{" "}
              <button type="button" class="link" title={t("tools.syncHint")} disabled={off} onClick={() => void sync()}>
                {t("tools.sync")}
              </button>
            </span>
          </div>
          <div class="drawer-actions">
            <button
              type="button"
              class="btn small"
              disabled={!connected || !publicKey}
              onClick={() => publicKey && void copy(publicKey, "pub")}
            >
              {flash === "pub" ? t("tools.copied") : t("tools.copyPublicKey")}
            </button>
            <button type="button" class="btn small" disabled={off} onClick={() => void advert("advert.zerohop")}>
              {t("tools.zeroHop")}
            </button>
            <button type="button" class="btn small" disabled={off} onClick={() => void advert("advert")}>
              {t("tools.flood")}
            </button>
          </div>
        </section>

        <section class="drawer-section">
          <h3>{t("tools.identity")}</h3>
          <div class="drawer-row">
            <span>{t("tools.privateKey")}</span>
            <span class="drawer-value">
              {shown ? null : <span aria-hidden="true">{t("tools.masked")}</span>}{" "}
              <button type="button" class="link" disabled={!shown && off} onClick={() => void reveal()}>
                {shown ? t("tools.hide") : t("tools.reveal")}
              </button>{" "}
              <button type="button" class="link" disabled={!secret && off} onClick={() => void copySecret()}>
                {flash === "prv" ? t("tools.copied") : t("tools.copy")}
              </button>
            </span>
          </div>
          {shown && secret ? <code class="secret">{secret}</code> : null}
          <div class="drawer-actions">
            <button type="button" class="btn small" disabled={off} onClick={() => setModal("vanity")}>
              {t("tools.vanity")}
            </button>
          </div>
        </section>

        <section class="drawer-section">
          <h3>{t("tools.backup")}</h3>
          <div class="drawer-actions">
            <button type="button" class="btn small" onClick={exportJson}>
              {t("tools.export")}
            </button>
            <button type="button" class="btn small" disabled={busy.value} onClick={() => fileRef.current?.click()}>
              {t("tools.import")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label={t("tools.importFile")}
              onChange={(e) => void importJson(e.currentTarget as HTMLInputElement)}
            />
          </div>
        </section>

        <section class="drawer-section">
          <h3>{t("tools.maintenance")}</h3>
          <div class="drawer-actions">
            <button type="button" class="btn small" disabled={off} onClick={() => setModal("reboot")}>
              {t("tools.reboot")}
            </button>
            <button type="button" class="btn small" disabled={off} onClick={() => setModal("ota")}>
              {t("tools.ota")}
            </button>
          </div>
        </section>

        <section class="drawer-section danger">
          <h3>{t("tools.danger")}</h3>
          <div class="drawer-actions">
            <button type="button" class="btn small danger" disabled={off} onClick={() => setModal("reset")}>
              {t("tools.reset")}
            </button>
          </div>
        </section>
      </div>

      {modal === "reboot" || modal === "ota" ? (
        <Dialog
          open
          title={modal === "reboot" ? t("tools.reboot") : t("tools.ota")}
          onClose={() => setModal(null)}
          actions={
            <>
              <button type="button" class="btn" onClick={() => setModal(null)}>
                {t("tools.cancel")}
              </button>
              <button
                type="button"
                class="btn primary"
                disabled={off}
                onClick={() => restart(modal === "reboot" ? "reboot" : "start ota")}
              >
                {modal === "reboot" ? t("tools.rebootNow") : t("tools.otaNow")}
              </button>
            </>
          }
        >
          <p>{modal === "reboot" ? t("tools.rebootConfirm") : t("tools.otaConfirm")}</p>
        </Dialog>
      ) : null}
      {modal === "reset" ? <ResetDialog disabled={off} onClose={() => setModal(null)} onReset={() => restart("erase")} /> : null}
      {modal === "vanity" ? <VanityDialog disabled={off} onClose={() => setModal(null)} onWrite={(k) => void write(k)} /> : null}
    </>
  );
}

/** Factory reset: the action is enabled only once exactly RESET is typed; it sends `erase`. */
function ResetDialog({ disabled, onClose, onReset }: { disabled: boolean; onClose: () => void; onReset: () => void }) {
  const [typed, setTyped] = useState("");
  return (
    <Dialog
      open
      title={t("tools.resetTitle")}
      onClose={onClose}
      actions={
        <>
          <button type="button" class="btn" onClick={onClose}>
            {t("tools.cancel")}
          </button>
          <button type="button" class="btn danger solid" disabled={disabled || typed !== RESET_WORD} onClick={onReset}>
            {t("tools.resetNow")}
          </button>
        </>
      }
    >
      <p class="danger-text">{t("tools.resetWarn")}</p>
      <label class="field">
        <span class="field-label">{t("tools.resetType", { word: RESET_WORD })}</span>
        <input
          type="text"
          class="dialog-input"
          autocomplete="off"
          spellcheck={false}
          value={typed}
          onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
    </Dialog>
  );
}

type VanityPhase =
  | { kind: "input" }
  | { kind: "running"; tried: number }
  | { kind: "found"; key: VanityKey; tried: number; secs: string };

/**
 * Vanity identity (old generateVanityKey): a hex prefix, a search that yields to the UI between
 * slices with a running count and Cancel, then the found key and the question to write it.
 */
function VanityDialog({
  disabled,
  onClose,
  onWrite,
}: {
  disabled: boolean;
  onClose: () => void;
  onWrite: (key: VanityKey) => void;
}) {
  const [prefix, setPrefix] = useState("");
  const [phase, setPhase] = useState<VanityPhase>({ kind: "input" });
  /** Bumped to stop a running search (Cancel, close). */
  const run = useRef(0);
  useEffect(() => () => void run.current++, []);

  const p = prefix.trim().toLowerCase();
  const error = !p ? null : !VANITY_PREFIX.test(p) ? t("vanity.invalid") : !isAllowedPrefix(p) ? t("vanity.notAllowed") : null;
  const valid = !!p && !error;

  function start() {
    const token = ++run.current;
    const begun = Date.now();
    let tried = 0;
    setPhase({ kind: "running", tried });
    const slice = () => {
      if (run.current !== token) return;
      const until = performance.now() + VANITY_SLICE_MS;
      do {
        const r = searchVanity(p, VANITY_BATCH, nacl);
        tried += r.tried;
        if (r.found) {
          setPhase({ kind: "found", key: r.found, tried, secs: ((Date.now() - begun) / 1000).toFixed(1) });
          return;
        }
      } while (performance.now() < until);
      setPhase({ kind: "running", tried });
      setTimeout(slice, 0);
    };
    setTimeout(slice, 0);
  }

  function stop() {
    run.current++;
    setPhase({ kind: "input" });
  }

  const actions =
    phase.kind === "input" ? (
      <>
        <button type="button" class="btn" onClick={onClose}>
          {t("tools.cancel")}
        </button>
        <button type="button" class="btn primary" disabled={!valid} onClick={start}>
          {t("vanity.generate")}
        </button>
      </>
    ) : phase.kind === "running" ? (
      <button type="button" class="btn" onClick={stop}>
        {t("tools.cancel")}
      </button>
    ) : (
      <>
        <button type="button" class="btn" onClick={onClose}>
          {t("vanity.discard")}
        </button>
        <button type="button" class="btn primary" disabled={disabled} onClick={() => onWrite(phase.key)}>
          {t("vanity.write")}
        </button>
      </>
    );

  return (
    <Dialog open title={t("vanity.title")} onClose={onClose} actions={actions}>
      {phase.kind === "found" ? (
        <>
          <p>{t("vanity.found", { count: numbers.format(phase.tried), secs: phase.secs })}</p>
          <span class="field-label">{t("vanity.publicKey")}</span>
          <code class="secret">{phase.key.publicKey}</code>
          <p>{t("vanity.writeQuestion")}</p>
        </>
      ) : (
        <>
          <label class="field">
            <span class="field-label">{t("vanity.prefix")}</span>
            <input
              type="text"
              class="dialog-input"
              maxLength={8}
              autocomplete="off"
              spellcheck={false}
              disabled={phase.kind === "running"}
              value={prefix}
              onInput={(e) => setPrefix((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <p class="sub">{t("vanity.hint")}</p>
          {error ? <p class="field-error">{error}</p> : null}
          {valid ? <p class="sub">{t("vanity.estimate", { count: numbers.format(16 ** p.length) })}</p> : null}
          {phase.kind === "running" ? (
            <p aria-live="polite">{t("vanity.progress", { count: numbers.format(phase.tried) })}</p>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
