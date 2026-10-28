/** One channel on the Companion page: name, purpose, region (name and a small map), QR code and Open in app. */
import { useMemo, useState } from "preact/hooks";
import { Dialog } from "../app/Dialog";
import { channelLink, channelSecret, OWN_PROVINCE, type ShownChannel } from "../core/companion";
import { qrCode, qrPath } from "../core/qr";
import { provinceShapes } from "../core/shape";
import { hasText, regionName, t } from "../i18n/t";
import { store } from "../state/store";

/** The QR code of a link as an SVG; always dark on white with a quiet zone, so it scans in the dark theme too. */
export function QrSvg({ text, class: cls }: { text: string; class?: string }) {
  const qr = useMemo(() => qrCode(text), [text]);
  const box = qr.size + 4;
  return (
    <svg class={cls} viewBox={`0 0 ${box} ${box}`} shape-rendering="crispEdges" aria-hidden="true">
      <rect width={box} height={box} fill="#fff" />
      <path d={qrPath(qr, 2)} fill="#000" />
    </svg>
  );
}

let shapesFor: { source: unknown; shapes: ReturnType<typeof provinceShapes> } | null = null;

/** Belgium with the region's area filled: every province for be, one province for a province code. */
function RegionShape({ scope }: { scope: string }) {
  const provinces = store.data.value.provinces;
  if (!provinces) return null;
  if (shapesFor?.source !== provinces) shapesFor = { source: provinces, shapes: provinceShapes(provinces) };
  const { viewBox, paths } = shapesFor.shapes;
  const label = t("companion.channel.showMap", { region: regionName(scope) });
  return (
    <button
      type="button"
      class={`region-shape${store.companionFocus.value === scope ? " focused" : ""}`}
      aria-label={label}
      title={label}
      onClick={() => {
        store.companionFocus.value = scope;
        // On a phone the map is under the sheet: lower it to half so the area shows.
        if (document.querySelector(".panel.sheet.full")) store.sheet.value = "half";
      }}
    >
      <svg viewBox={viewBox} aria-hidden="true">
        {Object.entries(paths).map(([code, d]) => (
          <path key={code} d={d} class={scope === "be" || scope === code ? "on" : ""} />
        ))}
      </svg>
    </button>
  );
}

function QrDialog({ shown, link, onClose }: { shown: ShownChannel; link: string; onClose: () => void }) {
  const { channel, scope } = shown;
  return (
    <Dialog
      open
      title={channel.name}
      onClose={onClose}
      actions={
        <>
          <button type="button" class="btn" onClick={onClose}>
            {t("dialog.close")}
          </button>
          <a class="btn primary" href={link}>
            {t("companion.channel.open")}
          </a>
        </>
      }
    >
      <div class="qr-large">
        <QrSvg text={link} />
      </div>
      <p>{t("companion.qr.scan")}</p>
      <p class="sub">{scope ? t("companion.channel.region", { name: regionName(scope), code: scope }) : t("companion.channel.noRegion")}</p>
      <p class="sub">
        {t("companion.qr.secret")} <code class="secret">{channelSecret(channel.name)}</code>
      </p>
      <p class="sub">{t("companion.qr.public")}</p>
    </Dialog>
  );
}

const purposeKey = (name: string) => `companion.purpose.${name.slice(1)}`;

export function ChannelRow({ shown }: { shown: ShownChannel }) {
  const [large, setLarge] = useState(false);
  const { channel, scope, own } = shown;
  const withScope = store.companionScope.value;
  // #bot and its like need a province; for All of Belgium the row only says so.
  const waiting = channel.scope === OWN_PROVINCE && !scope;
  const link = channelLink(channel.name, withScope ? scope : null);
  const purpose = hasText(purposeKey(channel.name)) ? t(purposeKey(channel.name)) : channel.purpose;
  return (
    <li class="channel" aria-label={channel.name}>
      {waiting ? (
        <span class="qr-thumb empty" aria-hidden="true" />
      ) : (
        <button type="button" class="qr-thumb" aria-label={t("companion.channel.qr", { name: channel.name })} onClick={() => setLarge(true)}>
          <QrSvg text={link} />
        </button>
      )}
      <div class="channel-text">
        <span class="channel-name">
          <b>{channel.name}</b>
          {channel.recommended ? <span class="badge ok">{t("companion.channel.recommended")}</span> : null}
          {own ? <span class="badge home">{t("companion.channel.own")}</span> : null}
        </span>
        <span class="channel-purpose">{purpose}</span>
        {channel.link ? (
          <a class="channel-more" href={channel.link} target="_blank" rel="noopener">
            {new URL(channel.link).host}
          </a>
        ) : null}
        {waiting ? (
          <span class="channel-region wait">{t("companion.channel.pickFirst")}</span>
        ) : (
          <span class="channel-region">
            {withScope && scope ? t("companion.channel.region", { name: regionName(scope), code: scope }) : t("companion.channel.noRegion")}
          </span>
        )}
        {channel.scope === OWN_PROVINCE && scope ? <span class="sub">{t("companion.channel.ownProvince")}</span> : null}
      </div>
      <div class="channel-side">
        {withScope && scope ? <RegionShape scope={scope} /> : null}
        {waiting ? null : (
          <a class="btn small" href={link}>
            {t("companion.channel.open")}
          </a>
        )}
      </div>
      {large ? <QrDialog shown={shown} link={link} onClose={() => setLarge(false)} /> : null}
    </li>
  );
}
