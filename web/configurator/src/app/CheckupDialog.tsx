/** Quick check-up: the differences between the plan and the #BEmesh recommendation, to tick and apply. */
import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { applyCheckup, checkupLines, regionsGoingToo, type CheckupGroup, type CheckupLine } from "../core/checkup";
import type { RegionPolicy } from "../core/regions";
import { planName } from "../core/plan";
import { t } from "../i18n/t";
import { store } from "../state/store";
import { Dialog } from "./Dialog";

const GROUPS: CheckupGroup[] = ["name", "radio", "advertising", "repeating", "timing", "regions", "advanced"];
const headingKey = (g: CheckupGroup) =>
  g === "name" ? "script.group.name" : g === "regions" ? "script.group.regions" : `settings.card.${g}`;

function detailText(d: NonNullable<CheckupLine["detail"]>): string {
  const list = (l: string[]) => l.join(", ");
  return [
    d.adds.length ? t("checkup.detail.adds", { list: list(d.adds) }) : "",
    d.denies.length ? t("checkup.detail.denies", { list: list(d.denies) }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The repeater's own regions the recommendation leaves out, each with Keep / Discard. */
function OwnRegions({
  codes,
  regions,
  discard,
  goingToo,
  onChoose,
}: {
  codes: string[];
  regions: RegionPolicy | null;
  discard: Set<string>;
  goingToo: string[];
  onChoose: (code: string, keep: boolean) => void;
}) {
  const label = (code: string) => regions?.rows.find((r) => r.code === code)?.label || code;
  return (
    <div class="checkup-own">
      <span class="checkup-note">{t("checkup.keep.title")}</span>
      {codes.map((code) => (
        <div class="checkup-own-row" key={code}>
          <span class="checkup-label">{label(code)}</span>
          <div class="segmented" role="group" aria-label={label(code)}>
            <button type="button" aria-pressed={!discard.has(code)} onClick={() => onChoose(code, true)}>
              {t("checkup.keep")}
            </button>
            <button type="button" aria-pressed={discard.has(code)} onClick={() => onChoose(code, false)}>
              {t("checkup.discard")}
            </button>
          </div>
          {goingToo.includes(code) ? <span class="checkup-note">{t("checkup.goesToo")}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function CheckupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const places = store.data.value.places ?? [];
  const plan = store.plan.value;
  const lines = checkupLines(plan, places);
  const [ticked, setTicked] = useState(() => new Set(lines.filter((l) => l.ticked && !l.disabled).map((l) => l.id)));
  const [discard, setDiscard] = useState(() => new Set<string>());
  const n = ticked.size;

  function toggle(id: string) {
    if (lines.find((l) => l.id === id)?.disabled) return;
    const next = new Set(ticked);
    if (!next.delete(id)) next.add(id);
    setTicked(next);
  }

  /** Discarding a region is a change to the regions line, so it ticks it. */
  function choose(code: string, keep: boolean) {
    const next = new Set(discard);
    if (keep) next.delete(code);
    else {
      next.add(code);
      if (!ticked.has("regions")) setTicked(new Set([...ticked, "regions"]));
    }
    setDiscard(next);
  }

  function go(step: "send" | "place") {
    store.plan.value = applyCheckup(plan, places, ticked, discard);
    onClose();
    store.step.value = step;
  }

  return (
    <Dialog
      open={open}
      title={t("checkup.title")}
      onClose={onClose}
      actions={
        <>
          <span class="checkup-count">{t("checkup.ticked", { n, m: lines.length })}</span>
          <button type="button" class="btn" disabled={!n} onClick={() => go("place")}>
            {t("checkup.steps")}
          </button>
          <button type="button" class="btn primary" disabled={!n} onClick={() => go("send")}>
            {t("checkup.send", { count: n })}
          </button>
        </>
      }
    >
      <p class="sub">{t("checkup.subtitle", { name: planName(plan) || t("device.unnamed") })}</p>
      {GROUPS.map((g) => {
        const group = lines.filter((l) => l.group === g);
        if (!group.length) return null;
        return (
          <section class="checkup-group" key={g}>
            <h3>{t(headingKey(g))}</h3>
            {group.map((l) => (
              <Fragment key={l.id}>
                <label class="checkup-line">
                  <input
                    type="checkbox"
                    checked={ticked.has(l.id)}
                    disabled={l.disabled}
                    onChange={() => toggle(l.id)}
                  />
                  <span class="checkup-text">
                    <span class="checkup-label">{t(l.labelKey)}</span>
                    <span class="checkup-change">
                      {l.from} → {l.to}
                    </span>
                    {l.detail ? <span class="checkup-note">{detailText(l.detail)}</span> : null}
                    {l.noteKey ? <span class="checkup-note">{t(l.noteKey)}</span> : null}
                  </span>
                </label>
                {l.removable ? (
                  <OwnRegions
                    codes={l.removable}
                    regions={plan.regions}
                    discard={discard}
                    goingToo={regionsGoingToo(plan, places, discard)}
                    onChoose={choose}
                  />
                ) : null}
              </Fragment>
            ))}
          </section>
        );
      })}
    </Dialog>
  );
}
