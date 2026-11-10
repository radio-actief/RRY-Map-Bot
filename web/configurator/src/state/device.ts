/**
 * Device actions shared by the steps, the drawer and Apply: connect, disconnect, Read, Apply, the
 * console, and the drawer's commands (clock, adverts, identity, reboot / OTA / factory reset).
 */
import { effect } from "@preact/signals";
import { commandLines, type ScriptGroup } from "../core/cli";
import { deviceRegionsFromSnapshot, planFromSnapshot, regionCandidates, type DeviceSnapshot, type Plan } from "../core/plan";
import { policyFor, regionsAfterApply } from "../core/regions";
import { REGION_DEF_MIN_TEXT } from "../core/firmware";
import { heardWell, neighboursCut, parseNeighbours, type Neighbour } from "../core/neighbours";
import { pubkeyFromSetReply, type VanityKey } from "../core/vanity";
import { apply, checkFirmware, IDENTITY_READS, readAll, readCount, READ_BACK_COMMANDS, READ_COMMANDS, run, stoppedApply } from "../device/repeater";
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
import { I18N, t } from "../i18n/t";
import { siteTools, toolText } from "../app/pages";
import { askRelease, deviceHeld, deviceReleased, holderOf } from "./devicebus";
import { busy, canApply, prefs, resetPlan, store, type ClockOutcome, type LogLine } from "./store";

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

/** The read-back after Apply is running: its commands stay out of the log, like a Read's. */
let readingBack = false;

/** One command and its reply in the log (old logSerialCommandReply); private keys are masked. */
function logCommand(cmd: string, rawReply: string | null, error?: string): void {
  if ((store.reading.peek() || readingBack) && prefs.get(SHOW_COMMAND_LOG_PREF) !== "1") return;
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

// A changed plan, or coming back to Send, starts Apply afresh (old notices and progress go).
let lastPlan = store.plan.peek();
let lastStep = store.step.peek();
effect(() => {
  const plan = store.plan.value;
  const step = store.step.value;
  const fresh = plan !== lastPlan || (step === "send" && lastStep !== "send");
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
  store.tune.value = { phase: "idle" };
  store.clock.value = null;
  store.deviceRegions.value = undefined;
  store.lastRead.value = null;
}

/** The device is gone: forget it and its Read, with the unplug notice unless it left on purpose. */
function dropped(link: SerialLink): void {
  if (store.device.peek().link !== link) return;
  const usb = store.device.peek().usb;
  store.device.value = NO_DEVICE;
  deviceReleased(usb);
  forgetRead();
  if (leaving === link) leaving = null;
  else store.notice.value = { kind: "error", text: t("connect.unplugged") };
}

/** Ask the tab that holds this port to let go, then open it here. */
async function takeOver(port: PortLike, timing?: ConnectDeps["timing"]): Promise<void> {
  const usb = port.getInfo?.() ?? null;
  const answer = await askRelease(usb);
  if (answer === "busy") {
    store.notice.value = { kind: "warn", text: t("device.busyElsewhere", { tool: toolName(holderOf(usb) ?? "") }) };
    return;
  }
  await connectUsb({ requestPort: async () => port, timing });
}

/** A tool's name in the page language: its page name when known, else the key itself. */
function toolName(key: string): string {
  const pageKey = `page.${key}`;
  return I18N.has(pageKey) ? t(pageKey) : key;
}

/** Links to the site's tools for a device the configurator can't use (a companion). */
function otherTools(): { label: string; href: string }[] {
  return siteTools.peek()
    .filter((x) => x.key === "meshmate" || x.key === "nodebook")
    .map((x) => ({ label: t("device.openIn", { tool: toolText(x) }), href: x.url }));
}

/** Ask for a port, open it and check the firmware once (old connectSerialUsb). */
export async function connectUsb({ requestPort = requestUsbPort, timing }: ConnectDeps = {}): Promise<void> {
  let port: PortLike;
  try {
    port = await requestPort();
  } catch (err) {
    // The picker closed without a device: often an empty list (charge-only cable, flasher tab, driver).
    if (err instanceof Error && err.name === "NotFoundError") {
      store.notice.value = { kind: "warn", text: t("connect.noDevice") };
      return;
    }
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
    const holder = portBusy(err) ? holderOf(port.getInfo?.()) : null;
    store.notice.value = holder
      ? {
          kind: "warn",
          text: t("device.heldElsewhere", { tool: toolName(holder) }),
          actions: [{ label: t("device.takeOver"), run: () => void takeOver(port, timing) }],
        }
      : { kind: "error", text: portBusy(err) ? t("connect.busy") : t("connect.failed", { reason: reasonOf(err) }) };
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
  if (store.device.peek().link !== link) return;
  store.device.value = { ...store.device.peek(), firmware: fw.version };
  deviceHeld();
  // No version: other firmware (Companion, Meshtastic), or a board still starting or asleep.
  if (fw.state === "unknown" && link.connected) {
    const links = otherTools();
    store.notice.value = { kind: "warn", text: links.length ? `${t("connect.noAnswer")} ${t("device.companionTools")}` : t("connect.noAnswer"), links };
  }
}

/** Opening failed because the port is already open: in another tab (the flasher), another app, or here. */
function portBusy(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  return name === "NetworkError" || name === "InvalidStateError" || /failed to open serial port/i.test(reasonOf(err));
}

/** Close on purpose (old disconnectSerialUsb): no unplug notice, and the device's Read is forgotten. */
export async function disconnectUsb(): Promise<void> {
  const { link, usb } = store.device.peek();
  store.device.value = NO_DEVICE;
  forgetRead();
  await link?.close();
  if (link) deviceReleased(usb);
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
    const places = () => store.data.peek().places ?? [];
    const snapshot = await readAll(link, READ_COMMANDS, (partial) => regionCandidates(planFromSnapshot(partial, places())));
    if (!link.connected || store.device.peek().link !== link) {
      store.lastRead.value = { ok: false, reason: t("read.linkLost") };
      return;
    }
    store.snapshot.value = snapshot;
    store.clock.value = snapshot.clock ? { reply: snapshot.clock, at: Date.now() } : null;
    store.deviceRegions.value = deviceRegionsFromSnapshot(snapshot);
    resetPlan(planFromSnapshot(snapshot, store.data.peek().places ?? []));
    store.lastRead.value = { ok: true, count: readCount(snapshot), missing: snapshot.missing };
    deviceHeld();
  } catch (err) {
    store.lastRead.value = { ok: false, reason: reasonOf(err) };
  } finally {
    store.reading.value = false;
  }
}

/** Snapshot fields the read-back keeps from the last Read (a written key waits for a reboot). */
const KEPT_ON_READ_BACK = ["version", "role", "publicKey", "publicKeyPending", "previousPublicKeys", "clock", "neighbours"] as const;

/** A `set radio <freq,bw,sf,cr>` line (not `set radio.rxgain`). */
const RADIO_LINE = /^set radio /;

/**
 * After Apply: read back what Apply can change, so the repeater's values on screen are the new
 * ones and the device regions carry the tree. The identity, firmware version and clock stay from
 * the last Read, and so does the radio when `lines` (what was sent) had no radio line. When the
 * link goes, the regions that were sent stand in.
 */
async function readBack(link: SerialLink, sent: Plan, lines: string[]): Promise<void> {
  readingBack = true;
  try {
    const radioSent = lines.some((l) => RADIO_LINE.test(l));
    const commands = radioSent ? READ_BACK_COMMANDS : READ_BACK_COMMANDS.filter((c) => c !== "get radio");
    const fresh = await readAll(link, commands, () => regionCandidates(sent));
    if (!link.connected || store.device.peek().link !== link) return;
    const old = store.snapshot.peek();
    const snapshot: DeviceSnapshot = { ...fresh };
    if (old) for (const k of KEPT_ON_READ_BACK) if (old[k] !== undefined) Object.assign(snapshot, { [k]: old[k] });
    const kept = radioSent ? IDENTITY_READS : [...IDENTITY_READS, "get radio"];
    if (!radioSent && old?.radio) snapshot.radio = old.radio;
    snapshot.missing = [...fresh.missing, ...(old ? old.missing : kept).filter((c) => kept.includes(c))];
    store.snapshot.value = snapshot;
    const regions = deviceRegionsFromSnapshot(snapshot);
    if (regions) store.deviceRegions.value = regions;
    if (store.lastRead.peek()?.ok) {
      store.lastRead.value = { ok: true, count: readCount(snapshot), missing: snapshot.missing };
    }
  } catch {
    /* link lost: the unplug notice says it */
  } finally {
    readingBack = false;
  }
}

/**
 * Set the repeater's clock to this computer's time (`time <epoch>`). The firmware only moves a
 * clock forward: a clock that runs ahead answers "clock cannot go backwards". A set clock's reply
 * ("OK - clock set: 08:00 - 15/1/2027 UTC") also becomes the drawer's clock reading.
 */
async function setClock(link: SerialLink): Promise<ClockOutcome> {
  let reply: string;
  try {
    reply = await run(link, `time ${Math.floor(Date.now() / 1000)}`);
  } catch (err) {
    return { failed: reasonOf(err) };
  }
  if (/cannot go backwards/i.test(reply)) return "ahead";
  if (!reply || isErrorReply(reply)) return { failed: reply || t("tools.noReply") };
  const shown = /clock set:\s*(.+)$/i.exec(reply)?.[1];
  if (shown) store.clock.value = { reply: shown.trim(), at: Date.now() };
  return "set";
}

/** Lines whose change only takes effect after a reboot (old offerRepeaterReboot hint). */
const NEEDS_REBOOT = /^set (radio|freq|radio\.rxgain) /;

const SETPERM = /^setperm /;

/** The firmware saves the access list 5 s after its last change; a reboot waits a second longer. */
export const ACL_SAVE_WAIT_MS = 6000;

/**
 * Apply (old applyToRepeater) sends `script`, the one the Send step shows. Nothing is sent when
 * there are no commands or a line is over the console's length limit. Then `ver` is re-read: old
 * firmware stops here, unreadable firmware waits for "Continue anyway" (which calls this again with
 * skipFirmwareCheck). The lines go out in order, stopping at the first failure; once a `setperm`
 * line went out, a reboot waits for the access list save (see waitForAclSave). On success the plan
 * that was sent becomes the starting point, the clock is set (see setClock), the repeater is read
 * back (see readBack) and a reboot is offered, never sent.
 */
export async function applyPlan(script: ScriptGroup[], { skipFirmwareCheck = false } = {}): Promise<void> {
  const link = store.device.peek().link;
  if (!link || busy.peek() || !canApply.peek().ok) return;
  store.applying.value = true;
  try {
    const plan = store.plan.peek();
    const places = store.data.peek().places ?? [];
    const lines = commandLines(script);
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
    // The access list lines come last: their save counts from now.
    if (lines.slice(0, result.ok ? total : result.failedAt).some((l) => SETPERM.test(l))) {
      store.aclSaveUntil.value = Date.now() + ACL_SAVE_WAIT_MS;
    }
    if (!result.ok) {
      const { failedAt, command, error, remaining, silent, silentLines } = result;
      // Lines that got no reply may still have gone through: the silent stop counts them as sent.
      const stopped = silent
        ? stoppedApply(lines, failedAt + 1, silentLines ?? [])
        : stoppedApply(lines, failedAt);
      store.apply.value = { phase: "failed", failedAt, total, command, error, remaining, ...stopped, ...(silent ? { silent } : {}) };
      appendLog({ text: silent ? t("apply.silent", { lines: silent }) : t("apply.stopped", { n: failedAt, total, command }), kind: "error" });
      return;
    }
    if (plan.anchor) {
      store.deviceRegions.value = regionsAfterApply(plan.anchor, plan.regions ?? policyFor(plan.anchor, places), places);
    }
    // The repeater now holds the plan that was sent: it is the new starting point.
    store.planBase.value = plan;
    store.startPlan.value = plan;
    const clock = await setClock(link);
    store.apply.value = { phase: "readBack", total };
    await readBack(link, plan, lines);
    appendLog({ text: t("log.applied"), kind: "ok" });
    if (result.silent.length) appendLog({ text: t("apply.savedSilent", { count: result.silent.length }), kind: "muted" });
    const stillConnected = link.connected && store.device.peek().link === link;
    store.apply.value = {
      phase: "done",
      total,
      offerReboot: stillConnected,
      radioChanged: lines.some((l) => NEEDS_REBOOT.test(l)),
      clock,
      silent: result.silent.length,
      regionsUnsaved: result.silent.includes("region save"),
    };
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

/** Whether the repeater may still be saving an access list change. */
const aclSavePending = () => store.aclSaveUntil.peek() > Date.now();

/** Resolves once the repeater has saved the last access list change Apply sent (at once when none is pending). */
export async function waitForAclSave(): Promise<void> {
  while (aclSavePending()) await new Promise((r) => setTimeout(r, store.aclSaveUntil.peek() - Date.now()));
}

/**
 * Answer the reboot offer: Later closes it, Reboot now sends `reboot` and the link drops as
 * expected. While the reboot waits for the access list save, the offer stays open and says so.
 */
export async function answerReboot(reboot: boolean): Promise<void> {
  if (store.savingAcl.peek()) return;
  const close = () => {
    const state = store.apply.peek();
    if (state.phase === "done") store.apply.value = { ...state, offerReboot: false };
  };
  if (!reboot) return close();
  if (!aclSavePending()) close();
  await rebootDevice();
  close();
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
 * follows is not an error, and the notice says to reconnect once the device is back. A reboot
 * first waits, holding the lock, until the repeater has saved the access list Apply changed.
 */
export async function restartDevice(cmd: RestartCommand): Promise<void> {
  const texts = RESTART_TEXTS[cmd];
  const link = store.device.peek().link;
  if (!link?.connected || busy.peek()) {
    if (!link?.connected) store.notice.value = { kind: "error", text: t(texts.noDevice) };
    return;
  }
  if (cmd === "reboot" && aclSavePending()) {
    store.commandBusy.value = true;
    store.savingAcl.value = true;
    try {
      await waitForAclSave();
    } finally {
      store.savingAcl.value = false;
      store.commandBusy.value = false;
    }
    // Unplugged while waiting: the unplug notice says it.
    if (!link.connected || store.device.peek().link !== link) return;
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
async function setClockNow(link: SerialLink): Promise<CommandResult> {
  const set = await exchange(link, `time ${Math.floor(Date.now() / 1000)}`);
  if (!set.ok) return set;
  const clock = await exchange(link, "clock");
  if (clock.ok) store.clock.value = { reply: clock.reply, at: Date.now() };
  return set;
}

/** The drawer's clock button: setClockNow under the lock. */
export function syncClock(): Promise<CommandResult | null> {
  return withLock(setClockNow);
}

/** Counting neighbours asks them at most this many times, and listens this long after each ask. */
export const COUNT_ROUNDS = 3;
export const COUNT_ROUND_MS = 20_000;

let countCancelled = false;
/** Ends the current listening wait at once (Cancel). */
let wakeCount: (() => void) | null = null;

/** Stop counting neighbours: nothing more is sent and the result is dropped. */
export function cancelCount(): void {
  countCancelled = true;
  wakeCount?.();
}

/** A neighbour heard up to this long before the count started still counts. */
const RECENT_S = 600;

/** Listen `ms` for the neighbours' answers, showing the seconds left; false when cancelled or unplugged. */
async function listen(link: SerialLink, ms: number, tickMs: number, round: number): Promise<boolean> {
  const total = Math.ceil(ms / 1000);
  // Unplugged (or another device chosen): stop at once, and leave the state to whoever reset it.
  const gone = () => !link.connected || store.device.peek().link !== link;
  for (let waited = 0; waited < ms && !countCancelled; ) {
    if (gone()) return false;
    store.tune.value = { phase: "counting", round, rounds: COUNT_ROUNDS, left: Math.ceil((ms - waited) / 1000), total };
    const step = Math.min(tickMs || ms, ms - waited);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, step);
      wakeCount = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wakeCount = null;
    waited += step;
  }
  return !countCancelled && !gone();
}

/**
 * Count the repeaters it hears well, for its timing band (see bandFor). The clock is set first.
 * Each round sends `discover.neighbors` (nearby repeaters answer over the air), listens, then reads
 * `neighbors`; the count is every key prefix heard above SNR 0 in any round. It stops after
 * COUNT_ROUNDS, or sooner when a round adds nobody new. A table cut at the firmware's limit makes
 * the count "at least". The last table also becomes the Read's neighbour list.
 */
export async function countNeighbours({ roundMs = COUNT_ROUND_MS, tickMs = 1000 } = {}): Promise<void> {
  countCancelled = false;
  await withLock(async (link) => {
    const total = Math.ceil(roundMs / 1000);
    const idle = () => void (store.tune.value = { phase: "idle" });
    const fail = (error: string) => void (store.tune.value = { phase: "failed", error });
    store.tune.value = { phase: "counting", round: 1, rounds: COUNT_ROUNDS, left: total, total };
    await setClockNow(link);
    const started = Date.now();
    const heard = new Set<string>();
    let atLeast = false;
    let latest: Neighbour[] | null = null;
    for (let round = 1; round <= COUNT_ROUNDS; round++) {
      if (countCancelled || !link.connected || store.device.peek().link !== link) return idle();
      store.tune.value = { phase: "counting", round, rounds: COUNT_ROUNDS, left: total, total };
      const asked = await exchange(link, "discover.neighbors");
      if (!asked.ok) return fail(asked.error);
      if (!(await listen(link, roundMs, tickMs, round))) return idle();
      const reply = await exchange(link, "neighbors");
      if (countCancelled) return idle();
      if (!reply.ok) return fail(reply.error);
      const text = reply.reply.replace(/^\s*>\s*/, "");
      const list = parseNeighbours(text);
      if (!list) return fail(text);
      atLeast ||= neighboursCut(text);
      latest = list;
      const before = heard.size;
      // Only those heard during the count, or shortly before it: an old entry may be days old.
      const maxAgoS = (Date.now() - started) / 1000 + RECENT_S;
      for (const prefix of heardWell(list, maxAgoS)) heard.add(prefix);
      // Nobody new: done, unless nobody answered yet (a first round can miss them all).
      if (heard.size === before && heard.size > 0) break;
    }
    const snapshot = store.snapshot.peek();
    if (snapshot && latest) store.snapshot.value = { ...snapshot, neighbours: latest };
    store.tune.value = { phase: "done", heard: heard.size, atLeast };
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
  if (snap) {
    // Keep every key the repeater had, so the nearby check still knows them all.
    const previous = [...(snap.previousPublicKeys ?? []), snap.publicKey, devicePub ? undefined : key.publicKey].filter(
      (k): k is string => !!k,
    );
    store.snapshot.value = { ...snap, publicKey: devicePub ?? undefined, publicKeyPending: true, previousPublicKeys: previous };
  }
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
