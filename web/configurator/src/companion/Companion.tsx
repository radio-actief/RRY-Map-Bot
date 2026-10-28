/**
 * The Companion page, for locals and visitors: the radio preset, be as the default region, the
 * public channels for a place (QR code and Open in app each), the four-step guide and where to report
 * a missing channel.
 */
import { useEffect } from "preact/hooks";
import { Notice } from "../app/Notice";
import { channelsFor, pickProvince, type CompanionPick, type ShownChannel } from "../core/companion";
import { BEMESH_PRESET_TITLE, RADIO_PRESETS } from "../core/presets";
import type { LocationChoice } from "../core/search";
import { formatNumber, I18N, municipalityName, regionName, t } from "../i18n/t";
import { store } from "../state/store";
import { LocationSearch } from "../steps/Place";
import { ChannelRow } from "./ChannelRow";
import { Guide } from "./Guide";

export const WIKI_CHANNELS = "https://meshwiki.radio-actief.be/index.php?title=MeshCore/Kanalen";
/** The form the wiki's channel page links for a missing or wrong channel. */
export const CHANNEL_FORM = "https://forms.gle/HveTc9f5H3fDHJn48";

function Preset() {
  const p = RADIO_PRESETS.find((x) => x.title === BEMESH_PRESET_TITLE)!;
  const values = [
    `${formatNumber(p.freq)} MHz`,
    `${formatNumber(p.bw)} kHz`,
    `SF ${p.sf}`,
    `CR ${p.cr}`,
  ];
  return (
    <section class="companion-block">
      <h3>{t("companion.preset.title")}</h3>
      <p>{t("companion.preset.body", { preset: p.title })}</p>
      <div class="preset-values" role="group" aria-label={p.title}>
        {values.map((v) => (
          <span key={v} class="preset-value">
            {v}
          </span>
        ))}
      </div>
      <p class="sub">{t("companion.preset.cr", { cr: p.cr })}</p>
    </section>
  );
}

function pickLabel(pick: CompanionPick | null): string {
  if (!pick) return "";
  if (pick.type === "city") return municipalityName(pick.place.plaats);
  if (pick.type === "province") return regionName(pick.code);
  return t("companion.place.all");
}

/** The place line: the place and its province, a province, or all of Belgium. */
function pickPlace(pick: CompanionPick): string {
  if (pick.type === "city") return `${municipalityName(pick.place.gemeente)}, ${regionName(pick.place.province_code)}`;
  return pickLabel(pick);
}

const toPick = (c: LocationChoice): CompanionPick =>
  c.type === "city" ? { type: "city", place: c.place } : c.type === "province" ? { type: "province", code: c.code } : { type: "country" };

function ChannelGroup({ title, list }: { title: string; list: ShownChannel[] }) {
  return (
    <section class="channel-group">
      <h4>{title}</h4>
      <ul class="channel-list" aria-label={title}>
        {list.map((s) => (
          <ChannelRow key={s.channel.name} shown={s} />
        ))}
      </ul>
    </section>
  );
}

function Channels({ pick }: { pick: CompanionPick }) {
  const data = store.data.value.channels;
  if (store.data.value.failed.has("channels")) return <Notice kind="error">{t("companion.loadFailed")}</Notice>;
  if (!data) return <p class="sub">{t("companion.loading")}</p>;
  const { national, flanders, local, tools } = channelsFor(data.channels, pick);
  const province = pickProvince(pick);
  const withScope = store.companionScope.value;
  return (
    <section class="companion-block">
      <h3>{t("companion.place.channelsFor", { place: pickLabel(pick) })}</h3>
      <p class="sub">{t("companion.place.how")}</p>
      <h4 class="field-label">{t("companion.scope.label")}</h4>
      <div class="segmented" role="group" aria-label={t("companion.scope.label")}>
        <button type="button" aria-pressed={withScope} onClick={() => (store.companionScope.value = true)}>
          {t("companion.scope.with")}
        </button>
        <button type="button" aria-pressed={!withScope} onClick={() => (store.companionScope.value = false)}>
          {t("companion.scope.without")}
        </button>
      </div>
      <p class="sub">{t("companion.scope.hint")}</p>
      <ChannelGroup title={t("companion.list.national")} list={national} />
      <ChannelGroup title={t("companion.list.flanders")} list={flanders} />
      {local.length ? (
        <ChannelGroup title={t("companion.list.local")} list={local} />
      ) : province ? (
        <section class="channel-group">
          <h4>{t("companion.list.local")}</h4>
          <p class="sub">{t("companion.list.noLocal", { province: regionName(province) })}</p>
        </section>
      ) : null}
      <ChannelGroup title={t("companion.list.tools")} list={tools} />
      <p class="sub">{t("companion.checked", { date: I18N.date(data.checked, { day: "numeric", month: "long", year: "numeric" }) })}</p>
    </section>
  );
}

export function Companion() {
  const pick = store.companionPick.value;
  // The map shows the picked place's province, or the whole country.
  useEffect(() => {
    store.companionFocus.value = pick ? (pickProvince(pick) ?? "be") : null;
  }, [pick]);
  return (
    <div class="panel-body step-companion">
      <h2>{t("companion.title")}</h2>
      <p class="sub">{t("companion.intro")}</p>
      <Preset />
      <section class="companion-block">
        <h3>{t("companion.default.title")}</h3>
        <p>{t("companion.default.body")}</p>
        <Guide />
      </section>
      <section class="companion-block">
        <h3>{t("companion.place.title")}</h3>
        <p class="sub">{t("companion.place.sub")}</p>
        <LocationSearch
          shown={pick?.type === "country" ? "" : pickLabel(pick)}
          onPick={(c) => (store.companionPick.value = toPick(c))}
          listId="companion-search-list"
          label={t("companion.place.search")}
        />
        <div class="place-line">
          {pick ? <span class="coords">{`📍 ${pickPlace(pick)}`}</span> : <span class="sub">{t("companion.place.none")}</span>}
          <button
            type="button"
            class="btn small"
            aria-pressed={pick?.type === "country"}
            onClick={() => (store.companionPick.value = { type: "country" })}
          >
            {t("companion.place.all")}
          </button>
        </div>
      </section>
      {pick ? <Channels pick={pick} /> : null}
      <section class="companion-block">
        <h3>{t("companion.missing.title")}</h3>
        <p>{t("companion.missing.body")}</p>
        <p class="companion-links">
          <a href={WIKI_CHANNELS} target="_blank" rel="noopener">
            {t("companion.missing.wiki")}
          </a>
          <a href={CHANNEL_FORM} target="_blank" rel="noopener">
            {t("companion.missing.form")}
          </a>
        </p>
      </section>
    </div>
  );
}
