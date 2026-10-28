/** Connect step: connect over USB, the device card, Read (asks before overwriting edits), or go on without a device. */
import { useState } from "preact/hooks";
import { CheckupDialog } from "../app/CheckupDialog";
import { Dialog } from "../app/Dialog";
import { Notice } from "../app/Notice";
import { checkupCounts, checkupLines, type CheckupGroup } from "../core/checkup";
import { parseVersion, REGION_DEF_MIN_TEXT, supportsRegionDef } from "../core/firmware";
import { hasValidCoords } from "../core/plan";
import { hasWebSerial } from "../device/serial";
import { t } from "../i18n/t";
import { connectUsb, readDevice } from "../state/device";
import { busy, dirty, store } from "../state/store";

const shortKey = (k: string) => (k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k);

function DeviceCard() {
  const { firmware } = store.device.value;
  const snap = store.snapshot.value;
  const read = store.lastRead.value;
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
        <dd title={snap?.publicKey}>
          {snap?.publicKey ? shortKey(snap.publicKey) : t("device.notRead")}
          {snap?.publicKeyPending ? <span class="badge warn">{t("device.afterReboot")}</span> : null}
        </dd>
        <dt>{t("device.location")}</dt>
        <dd>{location ?? t("device.notRead")}</dd>
        {read?.ok ? (
          <>
            <dt>{t("device.lastRead")}</dt>
            <dd>{t("device.settingsRead", { count: read.count })}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

/** What went wrong in the last Read: no reply to some commands, or why it failed. The count is in the device card. */
function ReadResult() {
  const r = store.lastRead.value;
  if (!r) return null;
  if (!r.ok) return <Notice kind="error">{t("read.failed", { reason: r.reason })}</Notice>;
  return r.missing.length ? <Notice kind="warn">{t("read.missing", { commands: r.missing.join(", ") })}</Notice> : null;
}

const GROUP_ORDER: CheckupGroup[] = ["radio", "advertising", "repeating", "timing", "regions", "advanced"];

/** After a Read: how many settings differ from the recommendation, per block, with the way into the check-up. */
function CheckupNotice({ onOpen }: { onOpen: () => void }) {
  const r = store.lastRead.value;
  if (!r?.ok || !store.snapshot.value) return null;
  const { total, perGroup, nameDiffers } = checkupCounts(checkupLines(store.plan.value, store.data.value.places ?? []));
  if (!total && !nameDiffers) return <Notice kind="ok">{t("checkup.allGood")}</Notice>;
  const parts = GROUP_ORDER.filter((g) => perGroup[g]).map((g) =>
    g === "regions" ? t("script.group.regions") : `${t(`settings.card.${g}`)} ${perGroup[g]}`,
  );
  return (
    <Notice kind="warn">
      {total ? (
        <>
          <b>{t("checkup.differ", { count: total })}</b>
          <p>
            {parts.join(" · ")}
            {parts.length && nameDiffers ? ". " : ""}
            {nameDiffers ? t("checkup.nameToo") : ""}
          </p>
        </>
      ) : (
        <p>{t("checkup.nameOnly")}</p>
      )}
      <button type="button" class="btn" onClick={onOpen}>
        {t("checkup.open")}
      </button>
    </Notice>
  );
}

const NEW_BOARD_CHECKS = ["cable", "tabs", "driver", "firmware", "wake"] as const;

/** Before the first connect: what a brand-new board needs. */
function NewBoard() {
  return (
    <section class="new-board">
      <h3>{t("connect.newBoard")}</h3>
      <ul>
        {NEW_BOARD_CHECKS.map((k) => (
          <li key={k}>{t(`connect.check.${k}`)}</li>
        ))}
      </ul>
    </section>
  );
}

export function Connect() {
  const [asking, setAsking] = useState(false);
  const [checkup, setCheckup] = useState(false);
  const { status } = store.device.value;
  const reading = store.reading.value;
  const locked = busy.value;
  const serial = hasWebSerial();
  const readOnce = !!store.lastRead.value?.ok && !!store.snapshot.value;

  function read() {
    setAsking(false);
    void readDevice();
  }

  return (
    <div class="panel-body step-connect">
      <h2>{t("connect.title")}</h2>
      {status !== "connected" ? <p class="sub">{t("connect.sub")}</p> : null}
      {!serial ? <Notice kind="warn">{t("connect.noSerial")}</Notice> : null}
      {serial && status !== "connected" ? (
        <button type="button" class="btn primary block" disabled={status === "connecting"} onClick={() => void connectUsb()}>
          {status === "connecting" ? t("connect.connecting") : t("connect.button")}
        </button>
      ) : null}
      {serial && status !== "connected" ? <NewBoard /> : null}
      {status === "connected" ? (
        <>
          <DeviceCard />
          <button
            type="button"
            class={`btn block${readOnce ? "" : " primary"}`}
            disabled={locked}
            onClick={() => (dirty.value ? setAsking(true) : read())}
          >
            {reading ? t("read.reading") : readOnce ? t("read.again") : t("read.button")}
          </button>
        </>
      ) : null}
      <ReadResult />
      <CheckupNotice onOpen={() => setCheckup(true)} />
      {checkup ? <CheckupDialog open onClose={() => setCheckup(false)} /> : null}
      <p class="continue">
        {serial ? `${t("connect.noRepeater")} ` : null}
        <button type="button" class="link" disabled={locked} onClick={() => (store.step.value = "place")}>
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
