import { t } from "../i18n/t";
import { PROVINCE_NAMES } from "../core/be-regions";
import { parseVersion } from "../core/firmware";
import { planName } from "../core/plan";
import { hasWebSerial } from "../device/serial";
import { usbLabel } from "../device/usb";
import { connectUsb } from "../state/device";
import { busy, isWide, store, type Theme } from "../state/store";

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

function anchorPlace(): string {
  const a = store.plan.value.anchor;
  if (!a) return "";
  if (a.mode === "city") return a.place?.gemeente ?? "";
  if (a.mode === "province") return (a.province_code && PROVINCE_NAMES[a.province_code]) || a.province_code || "";
  return t("anchor.country");
}

/** Connected: the repeater's name once read, the USB device and the firmware version. */
function connectionLabel(): { text: string; on: boolean } {
  const { status, firmware, usb } = store.device.value;
  if (status === "connecting") return { text: t("top.connecting"), on: false };
  if (status !== "connected") return { text: t("top.notConnected"), on: false };
  const v = parseVersion(firmware);
  const version = v ? t("top.version", { version: v.text.replace(/^v/i, "") }) : null;
  const parts = [store.snapshot.value?.name, usbLabel(usb) ?? t("top.usbNoVersion"), version];
  return { text: parts.filter(Boolean).join(" · "), on: true };
}

function ConnectionChip() {
  const conn = connectionLabel();
  const content = (
    <>
      <span class={`dot${conn.on ? "" : " off"}`} />
      <span class="chip-text">{conn.text}</span>
    </>
  );
  if (store.device.value.status === "none" && hasWebSerial()) {
    return (
      <button
        type="button"
        class="chip conn trunc action"
        aria-label={t("top.connect", { status: conn.text })}
        title={t("top.connect", { status: conn.text })}
        disabled={busy.value}
        onClick={() => void connectUsb()}
      >
        {content}
      </button>
    );
  }
  return (
    <span class="chip conn trunc" title={conn.text}>
      {content}
    </span>
  );
}

export function TopBar() {
  const step = store.step.value;
  const theme = store.theme.value;
  const place = anchorPlace();
  const name = planName(store.plan.value);
  const chip = [name, place].filter(Boolean).join(" · ");
  return (
    <header class="topbar">
      <span class="wordmark">
        <b>{t("app.nameGold")}</b>
        {t("app.nameRest")}
      </span>
      <ConnectionChip />
      {isWide(step) && chip ? (
        <button
          type="button"
          class="chip place trunc"
          title={t("top.place")}
          disabled={busy.value}
          onClick={() => (store.step.value = "place")}
        >
          <span class="chip-text">{`📍 ${chip}`}</span>
        </button>
      ) : null}
      <span class="spacer" />
      <button
        type="button"
        class={`icon${store.drawerOpen.value ? " on" : ""}`}
        aria-label={t("top.tools")}
        onClick={() => (store.drawerOpen.value = !store.drawerOpen.value)}
      >
        🛠
      </button>
      <button
        type="button"
        class="icon"
        aria-label={t("top.theme", { theme: t(`theme.${theme}`) })}
        onClick={() => (store.theme.value = NEXT_THEME[theme])}
      >
        ◐
      </button>
    </header>
  );
}
