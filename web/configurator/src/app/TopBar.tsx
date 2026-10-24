import { t } from "../i18n/t";
import { PROVINCE_NAMES } from "../core/be-regions";
import { parseVersion } from "../core/firmware";
import { planName } from "../core/plan";
import { busy, store, type Theme } from "../state/store";

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

function anchorPlace(): string {
  const a = store.plan.value.anchor;
  if (!a) return "";
  if (a.mode === "city") return a.place?.gemeente ?? "";
  if (a.mode === "province") return (a.province_code && PROVINCE_NAMES[a.province_code]) || a.province_code || "";
  return t("anchor.country");
}

function connectionLabel(): { text: string; on: boolean } {
  const { status, firmware } = store.device.value;
  if (status === "connecting") return { text: t("top.connecting"), on: false };
  if (status !== "connected") return { text: t("top.notConnected"), on: false };
  const v = parseVersion(firmware);
  return { text: v ? t("top.usb", { version: v.text.replace(/^v/i, "") }) : t("top.usbNoVersion"), on: true };
}

export function TopBar() {
  const conn = connectionLabel();
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
      <span class="chip trunc">
        <span class={`dot${conn.on ? "" : " off"}`} />
        <span class="chip-text">{conn.text}</span>
      </span>
      {step >= 4 && chip ? (
        <button
          type="button"
          class="chip place trunc"
          title={t("top.place")}
          disabled={busy.value}
          onClick={() => (store.step.value = 2)}
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
