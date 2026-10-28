/** Place step: where the repeater is (search, map, "Use my location", coordinates) and the advert location. */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Notice } from "../app/Notice";
import { PROVINCE_NAMES } from "../core/be-regions";
import { municipalityAt, roundCoord } from "../core/geo";
import { hasValidCoords, type AdvertLoc } from "../core/plan";
import type { Anchor } from "../core/regions";
import { locationChoices, type LocationChoice } from "../core/search";
import { t } from "../i18n/t";
import { chooseLocation, editPlan, municipalities, placeChosen, placeLeft, setLocation, store } from "../state/store";

const ADVERT_LOCS: AdvertLoc[] = ["none", "prefs", "share"];

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

/** A finger that moved this far between down and up was scrolling the list, not picking. */
const MOVE_PX = 10;
/** The click that follows a pick on lift is the same tap. */
const CLICK_AFTER_LIFT_MS = 600;

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

  // Where the finger went down on a hit; lifting it on the same hit, without scrolling the list, picks it.
  const press = useRef<{ choice: LocationChoice; y: number } | null>(null);
  const lastPick = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  function pick(c: LocationChoice) {
    lastPick.current = Date.now();
    chooseLocation(c);
    setOpen(false);
  }

  /**
   * Picked when the finger lifts: on an iPhone the keyboard closing (and the blur with it) moves
   * the list and swallows the click. The click still picks for a mouse or keyboard, once.
   */
  function release(c: LocationChoice, e: PointerEvent) {
    const down = press.current;
    press.current = null;
    if (!down || down.choice !== c || Math.abs(e.clientY - down.y) >= MOVE_PX) return;
    pick(c);
    input.current?.blur();
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
        ref={input}
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
                onPointerDown={(e) => (press.current = { choice: c, y: e.clientY })}
                onPointerUp={(e) => release(c, e)}
                onPointerCancel={() => (press.current = null)}
                onClick={() => {
                  if (Date.now() - lastPick.current > CLICK_AFTER_LIFT_MS) pick(c);
                }}
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
    const current = () => mounted.current && store.step.peek() === "place";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!current()) return;
        setBusy(false);
        setLocation({ lat: roundCoord(pos.coords.latitude), lon: roundCoord(pos.coords.longitude) });
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
const formatCoord = (n: number) => String(roundCoord(n));

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
      {!invalid && (placeLeft.value || placeChosen.value) && !location && store.plan.value.advertLoc === "prefs" ? (
        <p class="field-error">{t("error.coordsRequired")}</p>
      ) : null}
    </>
  );
}

export function Place() {
  const plan = store.plan.value;
  const data = store.data.value;
  const munis = municipalities.value;
  const [geoError, setGeoError] = useState<string | null>(null);
  const { location, anchor } = plan;

  const outside = useMemo(
    () => !!location && !anchor && munis.length > 0 && !municipalityAt(location, munis),
    [location, anchor, munis],
  );
  const bordersFailed = data.failed.has("municipalities") || data.failed.has("places");

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
          <button type="button" key={v} aria-pressed={plan.advertLoc === v} onClick={() => editPlan({ advertLoc: v })}>
            {t(`advertLoc.${v}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
