/** Quick check-up: the differences between the plan and the #BEmesh recommendation, to tick and apply. */
import { useState } from "preact/hooks";
import { applyCheckup, checkupLines, type CheckupGroup, type CheckupLine } from "../core/checkup";
import { planName } from "../core/plan";
import { t } from "../i18n/t";
import { store } from "../state/store";
import { Dialog } from "./Dialog";

const GROUPS: CheckupGroup[] = ["name", "radio", "advertising", "repeating", "regions", "advanced"];
const headingKey = (g: CheckupGroup) =>
  g === "name" ? "script.group.name" : g === "regions" ? "script.group.regions" : `settings.card.${g}`;

function detailText(d: NonNullable<CheckupLine["detail"]>): string {
  const list = (l: string[]) => l.join(", ");
  return [
    d.adds.length ? t("checkup.detail.adds", { list: list(d.adds) }) : "",
    d.denies.length ? t("checkup.detail.denies", { list: list(d.denies) }) : "",
    d.removes.length ? t("checkup.detail.removes", { list: list(d.removes) }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function CheckupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const places = store.data.value.places ?? [];
  const plan = store.plan.value;
  const lines = checkupLines(plan, places);
  const [ticked, setTicked] = useState(() => new Set(lines.filter((l) => l.ticked && !l.disabled).map((l) => l.id)));
  const n = ticked.size;

  function toggle(id: string) {
    if (lines.find((l) => l.id === id)?.disabled) return;
    const next = new Set(ticked);
    if (!next.delete(id)) next.add(id);
    setTicked(next);
  }

  function go(step: "send" | "place") {
    store.plan.value = applyCheckup(plan, places, ticked);
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
              <label class="checkup-line" key={l.id}>
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
            ))}
          </section>
        );
      })}
    </Dialog>
  );
}
