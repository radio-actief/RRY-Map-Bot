/** Step 2: where the repeater is (search, map, "Use my location"), advert location, name and power. */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Notice } from "../app/Notice";
import { PROVINCE_NAMES } from "../core/be-regions";
import { municipalityAt, nodesWithin, NEIGHBOR_RADIUS_KM, type MeshNode } from "../core/geo";
import { checkName, hasControlChars, POWER_EMOJIS, splitNameSuffixAndEmoji, type PowerEmoji, type PrefixFormat } from "../core/naming";
import {
  effectivePrefixFormat,
  hasValidCoords,
  planName,
  planPrefix,
  prefixFormatsFor,
  type AdvertLoc,
  type Plan,
} from "../core/plan";
import type { Anchor } from "../core/regions";
import { locationChoices, type LocationChoice } from "../core/search";
import { t } from "../i18n/t";
import { chooseLocation, municipalities, setLocation, store } from "../state/store";

const ADVERT_LOCS: AdvertLoc[] = ["none", "prefs", "share"];
const PREFIX_FORMATS: PrefixFormat[] = ["city", "province", "country", "none"];
const POWER_KEYS: Record<PowerEmoji, string> = { "🌞": "solar", "⚡": "mains", "🔋": "battery", "👀": "observer", "": "none" };
const POWERS: PowerEmoji[] = [...POWER_EMOJIS, ""];

const edit = (patch: Partial<Plan>) => (store.plan.value = { ...store.plan.peek(), ...patch });

const provinceName = (code: string | null) => (code && PROVINCE_NAMES[code]) || code || "";

/** What the search box shows for the chosen anchor (old selectCity / selectProvince / selectCountryBe labels). */
function anchorLabel(a: Anchor | null): string {
  if (!a) return "";
  if (a.mode === "city") return a.place?.plaats ?? "";
  if (a.mode === "province") return provinceName(a.province_code);
  return t("anchor.country");
}

/** The place line under the search: municipality and province, a province, or the country. */
function anchorPlace(a: Anchor | null): string {
  if (!a) return "";
  if (a.mode === "city") return [a.place?.gemeente, provinceName(a.province_code)].filter(Boolean).join(", ");
  return anchorLabel(a);
}

/** A name without its power emoji, for comparing names (case-insensitive). */
const baseName = (name: string) => splitNameSuffixAndEmoji(name.trim()).suffix.trim().toLowerCase();

const canLocate = () =>
  typeof isSecureContext !== "undefined" && isSecureContext && typeof navigator !== "undefined" && "geolocation" in navigator;

function LocationSearch() {
  const anchor = store.plan.value.anchor;
  const places = store.data.value.places ?? [];
  const [query, setQuery] = useState(() => anchorLabel(anchor));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const choices = useMemo(() => (open ? locationChoices(query, places) : []), [open, query, places]);

  // A location set elsewhere (map, Read) shows up in the box.
  useEffect(() => {
    setQuery(anchorLabel(anchor));
    setOpen(false);
  }, [anchor]);

  function pick(c: LocationChoice) {
    chooseLocation(c);
    setOpen(false);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, choices.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && choices[active]) {
      e.preventDefault();
      pick(choices[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const listId = "place-search-list";
  const showList = open && query.trim().length >= 2;
  return (
    <div class="search">
      <input
        type="text"
        role="combobox"
        aria-label={t("place.search")}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && choices[active] ? `${listId}-${active}` : undefined}
        placeholder={t("place.search")}
        autocomplete="off"
        value={query}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setQuery(anchorLabel(anchor));
        }}
        onKeyDown={onKey}
      />
      {showList ? (
        <ul class="search-list" id={listId} role="listbox" aria-label={t("place.search")}>
          {choices.length ? (
            choices.map((c, i) => (
              <li
                id={`${listId}-${i}`}
                key={c.label}
                role="option"
                aria-selected={i === active}
                class={i === active ? "active" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
              >
                {c.label}
              </li>
            ))
          ) : (
            <li class="empty">{t("place.noMatches")}</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** "Use my location" (only on a secure origin with geolocation); a failure becomes a notice. */
function UseMyLocation({ onError }: { onError: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  if (!canLocate()) return null;
  function locate() {
    setBusy(true);
    // A late answer is dropped once the user has left the step.
    const current = () => mounted.current && store.step.peek() === 2;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!current()) return;
        setBusy(false);
        setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        if (!current()) return;
        setBusy(false);
        onError(t("place.geoFailed", { reason: err.message || String(err.code) }));
      },
      { timeout: 15000 },
    );
  }
  return (
    <button type="button" class="btn small" disabled={busy} onClick={locate}>
      {busy ? t("place.locating") : t("place.useMyLocation")}
    </button>
  );
}

/** Typed coordinate text as a number: a comma counts as the decimal point; empty or junk is NaN. */
const parseCoord = (s: string) => (s.trim() ? Number(s.trim().replace(",", ".")) : NaN);
const formatCoord = (n: number) => String(Math.round(n * 1e6) / 1e6);

/** Latitude / longitude inputs and Clear (old position fields); a valid pair goes through setLocation. */
function CoordinateFields() {
  const location = store.plan.value.location;
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [invalid, setInvalid] = useState(false);

  // The pin moved elsewhere (map, search, Read): show where it is now.
  useEffect(() => {
    setLat(location ? formatCoord(location.lat) : "");
    setLon(location ? formatCoord(location.lon) : "");
    setInvalid(false);
  }, [location]);

  function commit(nextLat: string, nextLon: string) {
    const filled = [nextLat, nextLon].filter((v) => v.trim());
    // Junk is flagged at once; a pair is only checked (and sent) once both fields are filled.
    if (filled.some((v) => !Number.isFinite(parseCoord(v)))) return setInvalid(true);
    if (filled.length < 2) return setInvalid(false);
    const a = parseCoord(nextLat);
    const b = parseCoord(nextLon);
    if (!hasValidCoords(a, b)) return setInvalid(true);
    setInvalid(false);
    if (location && location.lat === a && location.lon === b) return;
    setLocation({ lat: a, lon: b });
  }

  return (
    <>
      <div class="coord-row">
        <label class="field">
          <span class="sub">{t("place.lat")}</span>
          <input
            type="text"
            inputMode="decimal"
            autocomplete="off"
            placeholder="50.8503"
            aria-invalid={invalid}
            value={lat}
            onInput={(e) => setLat(e.currentTarget.value)}
            onChange={(e) => commit(e.currentTarget.value, lon)}
          />
        </label>
        <label class="field">
          <span class="sub">{t("place.lon")}</span>
          <input
            type="text"
            inputMode="decimal"
            autocomplete="off"
            placeholder="4.3517"
            aria-invalid={invalid}
            value={lon}
            onInput={(e) => setLon(e.currentTarget.value)}
            onChange={(e) => commit(lat, e.currentTarget.value)}
          />
        </label>
        {location ? (
          <button type="button" class="btn small" title={t("place.clearHint")} onClick={() => setLocation(null)}>
            {t("place.clear")}
          </button>
        ) : null}
      </div>
      {invalid ? <p class="field-error">{t("error.coords")}</p> : null}
    </>
  );
}

/** Whether a node within 25 km already carries this name; the own repeater (after a Read) does not count. */
function nearbyCheck(plan: Plan, nodes: MeshNode[] | undefined, failed: boolean, ownKey: string | undefined) {
  if (!plan.location || !plan.nameSuffix.trim()) return null;
  if (failed) return { kind: "warn" as const, text: t("place.nearbyUnchecked") };
  if (!nodes) return null;
  const name = baseName(planName(plan));
  const own = ownKey?.toLowerCase();
  const taken = nodesWithin(nodes, plan.location, NEIGHBOR_RADIUS_KM).find(
    (n) => n.public_key.toLowerCase() !== own && baseName(n.adv_name) === name,
  );
  return taken
    ? { kind: "warn" as const, text: t("place.nearbyTaken", { name: taken.adv_name, km: NEIGHBOR_RADIUS_KM }) }
    : { kind: "ok" as const, text: t("place.nearbyOk", { km: NEIGHBOR_RADIUS_KM }) };
}

export function PlaceName() {
  const plan = store.plan.value;
  const data = store.data.value;
  const munis = municipalities.value;
  const [geoError, setGeoError] = useState<string | null>(null);
  const { location, anchor } = plan;

  const outside = useMemo(
    () => !!location && !anchor && munis.length > 0 && !municipalityAt(location, munis),
    [location, anchor, munis],
  );
  const prefix = planPrefix(plan);
  const name = checkName(planName(plan), plan.advertLoc !== "none");
  const formats = anchor ? prefixFormatsFor(anchor) : [];
  const bordersFailed = data.failed.has("municipalities") || data.failed.has("places");
  const nearby = nearbyCheck(plan, data.nodes, data.failed.has("nodes"), store.snapshot.value?.publicKey);

  return (
    <div class="panel-body step-place">
      <h2>{t("place.title")}</h2>
      <p class="sub">{t("place.sub")}</p>

      <LocationSearch />
      <div class="place-line">
        {anchor ? (
          <span class="coords">{`📍 ${anchorPlace(anchor)}`}</span>
        ) : (
          <span class="sub">{location ? "" : t("place.noLocation")}</span>
        )}
        <UseMyLocation onError={setGeoError} />
      </div>
      <CoordinateFields />
      {bordersFailed ? <Notice kind="warn">{t("place.noBorders")}</Notice> : null}
      {outside ? <Notice kind="warn">{t("place.outside")}</Notice> : null}
      {geoError ? <Notice kind="error">{geoError}</Notice> : null}

      <h3 class="field-label">{t("place.advertLoc")}</h3>
      <div class="segmented" role="group" aria-label={t("place.advertLoc")}>
        {ADVERT_LOCS.map((v) => (
          <button type="button" key={v} aria-pressed={plan.advertLoc === v} onClick={() => edit({ advertLoc: v })}>
            {t(`advertLoc.${v}`)}
          </button>
        ))}
      </div>

      <h3 class="field-label">{t("place.name")}</h3>
      <label class="field">
        <span class="sub">{t("place.prefixFormat")}</span>
        <select
          value={effectivePrefixFormat(plan)}
          disabled={!anchor}
          onChange={(e) => edit({ prefixFormat: e.currentTarget.value as PrefixFormat })}
        >
          {PREFIX_FORMATS.map((f) => (
            <option key={f} value={f} disabled={!formats.includes(f)}>
              {t(`prefix.${f}`)}
            </option>
          ))}
        </select>
      </label>
      <div class={`name-row${name.ok ? "" : " bad"}`}>
        {prefix ? <span class="prefix-chip">{prefix}</span> : null}
        <input
          type="text"
          aria-label={t("place.suffix")}
          placeholder={t("place.suffixPlaceholder")}
          autocomplete="off"
          value={plan.nameSuffix}
          onInput={(e) => edit({ nameSuffix: e.currentTarget.value })}
        />
      </div>
      <p class={`bytes${name.bytes > name.max ? " bad" : ""}`}>{t("place.bytes", { bytes: name.bytes, max: name.max })}</p>
      {name.badChars.some((c) => !hasControlChars(c)) ? <p class="field-error">{t("error.nameBadChars")}</p> : null}
      {name.controlChars ? <p class="field-error">{t("error.nameControlChars")}</p> : null}
      {name.bytes > name.max ? <p class="field-error">{t("error.nameTooLong")}</p> : null}
      {!plan.nameSuffix.trim() ? <p class="sub">{t("error.nameEmpty")}</p> : null}
      {nearby ? <p class={`check ${nearby.kind}`}>{nearby.text}</p> : null}

      <h3 class="field-label">{t("place.power")}</h3>
      <div class="segmented" role="group" aria-label={t("place.power")}>
        {POWERS.map((p) => (
          <button
            type="button"
            key={p}
            aria-pressed={plan.power === p}
            aria-label={p ? undefined : t("power.noneLabel")}
            onClick={() => edit({ power: p })}
          >
            {t(`power.${POWER_KEYS[p]}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
