/**
 * Access list card (Advanced): the keys that may manage the repeater, with add, role change, remove
 * and undo. The reference is the list the connected repeater holds (its Read or read-back); without
 * it the card asks for a Read, since no change could be sent.
 */
import { useState } from "preact/hooks";
import { ACL_MAX, aclChanges, normaliseKey, type AclEntry, type AclRole } from "../../core/acl";
import { t } from "../../i18n/t";
import { editPlan, store } from "../../state/store";

const ROLES: AclRole[] = [3, 2, 1];
const RESULTS_MAX = 8;

const shorten = (key: string) => `${key.slice(0, 6)}…${key.slice(-6)}`;

export function AccessList() {
  const plan = store.plan.value;
  const read = store.snapshot.value?.acl;
  const nodes = store.data.value.nodes ?? [];
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const card = (body: preact.ComponentChildren, badge?: preact.ComponentChildren) => (
    <section class="card acl-card">
      <header class="card-head">
        <h3>{t("acl.title")}</h3>
        {badge}
      </header>
      {body}
    </section>
  );

  if (!read) return card(<p class="sub">{t("acl.needRead")}</p>);

  const acl = plan.acl ?? read;
  const names = new Map(nodes.map((n) => [n.public_key.toLowerCase(), n.adv_name]));
  const nameOf = (key: string) => names.get(key) || t("acl.unknown");
  const changes = aclChanges(read, acl);
  const present = new Map(acl.map((e) => [e.key, e]));
  const was = new Set(read.map((e) => e.key));
  const rows = [
    ...read.map((s) => ({ entry: present.get(s.key) ?? s, removed: !present.has(s.key), isNew: false })),
    ...acl.filter((e) => !was.has(e.key)).map((entry) => ({ entry, removed: false, isNew: true })),
  ];

  const set = (list: AclEntry[]) => editPlan({ acl: list });
  const add = (key: string) => {
    if (present.has(key)) return setError(t("acl.duplicate"));
    const old = read.find((e) => e.key === key);
    set([...acl, old ?? { key, role: 3 }]);
    setText("");
    setError(null);
  };
  const submit = () => {
    const key = normaliseKey(text);
    if (key) add(key);
    else setError(t("acl.badKey"));
  };
  const needle = text.trim().toLowerCase();
  const found =
    needle.length >= 2 && !normaliseKey(text)
      ? nodes
          .filter(
            (n) =>
              n.type === 1 &&
              !present.has(n.public_key.toLowerCase()) &&
              (n.adv_name.toLowerCase().includes(needle) || n.public_key.toLowerCase().startsWith(needle)),
          )
          .slice(0, RESULTS_MAX)
      : [];

  const badge =
    changes === 0 ? (
      <span class="badge">{t("settings.badge.unchanged")}</span>
    ) : (
      <span class="badge warn">{t("changes", { count: changes })}</span>
    );
  const undo = (
    <>
      {badge}
      {changes > 0 ? (
        <button
          type="button"
          class="icon undo"
          aria-label={t("acl.undo")}
          title={t("acl.undo")}
          onClick={() => set(read.map((e) => ({ ...e })))}
        >
          ↺
        </button>
      ) : null}
    </>
  );

  return card(
    <>
      <p class="sub">{t("acl.help")}</p>
      <ul class="acl-list">
        {rows.map(({ entry, removed, isNew }) => {
          const name = nameOf(entry.key);
          return (
            <li key={entry.key} class={`acl-row${removed ? " removed" : ""}`}>
              <span class="acl-name">{name}</span>
              <span class="acl-key">{shorten(entry.key)}</span>
              {removed ? <span class="badge warn">{t("acl.removed")}</span> : null}
              {isNew ? <span class="badge ok">{t("acl.new")}</span> : null}
              <select
                aria-label={t("acl.role", { name: `${name} ${shorten(entry.key)}` })}
                value={entry.role}
                disabled={removed}
                onChange={(e) => {
                  const role = Number((e.currentTarget as HTMLSelectElement).value) as AclRole;
                  set(acl.map((x) => (x.key === entry.key ? { key: x.key, role } : x)));
                }}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`acl.role.${r}`)}
                  </option>
                ))}
              </select>
              {removed ? (
                <button
                  type="button"
                  class="icon undo"
                  aria-label={t("acl.restore", { name })}
                  title={t("acl.restore", { name })}
                  onClick={() => add(entry.key)}
                >
                  ↺
                </button>
              ) : (
                <button
                  type="button"
                  class="icon"
                  aria-label={t("acl.remove", { name })}
                  title={t("acl.remove", { name })}
                  onClick={() => set(acl.filter((x) => x.key !== entry.key))}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div class="acl-add">
        <input
          type="text"
          autocomplete="off"
          aria-label={t("acl.addPlaceholder")}
          placeholder={t("acl.addPlaceholder")}
          value={text}
          onInput={(e) => {
            setText((e.currentTarget as HTMLInputElement).value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button type="button" class="btn small" onClick={submit}>
          {t("acl.add")}
        </button>
      </div>
      {found.length ? (
        <ul class="acl-results">
          {found.map((n) => (
            <li key={n.public_key}>
              <button type="button" class="btn small" onClick={() => add(n.public_key.toLowerCase())}>
                {n.adv_name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <span class="field-error">{error}</span> : null}
      {acl.length >= ACL_MAX ? <p class="sub help">{t("acl.full")}</p> : null}
    </>,
    undo,
  );
}
