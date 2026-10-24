/** Step 1: connect over USB, the device card, Read (asks before overwriting edits), or go on without a device. */
import { useState } from "preact/hooks";
import { Dialog } from "../app/Dialog";
import { Notice } from "../app/Notice";
import { parseVersion, REGION_DEF_MIN_TEXT, supportsRegionDef } from "../core/firmware";
import { hasValidCoords } from "../core/plan";
import { hasWebSerial } from "../device/serial";
import { t } from "../i18n/t";
import { connectUsb, readDevice } from "../state/device";
import { dirty, store } from "../state/store";

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

/** The outcome of the last Read: how much was read and what got no reply, or why it failed. */
function ReadResult() {
  const r = store.lastRead.value;
  if (!r) return null;
  if (!r.ok) return <Notice kind="error">{t("read.failed", { reason: r.reason })}</Notice>;
  return (
    <>
      <Notice kind="ok">{t("read.done", { count: r.count })}</Notice>
      {r.missing.length ? <Notice kind="warn">{t("read.missing", { commands: r.missing.join(", ") })}</Notice> : null}
    </>
  );
}

export function Connect() {
  const [asking, setAsking] = useState(false);
  const { status } = store.device.value;
  const reading = store.reading.value;
  const serial = hasWebSerial();

  function read() {
    setAsking(false);
    void readDevice();
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
            onClick={() => (dirty.value ? setAsking(true) : read())}
          >
            {reading ? t("read.reading") : t("read.button")}
          </button>
        </>
      ) : null}
      <ReadResult />
      <p class="continue">
        {serial ? `${t("connect.noRepeater")} ` : null}
        <button type="button" class="link" disabled={reading} onClick={() => (store.step.value = 2)}>
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
            <button type="button" class="btn primary" onClick={read}>
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
