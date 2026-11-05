import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import links from "../../../../src/shared/bemesh-links.json";
// Side effect: src/shared/about.js sets window.BEmeshAbout, the About box the tool pages share.
import "../../../../src/shared/about.js";
import { I18N, lang, t } from "../i18n/t";
import { store } from "../state/store";
import { HERE, PAGES } from "./pages";

const PAGE = "/configurator";

/** The signed-in user, null when signed out, undefined until /auth/me has answered. */
const account = signal<string | null | undefined>(undefined);
let requested = false;

function loadAccount() {
  if (requested) return;
  requested = true;
  const done = (name: string | null) => (account.value = name);
  try {
    fetch("/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { authenticated?: boolean; user?: { username?: string } } | null) =>
        done(d?.authenticated && d.user?.username ? d.user.username : null),
      )
      .catch(() => done(null));
  } catch {
    done(null);
  }
}

/** Forgets the fetched account so the next render asks again (for tests). */
export function resetAccount() {
  requested = false;
  account.value = undefined;
}

/**
 * EN · NL · FR, the same switch as on the tool pages: in the top bar on a wide screen, in the ☰ menu
 * on a phone (bemesh-shell.css). A choice re-renders the configurator in place; the USB link stays.
 */
export function LangSwitch({ inMenu = false }: { inMenu?: boolean }) {
  const current = lang.value;
  return (
    <span class={`lang-switch${inMenu ? " menu-lang" : ""}`} role="group" aria-label={t("lang.label")}>
      {I18N.LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          title={I18N.NAMES[l]}
          aria-label={I18N.NAMES[l]}
          aria-pressed={l === current}
          onClick={(e) => {
            e.stopPropagation();
            I18N.choose(l);
          }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

/** The sign-in chip (signed out only), the language switch and the ☰ menu: on a phone the page links, then links, then sign in or the account. */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(loadAccount, []);
  useLayoutEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (wrap.current?.contains(e.target as Node)) return;
      setOpen(false);
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) button.current?.focus();
      }, 0);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    // A press outside closes it at once, also when it starts a map drag (a drag gives no click).
    const press = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("click", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const user = account.value;
  const toggle = () => {
    if (!open) store.drawerOpen.value = false;
    setOpen(!open);
  };
  return (
    <>
      {user === null ? (
        <a class="chip signin-chip" href={`/auth/login?next=${PAGE}`} title={t("menu.signInHint")}>
          {t("menu.signIn")}
        </a>
      ) : null}
      <LangSwitch />
      <span class="menu-wrap" ref={wrap}>
        <button
          type="button"
          class="icon"
          id="menu-toggle"
          ref={button}
          aria-label={t("menu.label")}
          aria-haspopup="true"
          aria-controls="page-menu"
          aria-expanded={open}
          onClick={toggle}
        >
          ☰
        </button>
        <nav class="menu" id="page-menu" aria-label={t("menu.label")} hidden={!open}>
          {/* The tool pages: shown on a phone only (bemesh-shell.css), where the top bar has no room for them. */}
          {PAGES.map(([href, key]) => (
            <a key={href} class="menu-page" href={href} aria-current={href === HERE ? "page" : undefined}>
              {t(key)}
            </a>
          ))}
          <hr class="menu-page" />
          {links.map((l) => (
            <a key={l.href} href={l.href} title={t(`${l.key}.title`)} target="_blank" rel="noopener">
              {t(l.key)} <span class="ext muted" aria-hidden="true">↗</span>
            </a>
          ))}
          <button
            type="button"
            class="menu-about"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              window.BEmeshAbout.open(button.current);
            }}
          >
            {t("about.menu")}
          </button>
          <hr />
          {typeof user === "string" ? (
            <>
              <div class="menu-user">
                <span>@{user}</span>
              </div>
              {/* A POST from this page: the server refuses a logout by link or from another site. */}
              <form class="menu-logout" method="post" action={`/auth/logout?next=${PAGE}`}>
                <button type="submit">{t("menu.logOut")}</button>
              </form>
            </>
          ) : (
            <a href={`/auth/login?next=${PAGE}`}>{t("menu.signIn")}</a>
          )}
          <hr class="menu-lang" />
          <LangSwitch inMenu />
        </nav>
      </span>
    </>
  );
}
