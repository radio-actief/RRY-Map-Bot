/** Step 1: connect over USB, the device card, Read (asks before overwriting edits), or go on without a device. */
import { useState } from "preact/hooks";
import { Dialog } from "../app/Dialog";
import { Notice, type NoticeKind } from "../app/Notice";
import { parseVersion, REGION_DEF_MIN_TEXT, supportsRegionDef } from "../core/firmware";
import { deviceRegionsFromSnapshot, hasValidCoords, planFromSnapshot } from "../core/plan";
import { checkFirmware, readAll, READ_COMMANDS } from "../device/repeater";
import { hasWebSerial, requestUsbPort, SerialLink, type LinkTiming, type PortLike } from "../device/serial";
import { t } from "../i18n/t";
import { dirty, resetPlan, store } from "../state/store";

const reasonOf = (err: unknown) => (err instanceof Error && err.message ? err.message : String(err));

type ConnectDeps = { requestPort?: () => Promise<PortLike>; timing?: Partial<LinkTiming> };

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
  store.device.value = { status: "connecting", link: null, firmware: null };
  const link = new SerialLink(port, timing);
  link.onDisconnect(() => {
    if (store.device.peek().link !== link) return;
    store.device.value = { status: "none", link: null, firmware: null };
    store.deviceRegions.value = undefined;
    store.notice.value = { kind: "error", text: t("connect.unplugged") };
  });
  try {
    await link.open();
  } catch (err) {
    store.device.value = { status: "none", link: null, firmware: null };
    store.notice.value = { kind: "error", text: t("connect.failed", { reason: reasonOf(err) }) };
    return;
  }
  store.device.value = { status: "connected", link, firmware: null };
  const fw = await checkFirmware(link);
  if (store.device.peek().link === link) store.device.value = { ...store.device.peek(), firmware: fw.version };
}

/** Close on purpose (old disconnectSerialUsb): no unplug notice, and the device's regions are forgotten. */
export async function disconnectUsb(): Promise<void> {
  const link = store.device.peek().link;
  store.device.value = { status: "none", link: null, firmware: null };
  store.deviceRegions.value = undefined;
  await link?.close();
}

/** Every read command, then the plan from the reply (old performReadFromRepeater). */
async function readDevice(): Promise<{ kind: NoticeKind; text: string }[]> {
  const link = store.device.peek().link;
  if (!link) return [];
  try {
    const snapshot = await readAll(link);
    store.snapshot.value = snapshot;
    store.deviceRegions.value = deviceRegionsFromSnapshot(snapshot);
    resetPlan(planFromSnapshot(snapshot, store.data.peek().places ?? []));
    const count = READ_COMMANDS.length - snapshot.missing.length;
    const out: { kind: NoticeKind; text: string }[] = [{ kind: "ok", text: t("read.done", { count }) }];
    if (snapshot.missing.length) out.push({ kind: "warn", text: t("read.missing", { commands: snapshot.missing.join(", ") }) });
    return out;
  } catch (err) {
    return [{ kind: "error", text: t("read.failed", { reason: reasonOf(err) }) }];
  }
}

const shortKey = (k: string) => (k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k);

function DeviceCard() {
  const { firmware } = store.device.value;
  const snap = store.snapshot.value;
  const version = parseVersion(firmware);
  const state = version ? (supportsRegionDef(version) ? "ok" : "old") : "unknown";
  const location = snap && hasValidCoords(snap.lat, snap.lon) ? `${snap.lat!.toFixed(4)}, ${snap.lon!.toFixed(4)}` : null;
  return (
    <div class="device-card">
      <div class="device-card-head">
        <b>{snap?.name || t("device.unnamed")}</b>
        <span class="badge ok">{t("device.connected")}</span>
      </div>
      <dl>
        <dt>{t("device.firmware")}</dt>
        <dd>
          {firmware ?? t("device.firmwareUnknown")}
          {state === "ok" ? <span class="badge ok">{t("device.regionsOk")}</span> : null}
          {state === "old" ? <span class="badge warn">{t("device.regionsOld", { min: REGION_DEF_MIN_TEXT })}</span> : null}
        </dd>
        <dt>{t("device.publicKey")}</dt>
        <dd title={snap?.publicKey}>{snap?.publicKey ? shortKey(snap.publicKey) : t("device.notRead")}</dd>
        <dt>{t("device.location")}</dt>
        <dd>{location ?? t("device.notRead")}</dd>
      </dl>
    </div>
  );
}

export function Connect() {
  const [asking, setAsking] = useState(false);
  const [reading, setReading] = useState(false);
  const [results, setResults] = useState<{ kind: NoticeKind; text: string }[]>([]);
  const { status } = store.device.value;
  const serial = hasWebSerial();

  async function read() {
    setAsking(false);
    setReading(true);
    setResults([]);
    setResults(await readDevice());
    setReading(false);
  }

  return (
    <div class="panel-body step-connect">
      <h2>{t("connect.title")}</h2>
      <p class="sub">{t("connect.sub")}</p>
      {!serial ? <Notice kind="warn">{t("connect.noSerial")}</Notice> : null}
      {serial && status !== "connected" ? (
        <button type="button" class="btn primary block" disabled={status === "connecting"} onClick={() => void connectUsb()}>
          {status === "connecting" ? t("connect.connecting") : t("connect.button")}
        </button>
      ) : null}
      {status === "connected" ? (
        <>
          <DeviceCard />
          <button
            type="button"
            class="btn primary block"
            disabled={reading}
            onClick={() => (dirty.value ? setAsking(true) : void read())}
          >
            {reading ? t("read.reading") : t("read.button")}
          </button>
        </>
      ) : null}
      {results.map((r) => (
        <Notice key={r.text} kind={r.kind}>
          {r.text}
        </Notice>
      ))}
      <p class="continue">
        {serial ? `${t("connect.noRepeater")} ` : null}
        <button type="button" class="link" onClick={() => (store.step.value = 2)}>
          {t("connect.continue")}
        </button>
      </p>
      <Dialog
        open={asking}
        title={t("read.title")}
        onClose={() => setAsking(false)}
        actions={
          <>
            <button type="button" class="btn" onClick={() => setAsking(false)}>
              {t("read.skip")}
            </button>
            <button type="button" class="btn primary" onClick={() => void read()}>
              {t("read.confirm")}
            </button>
          </>
        }
      >
        <p>{t("read.hint")}</p>
      </Dialog>
    </div>
  );
}
