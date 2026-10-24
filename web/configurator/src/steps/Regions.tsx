/** Step 3: which regions the repeater floods (Allow / Deny per row), bulk buttons and the folded region CLI options. */
import {
  bulk,
  defaultScopeOptions,
  DEFAULT_SCOPE_NONE,
  HOME_OVERRIDE_OMIT,
  homeOverrideOptions,
  recommendedDefaultScopeCode,
  setDefaultScope,
  setHomeOverride,
  setRowState,
  setUntaggedFlood,
  type RegionPolicy,
  type RegionRow,
} from "../core/regions";
import { t } from "../i18n/t";
import { store } from "../state/store";

const WIKI_URL = "https://meshwiki.radio-actief.be/index.php/MeshCore/RegioScopes";
const GROUPS: RegionRow["group"][] = ["country", "province", "municipality", "neighbour", "device"];
const BULKS = ["recommended", "allowAll", "denyAll", "clear"] as const;
const STATES = ["allow", "none", "deny"] as const;

/** Why a neighbour row is locked: the home row whose state opens it. */
function lockedReason(row: RegionRow): string {
  if (row.labelKey === "region.kind.neighbourProvince") return t("regions.locked.province");
  if (row.labelKey === "region.kind.neighbourCountry") return t("regions.locked.country");
  return t("regions.locked.municipality");
}

const update = (f: (p: RegionPolicy) => RegionPolicy) => {
  const plan = store.plan.peek();
  if (plan.regions) store.plan.value = { ...plan, regions: f(plan.regions) };
};

function RegionRowView({ row }: { row: RegionRow }) {
  const locked = !!(row.disabled?.allow || row.disabled?.deny);
  const state = row.allow ? "allow" : row.deny ? "deny" : "none";
  const reason = locked ? lockedReason(row) : undefined;
  return (
    <li class="region-row" data-code={row.code}>
      <span class="region-name">
        <span>{row.label}</span>
        <span class="sub">{t(row.labelKey)}</span>
      </span>
      <div class="segmented region-state" role="group" aria-label={row.label} title={reason}>
        {STATES.map((s) => (
          <button
            type="button"
            key={s}
            disabled={locked}
            aria-pressed={state === s}
            aria-label={`${t(`regions.state.${s}`)}: ${row.label}`}
            onClick={() => update((p) => setRowState(p, row.code, s))}
          >
            {t(`regions.state.${s}.short`)}
          </button>
        ))}
      </div>
    </li>
  );
}

function Options({ policy }: { policy: RegionPolicy }) {
  const auto = recommendedDefaultScopeCode(policy);
  const homeValue = policy.homeOverride ?? "";
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
          <option value="">{t("regions.home.default")}</option>
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
          <div class="bulk" role="group" aria-label={t("regions.bulk")}>
            {BULKS.map((b) => (
              <button type="button" class="btn small" key={b} onClick={() => update((p) => bulk(p, b))}>
                {t(`regions.bulk.${b}`)}
              </button>
            ))}
          </div>
          {GROUPS.map((g) => {
            const rows = regions.rows.filter((r) => r.group === g);
            return rows.length ? (
              <section key={g} class="region-group">
                <h3 class="field-label">{t(`regions.group.${g}`)}</h3>
                <ul class="region-list">
                  {rows.map((r) => (
                    <RegionRowView key={r.code} row={r} />
                  ))}
                </ul>
              </section>
            ) : null;
          })}
          <Options policy={regions} />
        </>
      )}
    </div>
  );
}
