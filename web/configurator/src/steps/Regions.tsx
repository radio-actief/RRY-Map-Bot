/** Regions step: which regions the repeater floods (Allow / Deny per row), bulk buttons and the folded region CLI options. */
import { useState } from "preact/hooks";
import { Notice } from "../app/Notice";
import {
  addFreeRegion,
  bulk,
  checkFreeCode,
  defaultScopeOptions,
  freeParentOptions,
  DEFAULT_SCOPE_NONE,
  HOME_OVERRIDE_OMIT,
  homeOverrideOptions,
  homeRegionCode,
  isFreeParent,
  MAX_REGIONS,
  recommendedDefaultScopeCode,
  removeFreeRegion,
  setDefaultScope,
  setHomeOverride,
  setRowState,
  setUntaggedFlood,
  type Anchor,
  type RegionPolicy,
  type RegionRow,
} from "../core/regions";
import { t } from "../i18n/t";
import { regionCount, store } from "../state/store";

const WIKI_URL = "https://meshwiki.radio-actief.be/index.php/MeshCore/RegioScopes";
const GROUPS: RegionRow["group"][] = [
  "country",
  "province",
  "municipality",
  "neighbourMunicipality",
  "neighbourProvince",
  "neighbourRegion",
  "neighbourCountry",
  "free",
  "device",
];
const BULKS = ["recommended", "allowAll", "denyAll", "clear"] as const;
const STATES = ["allow", "none", "deny"] as const;

/** Why a neighbour row is locked: the home row whose state opens it. */
function lockedReason(row: RegionRow): string {
  if (row.group === "neighbourProvince" || row.group === "neighbourRegion") return t("regions.locked.province");
  if (row.group === "neighbourCountry") return t("regions.locked.country");
  return t("regions.locked.municipality");
}

const update = (f: (p: RegionPolicy) => RegionPolicy) => {
  const plan = store.plan.peek();
  if (plan.regions) store.plan.value = { ...plan, regions: f(plan.regions) };
};

function RegionRowView({ row, home, policy }: { row: RegionRow; home: boolean; policy: RegionPolicy }) {
  const locked = !!(row.disabled?.allow || row.disabled?.deny);
  const state = row.allow ? "allow" : row.deny ? "deny" : "none";
  const reason = locked ? lockedReason(row) : undefined;
  return (
    <li class="region-row" data-code={row.code}>
      <span class="region-name">
        <span>
          {row.label}
          {home ? <span class="badge home">{t("regions.home.badge")}</span> : null}
        </span>
        <span class="sub">{t(row.labelKey)}</span>
      </span>
      <div class="segmented region-state" role="group" aria-label={row.label} title={reason}>
        {STATES.map((s) => (
          <button
            type="button"
            key={s}
            data-state={s}
            disabled={locked}
            aria-pressed={state === s}
            aria-label={`${t(`regions.state.${s}`)}: ${row.label}`}
            onClick={() => update((p) => setRowState(p, row.code, s))}
          >
            {t(`regions.state.${s}.short`)}
          </button>
        ))}
      </div>
      {row.group === "free" ? (
        <button
          type="button"
          class="icon"
          aria-label={t("regions.free.remove", { code: row.code })}
          disabled={isFreeParent(policy, row.code)}
          title={isFreeParent(policy, row.code) ? t("regions.free.parentInUse") : undefined}
          onClick={() => update((p) => removeFreeRegion(p, row.code))}
        >
          ✕
        </button>
      ) : null}
    </li>
  );
}

function FreeForm({ policy, anchor }: { policy: RegionPolicy; anchor: Anchor }) {
  const [code, setCode] = useState("");
  const [parent, setParent] = useState("");
  const result = checkFreeCode(policy, code);
  const add = () => {
    if (result !== "ok") return;
    update((p) => addFreeRegion(p, code, parent || null));
    setCode("");
  };
  return (
    <div class="free-form">
      <label class="field">
        <span class="sub">{t("regions.free.code")}</span>
        <input
          type="text"
          value={code}
          maxLength={60}
          onInput={(e) => setCode(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
      </label>
      <label class="field">
        <span class="sub">{t("regions.free.parent")}</span>
        <select value={parent} onChange={(e) => setParent(e.currentTarget.value)}>
          {freeParentOptions(policy, anchor).map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" class="btn small" disabled={result !== "ok"} onClick={add}>
        {t("regions.free.add")}
      </button>
      {code && result !== "ok" ? <p class="sub free-error">{t(`error.freeCode.${result}`)}</p> : null}
    </div>
  );
}

function Options({ policy }: { policy: RegionPolicy }) {
  const auto = recommendedDefaultScopeCode(policy);
  const homeValue = policy.homeOverride ?? "";
  const homeDefault = homeRegionCode({ ...policy, homeOverride: null });
  const defaultValue = policy.defaultScope ?? "";
  return (
    <details class="region-options">
      <summary>{t("regions.options")}</summary>
      <label class="check-line" title={t("regions.untagged.hint")}>
        <input
          type="checkbox"
          checked={policy.untaggedFlood}
          onChange={(e) => update((p) => setUntaggedFlood(p, e.currentTarget.checked))}
        />
        <span>{t("regions.untagged")}</span>
      </label>

      <label class="field">
        <span class="sub">{t("regions.home")}</span>
        <select value={homeValue} onChange={(e) => update((p) => setHomeOverride(p, e.currentTarget.value))}>
          <option value="">
            {homeDefault ? t("regions.home.defaultCode", { code: homeDefault }) : t("regions.home.default")}
          </option>
          <option value={HOME_OVERRIDE_OMIT}>{t("regions.home.none")}</option>
          {homeOverrideOptions(policy).map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
        <span class="sub">{t("regions.home.inactive")}</span>
      </label>

      <label class="field">
        <span class="sub">{t("regions.default")}</span>
        <select value={defaultValue} onChange={(e) => update((p) => setDefaultScope(p, e.currentTarget.value))}>
          <option value="">{auto ? t("regions.default.autoCode", { code: auto }) : t("regions.default.auto")}</option>
          <option value={DEFAULT_SCOPE_NONE}>{t("regions.default.none")}</option>
          {defaultScopeOptions(policy).map((o) => (
            <option key={o.code} value={o.code}>
              {o.notAllowed ? t("regions.default.notAllow", { label: o.label }) : o.label}
            </option>
          ))}
        </select>
        <span class="sub">{t("regions.default.hint")}</span>
      </label>
    </details>
  );
}

export function Regions() {
  const { anchor, regions } = store.plan.value;
  const homeCode = regions ? homeRegionCode(regions) : null;
  return (
    <div class="panel-body step-regions">
      <h2>{t("regions.title")}</h2>
      <p class="sub">
        {t("regions.sub")}{" "}
        <a href={WIKI_URL} target="_blank" rel="noopener">
          {t("regions.wiki")}
        </a>
      </p>
      {!anchor || !regions ? (
        <p class="sub regions-empty">{t("regions.empty")}</p>
      ) : (
        <>
          {regionCount.value > MAX_REGIONS ? (
            <Notice kind="warn">{t("error.regionCount", { count: regionCount.value, max: MAX_REGIONS })}</Notice>
          ) : null}
          <div class="bulk" role="group" aria-label={t("regions.bulk")}>
            {BULKS.map((b) => (
              <button type="button" class="btn small" key={b} onClick={() => update((p) => bulk(p, b))}>
                {t(`regions.bulk.${b}`)}
              </button>
            ))}
          </div>
          {GROUPS.map((g) => {
            const rows = regions.rows.filter((r) => r.group === g);
            return rows.length || g === "free" ? (
              <section key={g} class="region-group">
                <h3 class="field-label">{t(`regions.group.${g}`)}</h3>
                <ul class="region-list">
                  {rows.map((r) => (
                    <RegionRowView key={r.code} row={r} home={r.code === homeCode} policy={regions} />
                  ))}
                </ul>
                {g === "free" ? <FreeForm policy={regions} anchor={anchor} /> : null}
              </section>
            ) : null;
          })}
          <Options policy={regions} />
        </>
      )}
    </div>
  );
}
