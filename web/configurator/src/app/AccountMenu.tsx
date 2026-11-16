import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import links from "../../../../src/shared/bemesh-links.json";
// Side effect: src/shared/about.js sets window.BEmeshAbout, the About box the tool pages share.
import "../../../../src/shared/about.js";
// Side effect: src/shared/menu-place.js sets window.BEmeshMenu, which keeps the menu inside the window.
import "../../../../src/shared/menu-place.js";
// Side effect: src/shared/logout-notice.js sets window.BEmeshLogoutNotice, the word after a log out.
import "../../../../src/shared/logout-notice.js";
import { I18N, lang, t } from "../i18n/t";
import { store } from "../state/store";
import { HERE, PAGES, siteTools, toolText } from "./pages";

const PAGE = "/configurator";
/** The site's one account page, on the map. */
const ACCOUNT = "/account";

/** A signed-in person: the Discord user name and the name Discord shows (display name, else user name). */
type Person = { username: string; name: string };

/** The signed-in person, null when signed out, undefined until /auth/me has answered. */
const account = signal<Person | null | undefined>(undefined);
let requested = false;

function loadAccount() {
  if (requested) return;
  requested = true;
  const done = (person: Person | null) => {
    account.value = person;
    recordSeen(person !== null);
  };
  try {
    fetch("/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { authenticated?: boolean; user?: { username?: string; global_name?: string | null } } | null) => {
        const username = d?.authenticated ? d.user?.username : undefined;
        done(username ? { username, name: d?.user?.global_name || username } : null);
      })
      .catch(() => done(null));
  } catch {
    done(null);
  }
}

const SEEN = "bemesh.account.seen";

/** Records whether someone is signed in (localStorage "bemesh.account.seen"), only on a change, so
 * the device hubs of the site's other tools and the map's other tabs hear it (src/device-hub.js,
 * src/shared/topbar.js). */
export function recordSeen(signedIn: boolean): void {
  try {
    const seen = JSON.stringify({ signedIn });
    if (localStorage.getItem(SEEN) !== seen) localStorage.setItem(SEEN, seen);
  } catch {
    /* blocked storage: the other tools learn it when they look again */
  }
}

/** The first letter of the name, upper case (one character, also for a letter outside the BMP). */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : "?";
}

/** Signed in or out in another tab of the site: ask /auth/me again, so the account button or the
 * sign-in chip follows without a reload. */
function onStorage(e: StorageEvent) {
  if (e.key !== SEEN) return;
  requested = false;
  loadAccount();
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

/** The menu's rows that take the keyboard and are shown (all of them in a document without layout). */
function shownRows(menu: HTMLElement): HTMLElement[] {
  const all = Array.from(menu.querySelectorAll<HTMLElement>("a, button"));
  const shown = all.filter((x) => x.getClientRects().length > 0);
  return shown.length ? shown : all;
}

/**
 * A menu that opens under its button in the top bar (☰, the account): it stays inside the window
 * (menu-place.js), only a keyboard opening moves the focus in, and a press outside or Escape closes it.
 */
function usePopup() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  /** Opened with Enter or Space: the focus moves to the first row (a tap leaves no ring there). */
  const byKeyboard = useRef(false);
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    window.BEmeshMenu.place(menu.current);
    if (byKeyboard.current) shownRows(menu.current)[0]?.focus();
    const resize = () => window.BEmeshMenu.place(menu.current);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [open]);
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
  const toggle = (e: MouseEvent) => {
    // A click from Enter or Space has no pointer behind it (detail 0).
    byKeyboard.current = !open && e.detail === 0;
    setOpen(!open);
  };
  return { open, setOpen, wrap, button, menu, toggle };
}

/**
 * The account group, the same in the account menu and in ☰: the name (the @handle under it when it
 * differs), My nodes, Account, then Log out.
 */
function AccountRows({ person }: { person: Person }) {
  return (
    <>
      <div class="menu-user">
        <span class="menu-name">{person.name}</span>
        {person.username !== person.name ? <span class="menu-handle">@{person.username}</span> : null}
      </div>
      <a class="menu-account-nodes" href={`${ACCOUNT}#my-nodes`}>
        <span>{t("menu.myNodes")}</span>
      </a>
      <a class="menu-account" href={ACCOUNT}>
        {t("account.title")}
      </a>
      <hr />
      {/* A POST from this page: the server refuses a logout by link or from another site. */}
      <form class="menu-logout" method="post" action={`/auth/logout?next=${PAGE}`}>
        <button type="submit">{t("menu.logOut")}</button>
      </form>
    </>
  );
}

/**
 * Signed in: in the sign-in chip's place, a 28px circle with the person's initial (no picture) that
 * opens a small menu: the name, My nodes, Account and Log out. On a phone the account is in ☰ only.
 */
export function AccountButton({ person }: { person: Person }) {
  const { open, wrap, button, menu, toggle } = usePopup();
  return (
    <span class="menu-wrap account-wrap" ref={wrap}>
      <button
        type="button"
        class="icon account-btn"
        id="account-toggle"
        ref={button}
        title={person.name}
        aria-label={t("account.label", { name: person.name })}
        aria-haspopup="true"
        aria-controls="account-menu"
        aria-expanded={open}
        onClick={(e) => {
          if (!open) store.drawerOpen.value = false;
          toggle(e);
        }}
      >
        <span class="account-initial" aria-hidden="true">
          {initialOf(person.name)}
        </span>
      </button>
      <nav class="menu page-menu account-menu" id="account-menu" ref={menu} aria-label={t("account.title")} hidden={!open}>
        <AccountRows person={person} />
      </nav>
    </span>
  );
}

/**
 * The sign-in chip (signed out) or the account button (signed in), the language switch and the ☰
 * menu, in the order every #BEmesh tool uses: the tools (phone and tablet only), the outside links,
 * About, sign in or the account, the language (phone and tablet only). The account joins once
 * /auth/me has answered.
 */
export function AccountMenu() {
  const { open, setOpen, wrap, button, menu, toggle: toggleMenu } = usePopup();
  useEffect(loadAccount, []);
  useEffect(() => {
    // The page's texts are loaded before the configurator renders: the word after a log out is in its language.
    window.BEmeshLogoutNotice.run();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const user = account.value;
  const toggle = (e: MouseEvent) => {
    if (!open) store.drawerOpen.value = false;
    toggleMenu(e);
  };
  return (
    <>
      {user ? <AccountButton person={user} /> : null}
      {user === null ? (
        <a class="chip signin-chip" href={`/auth/login?next=${PAGE}`} title={t("menu.signInHint")} aria-label={t("menu.signIn")}>
          <i class="bi bi-person-circle" aria-hidden="true" />
          <span class="signin-text">{t("menu.signIn")}</span>
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
          <i class="bi bi-list" aria-hidden="true" />
        </button>
        <nav class="menu page-menu" id="page-menu" ref={menu} aria-label={t("menu.label")} hidden={!open}>
          {/* The tools: shown on a phone and a tablet only (bemesh-shell.css), where the top bar has no room for them. */}
          {PAGES.map(([href, key]) => (
            <a key={href} class="menu-page" href={href} aria-current={href === HERE ? "page" : undefined}>
              {t(key)}
              {href === HERE ? <i class="bi bi-check-lg menu-check" aria-hidden="true" /> : null}
            </a>
          ))}
          {siteTools.value.map((tool) => (
            <a key={tool.url} class="menu-page" href={tool.url} data-site-tool={tool.key}>
              {toolText(tool)}
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
          {user === undefined ? null : <hr />}
          {user ? (
            <>
              <AccountRows person={user} />
            </>
          ) : user === null ? (
            <a class="menu-signin" href={`/auth/login?next=${PAGE}`}>{t("menu.signIn")}</a>
          ) : null}
          <hr class="menu-lang" />
          <LangSwitch inMenu />
        </nav>
      </span>
    </>
  );
}
