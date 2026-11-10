import { municipalityName, regionName, t } from "../i18n/t";
import { AccountMenu } from "./AccountMenu";
import { HERE, PAGES, siteTools, toolText } from "./pages";
import { parseVersion } from "../core/firmware";
import { planName } from "../core/plan";
import { hasWebSerial } from "../device/serial";
import { usbBoard, usbLabel } from "../device/usb";
import { connectUsb } from "../state/device";
import { reconnect } from "../state/devicebus";
import { busy, isWide, store, type Theme } from "../state/store";

/** Links to the four tool pages; on a phone the ☰ menu shows them instead of the top bar. */
export function PageSwitcher() {
  return (
    <nav class="switcher" aria-label={t("top.pages")}>
      {PAGES.map(([href, key]) => (
        <a key={href} href={href} aria-current={href === HERE ? "page" : undefined}>
          {t(key)}
        </a>
      ))}
      {siteTools.value.map((tool) => (
        <a key={tool.url} href={tool.url} data-site-tool={tool.key}>
          {toolText(tool)}
        </a>
      ))}
    </nav>
  );
}

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

function anchorPlace(): string {
  const a = store.plan.value.anchor;
  if (!a) return "";
  if (a.mode === "city") return a.place ? municipalityName(a.place.gemeente) : "";
  if (a.mode === "province") return a.province_code ? regionName(a.province_code) : "";
  return t("anchor.country");
}

/**
 * Connected: the repeater's name once read (left out while the place chip shows that name), the
 * board and the firmware version. The title adds the USB ids.
 */
function connectionLabel(placeName: string | null): { text: string; title: string; on: boolean } {
  const { status, firmware, usb, name: saidName, board } = store.device.value;
  if (status === "connecting") return { text: t("top.connecting"), title: t("top.connecting"), on: false };
  if (status !== "connected") return { text: t("top.notConnected"), title: t("top.notConnected"), on: false };
  const v = parseVersion(firmware);
  const version = v ? t("top.version", { version: v.text.replace(/^v/i, "") }) : null;
  const name = store.snapshot.value?.name ?? saidName ?? null;
  const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");
  return {
    text: join([name === placeName ? null : name, board ?? usbBoard(usb) ?? t("top.usbNoVersion"), version]),
    title: join([name, board, usbLabel(usb) ?? t("top.usbNoVersion"), version]),
    on: true,
  };
}

function ConnectionChip({ placeName }: { placeName: string | null }) {
  const conn = connectionLabel(placeName);
  const content = (
    <>
      <span class={`dot${conn.on ? "" : " off"}`} />
      <span class="chip-text">{conn.text}</span>
    </>
  );
  const again = reconnect.value;
  if (store.device.value.status === "none" && hasWebSerial() && again) {
    const label = t("top.reconnect", { name: again.name });
    return (
      <button
        type="button"
        class="chip conn trunc action"
        aria-label={label}
        title={t("top.reconnectTitle", { name: again.name })}
        disabled={busy.value}
        onClick={() => void connectUsb({ requestPort: async () => again.port })}
      >
        <span class="dot off" />
        <span class="chip-text">{label}</span>
      </button>
    );
  }
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
    <span class="chip conn trunc" title={conn.title}>
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
  const showPlace = isWide(step) && store.task.value === "repeater" && !!chip;
  return (
    <header class="topbar">
      <span class="wordmark">
        <b>{t("app.nameGold")}</b>
        {t("app.nameRest")}
        <span class="wordmark-tail">{t("app.nameTail")}</span>
      </span>
      <PageSwitcher />
      <ConnectionChip placeName={showPlace ? name : null} />
      {showPlace ? (
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
      <AccountMenu />
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
