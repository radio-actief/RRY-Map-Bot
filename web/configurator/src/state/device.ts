/**
 * Device actions shared by the steps, the drawer and Apply: connect, disconnect, Read, Apply, the
 * console, and the drawer's commands (clock, adverts, identity, reboot / OTA / factory reset).
 */
import { effect } from "@preact/signals";
import { buildScript, commandLines } from "../core/cli";
import { deviceRegionsFromSnapshot, planFromSnapshot } from "../core/plan";
import { policyFor, regionsAfterApply } from "../core/regions";
import { REGION_DEF_MIN_TEXT } from "../core/firmware";
import { pubkeyFromSetReply, type VanityKey } from "../core/vanity";
import { apply, checkFirmware, readAll, READ_COMMANDS, run } from "../device/repeater";
import {
  expectsDeviceDisconnect,
  isErrorReply,
  lineBytes,
  MAX_LINE_LEN,
  requestUsbPort,
  SerialLink,
  type LinkTiming,
  type PortLike,
} from "../device/serial";
import { t } from "../i18n/t";
import { busy, canApply, prefs, resetPlan, store, type LogLine } from "./store";

const reasonOf = (err: unknown) => (err instanceof Error && err.message ? err.message : String(err));

const NO_DEVICE = { status: "none", link: null, firmware: null } as const;

/** Pref: also log every Read command and reply (old "Show command log"). */
export const SHOW_COMMAND_LOG_PREF = "configurator.serialShowCommandLog";

export type ConnectDeps = { requestPort?: () => Promise<PortLike>; timing?: Partial<LinkTiming> };

/** The command log keeps this many lines; older ones drop off. */
export const LOG_MAX = 500;

/** Add lines to the command log in one update, keeping the last LOG_MAX. */
export function appendLog(...lines: LogLine[]): void {
  const prev = store.log.peek();
  const keep = Math.max(0, prev.length + lines.length - LOG_MAX);
  store.log.value = keep ? [...prev.slice(keep), ...lines].slice(-LOG_MAX) : [...prev, ...lines];
}

export function clearLog(): void {
  store.log.value = [];
}

/**
 * Masks the private key of a `set prv.key` line wherever it shows up (the command, a reply that
 * echoes it in full or in part, a "line too long" error that quotes its start), and any hex that
 * follows `prv.key`. Used for the log and for every reply or error text a drawer command hands back.
 */
export function secretMask(cmd: string): (text: string) => string {
  const hidden = t("log.hidden");
  const secret = /^set\s+prv\.key\s+(\S+)/i.exec(cmd)?.[1];
  return (text) => {
    const masked = text
      .replace(/(set\s+prv\.key)\s+\S+/gi, `$1 ${hidden}`)
      .replace(/(prv\.key)\s+[0-9a-f]+/gi, `$1 ${hidden}`);
    return secret ? masked.split(secret).join(hidden) : masked;
  };
}

/** A `get prv.key` line: its reply is the private key. */
const READS_SECRET = /^get\s+prv\.key$/i;

/** One command and its reply in the log (old logSerialCommandReply); private keys are masked. */
function logCommand(cmd: string, rawReply: string | null, error?: string): void {
  if (store.reading.peek() && prefs.get(SHOW_COMMAND_LOG_PREF) !== "1") return;
  const mask = secretMask(cmd);
  const reply = rawReply && READS_SECRET.test(cmd) && !isErrorReply(rawReply) ? t("log.hidden") : rawReply && mask(rawReply);
  const sent: LogLine = { text: t("log.command", { command: mask(cmd) }), kind: "cmd" };
  let answer: LogLine;
  if (error !== undefined) answer = { text: t("log.reply", { reply: mask(error) }), kind: "error" };
  else if (reply) answer = { text: t("log.reply", { reply }), kind: isErrorReply(reply) ? "error" : "ok" };
  else if (expectsDeviceDisconnect(cmd)) answer = { text: t("log.disconnecting"), kind: "ok" };
  else answer = { text: t("log.noReply"), kind: "muted" };
  appendLog(sent, answer);
}

const logged = new WeakSet<SerialLink>();
effect(() => {
  const link = store.device.value.link;
  if (!link || logged.has(link)) return;
  logged.add(link);
  link.onCommand(logCommand);
});

// A changed plan, or coming back to step 5, starts Apply afresh (old notices and progress go).
let lastPlan = store.plan.peek();
let lastStep = store.step.peek();
effect(() => {
  const plan = store.plan.value;
  const step = store.step.value;
  const fresh = plan !== lastPlan || (step === 5 && lastStep !== 5);
  lastPlan = plan;
  lastStep = step;
  if (fresh && !store.applying.peek() && store.apply.peek().phase !== "idle") store.apply.value = { phase: "idle" };
});

/** A link that is about to drop on purpose (reboot and friends): its disconnect is not an error. */
let leaving: SerialLink | null = null;

/**
 * Forget what the last Read told about a device (its snapshot, clock, regions and the Read's
 * outcome), so nothing of it is shown for or used against another device. The plan stays.
 */
function forgetRead(): void {
  store.snapshot.value = null;
  store.clock.value = null;
  store.deviceRegions.value = undefined;
  store.lastRead.value = null;
}

/** The device is gone: forget it and its Read, with the unplug notice unless it left on purpose. */
function dropped(link: SerialLink): void {
  if (store.device.peek().link !== link) return;
  store.device.value = NO_DEVICE;
  forgetRead();
  if (leaving === link) leaving = null;
  else store.notice.value = { kind: "error", text: t("connect.unplugged") };
}

/** Ask for a port, open it and check the firmware once (old connectSerialUsb). */
export async function connectUsb({ requestPort = requestUsbPort, timing }: ConnectDeps = {}): Promise<void> {
  let port: PortLike;
  try {
    port = await requestPort();
  } catch (err) {
    // The user closed the port picker: nothing to report.
    if (err instanceof Error && err.name === "NotFoundError") return;
    store.notice.value = { kind: "error", text: t("connect.failed", { reason: reasonOf(err) }) };
    return;
  }
  store.notice.value = null;
  forgetRead();
  store.apply.value = { phase: "idle" };
  store.device.value = { status: "connecting", link: null, firmware: null };
  const link = new SerialLink(port, timing);
  link.onDisconnect(() => dropped(link));
  try {
    await link.open();
  } catch (err) {
    store.device.value = NO_DEVICE;
    store.notice.value = { kind: "error", text: t("connect.failed", { reason: reasonOf(err) }) };
    return;
  }
  // Unplugged while the port opened or the boot output drained.
  if (!link.connected) {
    store.device.value = NO_DEVICE;
    store.notice.value = { kind: "error", text: t("connect.unplugged") };
    return;
  }
  store.device.value = { status: "connected", link, firmware: null, usb: port.getInfo?.() ?? null };
  const fw = await checkFirmware(link);
  if (store.device.peek().link === link) store.device.value = { ...store.device.peek(), firmware: fw.version };
}

/** Close on purpose (old disconnectSerialUsb): no unplug notice, and the device's Read is forgotten. */
export async function disconnectUsb(): Promise<void> {
  const link = store.device.peek().link;
  store.device.value = NO_DEVICE;
  forgetRead();
  await link?.close();
}

/**
 * Every read command, then the plan from the replies (old performReadFromRepeater). When the link
 * was lost or closed during the Read, nothing is taken over: plan, snapshot and device regions stay.
 */
export async function readDevice(): Promise<void> {
  const link = store.device.peek().link;
  if (!link || busy.peek()) return;
  store.reading.value = true;
  store.lastRead.value = null;
  try {
    const snapshot = await readAll(link);
    if (!link.connected || store.device.peek().link !== link) {
      store.lastRead.value = { ok: false, reason: t("read.linkLost") };
      return;
    }
    store.snapshot.value = snapshot;
    store.clock.value = snapshot.clock ? { reply: snapshot.clock, at: Date.now() } : null;
    store.deviceRegions.value = deviceRegionsFromSnapshot(snapshot);
    resetPlan(planFromSnapshot(snapshot, store.data.peek().places ?? []));
    store.lastRead.value = { ok: true, count: READ_COMMANDS.length - snapshot.missing.length, missing: snapshot.missing };
  } catch (err) {
    store.lastRead.value = { ok: false, reason: reasonOf(err) };
  } finally {
    store.reading.value = false;
  }
}

/** Lines whose change only takes effect after a reboot (old offerRepeaterReboot hint). */
const NEEDS_REBOOT = /^set (radio|freq|radio\.rxgain) /;

/**
 * Apply (old applyToRepeater). Nothing is sent when there are no commands or a line is over the
 * console's length limit. Then `ver` is re-read: old firmware stops here, unreadable firmware waits
 * for "Continue anyway" (which calls this again with skipFirmwareCheck). The full script is sent,
 * unchanged defaults included as the old page did, stopping at the first failure. On success the
 * device regions become what was sent and a reboot is offered, never sent.
 */
export async function applyPlan({ skipFirmwareCheck = false } = {}): Promise<void> {
  const link = store.device.peek().link;
  if (!link || busy.peek() || !canApply.peek().ok) return;
  store.applying.value = true;
  try {
    const plan = store.plan.peek();
    const places = store.data.peek().places ?? [];
    const lines = commandLines(buildScript(plan, places, { includeDefaults: true, device: store.deviceRegions.peek() }));
    if (!lines.length) {
      store.apply.value = { phase: "empty" };
      return;
    }
    const tooLong = lines.filter((l) => lineBytes(l) > MAX_LINE_LEN);
    if (tooLong.length) {
      store.apply.value = { phase: "tooLong", lines: tooLong };
      return;
    }
    if (!skipFirmwareCheck) {
      store.apply.value = { phase: "checking" };
      const fw = await checkFirmware(link);
      // Unplugged during the check: the unplug notice says it all.
      if (!link.connected || store.device.peek().link !== link) {
        store.apply.value = { phase: "idle" };
        return;
      }
      if (fw.state !== "unknown") store.device.value = { ...store.device.peek(), firmware: fw.version };
      if (fw.state === "old") {
        store.apply.value = { phase: "old", version: fw.version ?? "" };
        appendLog({ text: t("apply.firmwareOld", { version: fw.version ?? "", min: REGION_DEF_MIN_TEXT }), kind: "error" });
        return;
      }
      if (fw.state === "unknown") {
        store.apply.value = { phase: "unknown" };
        return;
      }
    }
    const total = lines.length;
    appendLog({ text: t("log.separator"), kind: "sep" }, { text: t("log.applying", { count: total }), kind: "muted" });
    store.apply.value = { phase: "sending", sent: 0, total };
    const result = await apply(link, lines, (sent) => (store.apply.value = { phase: "sending", sent, total }));
    if (!result.ok) {
      const { failedAt, command, error, remaining } = result;
      store.apply.value = { phase: "failed", failedAt, total, command, error, remaining };
      appendLog({ text: t("apply.stopped", { n: failedAt, total, command }), kind: "error" });
      return;
    }
    if (plan.anchor) {
      store.deviceRegions.value = regionsAfterApply(plan.anchor, plan.regions ?? policyFor(plan.anchor, places), places);
    }
    appendLog({ text: t("log.applied"), kind: "ok" });
    store.apply.value = { phase: "done", total, offerReboot: true, radioChanged: lines.some((l) => NEEDS_REBOOT.test(l)) };
  } catch (err) {
    store.apply.value = { phase: "error", reason: reasonOf(err) };
    appendLog({ text: t("apply.error", { reason: reasonOf(err) }), kind: "error" });
  } finally {
    store.applying.value = false;
  }
}

/** Close the firmware question or the failure without doing anything. */
export function cancelApply(): void {
  if (!store.applying.peek()) store.apply.value = { phase: "idle" };
}

/** Answer the reboot offer: Later closes it, Reboot now sends `reboot` and the link drops as expected. */
export async function answerReboot(reboot: boolean): Promise<void> {
  const state = store.apply.peek();
  if (state.phase === "done") store.apply.value = { ...state, offerReboot: false };
  if (reboot) await rebootDevice();
}

/**
 * Send one command that may make the link drop on purpose, holding the busy lock until it has
 * settled; such a drop is not reported as an unplug. Returns the error when sending threw.
 */
async function sendHeld(link: SerialLink, cmd: string): Promise<string | null> {
  const quits = expectsDeviceDisconnect(cmd);
  if (quits) leaving = link;
  store.commandBusy.value = true;
  try {
    await run(link, cmd);
    return null;
  } catch (err) {
    return reasonOf(err);
  } finally {
    if (quits && !link.connected) dropped(link);
    if (leaving === link) leaving = null;
    store.commandBusy.value = false;
  }
}

/** What the notice says after each command that restarts the device or switches its mode. */
const RESTART_TEXTS = {
  reboot: { sent: "apply.rebootSent", failed: "apply.rebootFailed", noDevice: "apply.rebootNoDevice" },
  "start ota": { sent: "tools.otaSent", failed: "tools.otaFailed", noDevice: "tools.noDevice" },
  erase: { sent: "tools.resetSent", failed: "tools.resetFailed", noDevice: "tools.noDevice" },
} as const;

export type RestartCommand = keyof typeof RESTART_TEXTS;

/**
 * Send `reboot`, `start ota` or `erase` (factory reset) as the old page did; the disconnect that
 * follows is not an error, and the notice says to reconnect once the device is back.
 */
export async function restartDevice(cmd: RestartCommand): Promise<void> {
  const texts = RESTART_TEXTS[cmd];
  const link = store.device.peek().link;
  if (!link?.connected || busy.peek()) {
    if (!link?.connected) store.notice.value = { kind: "error", text: t(texts.noDevice) };
    return;
  }
  const error = await sendHeld(link, cmd);
  store.notice.value = error
    ? { kind: "error", text: t(texts.failed, { reason: error }) }
    : { kind: "ok", text: t(texts.sent) };
}

/** Send `reboot` (port of offerRepeaterReboot's tail); the disconnect that follows is not an error. */
export function rebootDevice(): Promise<void> {
  return restartDevice("reboot");
}

/** A drawer command's outcome: the reply, or why it failed (error reply, no reply, link lost). */
export type CommandResult = { ok: true; reply: string } | { ok: false; error: string };

/**
 * One command and its reply, without the lock. A private key sent with `set prv.key` is masked in
 * whatever comes back, so it cannot reach a notice.
 */
async function exchange(link: SerialLink, cmd: string): Promise<CommandResult> {
  const mask = secretMask(cmd);
  try {
    const reply = await run(link, cmd);
    if (!reply) return { ok: false, error: t("tools.noReply") };
    return isErrorReply(reply) ? { ok: false, error: mask(reply) } : { ok: true, reply: mask(reply) };
  } catch (err) {
    return { ok: false, error: mask(reasonOf(err)) };
  }
}

/**
 * Run `fn` holding the busy lock, on the connected link; null (nothing sent) when there is no
 * device or something else (Read, Apply, the console, another drawer action) is talking to it.
 */
async function withLock<T>(fn: (link: SerialLink) => Promise<T>): Promise<T | null> {
  const link = store.device.peek().link;
  if (!link?.connected || busy.peek()) return null;
  store.commandBusy.value = true;
  try {
    return await fn(link);
  } finally {
    store.commandBusy.value = false;
  }
}

/** One drawer command (old runDeviceCommand), e.g. `advert.zerohop` or `advert`. */
export function deviceCommand(cmd: string): Promise<CommandResult | null> {
  return withLock((link) => exchange(link, cmd));
}

/** Set the device clock to this computer's time (`time <epoch>`), then read `clock` again. */
export function syncClock(): Promise<CommandResult | null> {
  return withLock(async (link) => {
    const set = await exchange(link, `time ${Math.floor(Date.now() / 1000)}`);
    if (!set.ok) return set;
    const clock = await exchange(link, "clock");
    if (clock.ok) store.clock.value = { reply: clock.reply, at: Date.now() };
    return set;
  });
}

/** The private key (old ensurePrivateKeyLoaded's `get prv.key`), without the firmware's `> `. */
export async function readPrivateKey(): Promise<CommandResult | null> {
  const r = await deviceCommand("get prv.key");
  if (!r?.ok) return r;
  const key = r.reply.replace(/^\s*>\s*/, "").trim();
  return key ? { ok: true, reply: key } : { ok: false, error: t("tools.noReply") };
}

/** The outcome of writing a vanity identity: whether the public key the device reports is the expected one. */
export type IdentityResult = { ok: true; confirmed: boolean; devicePub: string | null } | { ok: false; error: string };

/**
 * Write a generated identity with `set prv.key` and check the public key in the reply (part 0's
 * fix). The read public key becomes the one the device reports it saved, pending a reboot.
 */
export async function writeIdentity(key: VanityKey): Promise<IdentityResult | null> {
  const r = await deviceCommand(`set prv.key ${key.privateKey}`);
  if (!r?.ok) return r;
  const devicePub = pubkeyFromSetReply(r.reply);
  const snap = store.snapshot.peek();
  if (snap) store.snapshot.value = { ...snap, publicKey: devicePub ?? undefined, publicKeyPending: true };
  return { ok: true, confirmed: devicePub === key.publicKey, devicePub };
}

/** One console line (old sendSerialConsoleCommand); the reply lands in the log. */
export async function sendConsole(line: string): Promise<void> {
  const cmd = line.trim();
  const link = store.device.peek().link;
  if (!cmd || !link?.connected || busy.peek()) return;
  if (lineBytes(cmd) > MAX_LINE_LEN) {
    appendLog({ text: t("log.tooLong", { length: lineBytes(cmd), max: MAX_LINE_LEN }), kind: "error" });
    return;
  }
  await sendHeld(link, cmd);
}
