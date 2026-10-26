/** Name step: the prefix and the own part of the name, the byte counter, the nearby check, power and owner info. */
import { nodesWithin, NEIGHBOR_RADIUS_KM, type MeshNode } from "../core/geo";
import { checkName, hasControlChars, POWER_EMOJIS, splitNameSuffixAndEmoji, type PowerEmoji, type PrefixFormat } from "../core/naming";
import { effectivePrefixFormat, planName, planPrefix, prefixFormatsFor, type Plan } from "../core/plan";
import { SETTINGS } from "../core/settings";
import { t } from "../i18n/t";
import { editPlan, store } from "../state/store";
import { SettingField } from "./SettingsStep";

const PREFIX_FORMATS: PrefixFormat[] = ["city", "province", "country", "none"];
const POWER_KEYS: Record<PowerEmoji, string> = { "🌞": "solar", "⚡": "mains", "🔋": "battery", "👀": "observer", "": "none" };
const POWERS: PowerEmoji[] = [...POWER_EMOJIS, ""];
const OWNER_INFO = SETTINGS.find((d) => d.key === "ownerInfo")!;

/** A name without its power emoji, for comparing names (case-insensitive). */
const baseName = (name: string) => splitNameSuffixAndEmoji(name.trim()).suffix.trim().toLowerCase();

/** Whether a node within 25 km already carries this name; the own repeater (after a Read, or a key write: old and new key) does not count. */
function nearbyCheck(plan: Plan, nodes: MeshNode[] | undefined, failed: boolean, ownKeys: (string | undefined)[]) {
  if (!plan.location || !plan.nameSuffix.trim()) return null;
  if (failed) return { kind: "warn" as const, text: t("place.nearbyUnchecked") };
  if (!nodes) return null;
  const name = baseName(planName(plan));
  const own = ownKeys.filter(Boolean).map((k) => k!.toLowerCase());
  const taken = nodesWithin(nodes, plan.location, NEIGHBOR_RADIUS_KM).find(
    (n) => !own.includes(n.public_key.toLowerCase()) && baseName(n.adv_name) === name,
  );
  return taken
    ? { kind: "warn" as const, text: t("place.nearbyTaken", { name: taken.adv_name, km: NEIGHBOR_RADIUS_KM }) }
    : { kind: "ok" as const, text: t("place.nearbyOk", { km: NEIGHBOR_RADIUS_KM }) };
}

export function Name() {
  const plan = store.plan.value;
  const data = store.data.value;
  const { anchor } = plan;
  const prefix = planPrefix(plan);
  const name = checkName(planName(plan), plan.advertLoc !== "none");
  const formats = anchor ? prefixFormatsFor(anchor) : [];
  const nearby = nearbyCheck(plan, data.nodes, data.failed.has("nodes"), [store.snapshot.value?.publicKey, ...(store.snapshot.value?.previousPublicKeys ?? [])]);

  return (
    <div class="panel-body step-name">
      <h2>{t("place.name")}</h2>
      <label class="field">
        <span class="sub">{t("place.prefixFormat")}</span>
        <select
          value={effectivePrefixFormat(plan)}
          disabled={!anchor}
          onChange={(e) => editPlan({ prefixFormat: e.currentTarget.value as PrefixFormat })}
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
          onInput={(e) => editPlan({ nameSuffix: e.currentTarget.value })}
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
            onClick={() => editPlan({ power: p })}
          >
            {t(`power.${POWER_KEYS[p]}`)}
          </button>
        ))}
      </div>

      <SettingField def={OWNER_INFO} />
    </div>
  );
}
