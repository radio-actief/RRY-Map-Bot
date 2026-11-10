import { t } from "../i18n/t";
import { planFromSnapshot } from "../core/plan";
import { ensureData } from "../state/appdata";
import { incoming } from "../state/handoff";
import { importPlan, store } from "../state/store";
import { Dialog } from "./Dialog";
import { siteTools, toolText } from "./pages";

/** The name of the tool that sent the settings: its page name when listed, else what it called itself. */
function senderName(source: string): string {
  const tool = siteTools.value.find((x) => x.key === source);
  return tool ? toolText(tool) : source;
}

/** Settings another tool on this site handed over: what arrived, and a choice to use them or not. */
export function HandoffDialog() {
  const got = incoming.value;
  if (!got) return null;
  const { msg, snapshot, skipped } = got;
  const close = () => (incoming.value = null);
  const use = async () => {
    await ensureData(["places"]);
    const plan = planFromSnapshot(snapshot, store.data.peek().places ?? []);
    // Like an import: the plan's access list (it belongs to the repeater) stays.
    importPlan({ ...plan, acl: store.plan.peek().acl });
    store.notice.value = { kind: "ok", text: t("handoff.used", { tool: senderName(msg.source) }) };
    close();
  };
  return (
    <Dialog
      open
      title={t("handoff.title", { tool: senderName(msg.source) })}
      onClose={close}
      actions={
        <>
          <button type="button" class="btn" onClick={close}>
            {t("handoff.drop")}
          </button>
          <button type="button" class="btn primary" onClick={() => void use()}>
            {t("handoff.use")}
          </button>
        </>
      }
    >
      <p>{t("handoff.text")}</p>
      <ul class="handoff-summary">
        {snapshot.name ? <li>{t("handoff.name", { name: snapshot.name })}</li> : null}
        <li>{t("handoff.settings", { n: Object.keys(msg.settings).length - skipped.filter((l) => l.startsWith("set ")).length })}</li>
        <li>{t("handoff.regions", { n: snapshot.regions ? Object.keys(snapshot.regions.parents ?? {}).length : 0 })}</li>
      </ul>
      {skipped.length ? (
        <>
          <p class="sub">{t("handoff.skipped")}</p>
          <ul class="handoff-skipped mono">
            {skipped.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      ) : null}
    </Dialog>
  );
}
