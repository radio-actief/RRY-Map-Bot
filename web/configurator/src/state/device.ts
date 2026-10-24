/** Device actions shared by the steps, the drawer and Apply: connect, disconnect and Read. */
import { deviceRegionsFromSnapshot, planFromSnapshot } from "../core/plan";
import { checkFirmware, readAll, READ_COMMANDS } from "../device/repeater";
import { requestUsbPort, SerialLink, type LinkTiming, type PortLike } from "../device/serial";
import { t } from "../i18n/t";
import { resetPlan, store } from "./store";

const reasonOf = (err: unknown) => (err instanceof Error && err.message ? err.message : String(err));

const NO_DEVICE = { status: "none", link: null, firmware: null } as const;

export type ConnectDeps = { requestPort?: () => Promise<PortLike>; timing?: Partial<LinkTiming> };

function lost(): void {
  store.device.value = NO_DEVICE;
  store.deviceRegions.value = undefined;
  store.notice.value = { kind: "error", text: t("connect.unplugged") };
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
  store.lastRead.value = null;
  store.device.value = { status: "connecting", link: null, firmware: null };
  const link = new SerialLink(port, timing);
  link.onDisconnect(() => {
    if (store.device.peek().link === link) lost();
  });
  try {
    await link.open();
  } catch (err) {
    store.device.value = NO_DEVICE;
    store.notice.value = { kind: "error", text: t("connect.failed", { reason: reasonOf(err) }) };
    return;
  }
  // Unplugged while the port opened or the boot output drained.
  if (!link.connected) return lost();
  store.device.value = { status: "connected", link, firmware: null };
  const fw = await checkFirmware(link);
  if (store.device.peek().link === link) store.device.value = { ...store.device.peek(), firmware: fw.version };
}

/** Close on purpose (old disconnectSerialUsb): no unplug notice, and the device's regions are forgotten. */
export async function disconnectUsb(): Promise<void> {
  const link = store.device.peek().link;
  store.device.value = NO_DEVICE;
  store.deviceRegions.value = undefined;
  await link?.close();
}

/**
 * Every read command, then the plan from the replies (old performReadFromRepeater). When the link
 * was lost or closed during the Read, nothing is taken over: plan, snapshot and device regions stay.
 */
export async function readDevice(): Promise<void> {
  const link = store.device.peek().link;
  if (!link || store.reading.peek()) return;
  store.reading.value = true;
  store.lastRead.value = null;
  try {
    const snapshot = await readAll(link);
    if (!link.connected || store.device.peek().link !== link) {
      store.lastRead.value = { ok: false, reason: t("read.linkLost") };
      return;
    }
    store.snapshot.value = snapshot;
    store.deviceRegions.value = deviceRegionsFromSnapshot(snapshot);
    resetPlan(planFromSnapshot(snapshot, store.data.peek().places ?? []));
    store.lastRead.value = { ok: true, count: READ_COMMANDS.length - snapshot.missing.length, missing: snapshot.missing };
  } catch (err) {
    store.lastRead.value = { ok: false, reason: reasonOf(err) };
  } finally {
    store.reading.value = false;
  }
}
