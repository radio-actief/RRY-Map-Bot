/* The top bar's account chip, language switch and ☰ menu, shared by the map, stats, region map and
 * account pages. Fills [data-account-chip], [data-lang-switch] and [data-page-menu] (a wrapper holding
 * the ☰ button and an empty .menu) in the page language (src/shared/i18n.js).
 * Signed out, [data-account-chip] holds "Sign in with Discord"; signed in, the account button: a circle
 * with the person's initial that opens a small menu (name, My nodes, Account, Log out). On a phone the
 * account is in ☰ only (bemesh-shell.css).
 * The menu shows what is known at once: the tool pages, the outside links (LINKS, a copy of
 * bemesh-links.json), About and the language switch. Sign in or the account follows GET /auth/me.
 * Tools the site runs besides the map (GET /api/v1/site-tools, e.g. NodeBook, on a path of this site
 * or on its own address) join the page links in the top bar's .switcher and the menu when they
 * arrive; a site that only runs the map lists none. The map's own pages in that list are not shown twice.
 * The menu opens right-aligned under ☰ and stays inside the window (src/shared/menu-place.js).
 * A ☰ marked [data-no-account] leaves the account out (the sign-out and failed pages under /auth/).
 * When another tab signs in or out (localStorage "bemesh.account.seen" changes), the bar asks
 * /auth/me again and redraws. After a log out (?logout= in the address) it shows the word of
 * src/shared/logout-notice.js when the page loads that file.
 * The configurator renders the same menu in AccountMenu.tsx. */
(function () {
  var PAGES = [
    ["/", "page.map"],
    ["/stats", "page.stats"],
    ["/region-map", "page.regionMap"],
    ["/configurator", "page.configurator"],
  ];
  var OWN_KEYS = ["map", "stats", "regionMap", "configurator"];
  /** The site's account page: not a tool, so no link of the switcher is current there. */
  var ACCOUNT = "/account";
  // A copy of bemesh-links.json (this file is a classic script), so the menu needs no request.
  var LINKS = [
    { key: "link.radioActief", label: "Radio-Actief Website", href: "https://radio-actief.be", title: "Radio-Actief website" },
    { key: "link.bemesh", label: "#BEmesh Website", href: "https://meshcore.radio-actief.be", title: "MeshCore website: settings & news" },
    { key: "link.docs", label: "Documentation", href: "https://meshwiki.radio-actief.be", title: "Documentation" },
    { key: "link.discord", label: "Discord", href: "https://discord.gg/kvybAgqnhD", title: "Join our Discord server" },
    { key: "link.github", label: "GitHub", href: "https://github.com/radio-actief/RRY-Map-Bot", title: "Go to the Radio-Actief GitHub repo" },
  ];
  // A copy of isToolUrl in site-urls.js (this file is a classic script): a path on this site, or
  // plain https ending in "/" (http only on this machine, for tests).
  var TOOL_PATH = /^\/(?![/\\])[A-Za-z0-9._~\-/]*$/;
  var TOOL_FULL = /^(?:https:\/\/[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|http:\/\/(?:localhost|127\.0\.0\.1))(?::[1-9][0-9]{0,4})?\/(?:[A-Za-z0-9._~-]+\/)*$/;
  var DOT_SEGMENT = /(^|\/)\.{1,2}(\/|$)/;
  function isToolUrl(url) {
    if (typeof url !== "string") return false;
    if (TOOL_PATH.test(url)) return !DOT_SEGMENT.test(url);
    return TOOL_FULL.test(url) && !DOT_SEGMENT.test(url.slice(url.indexOf("/", url.indexOf("//") + 2)));
  }
  var FALLBACK = {
    "page.map": "Map",
    "page.stats": "Stats",
    "page.regionMap": "Region map",
    "page.configurator": "Configurator",
    "page.nodebook": "NodeBook",
    "page.meshmate": "MeshMate",
    "menu.signIn": "Sign in with Discord",
    "menu.signInHint": "Sign in to claim your node. Having trouble? Reach Radio-Actief on Discord or open an issue on GitHub.",
    "menu.logOut": "Log out",
    "menu.myNodes": "My nodes",
    "account.title": "Account",
    "account.label": "Account: {name}",
    "lang.label": "Language",
  };

  /** Text in the page language; English when the translation layer is not on the page. */
  function t(key, fallback) {
    var i18n = window.BEmeshI18n;
    if (i18n && i18n.has(key)) return i18n.t(key);
    return fallback != null ? fallback : FALLBACK[key] || key;
  }

  /** Text with {placeholders} in the page language; the English text when the layer is not there. */
  function tp(key, params) {
    var i18n = window.BEmeshI18n;
    if (i18n && i18n.has(key)) return i18n.t(key, params);
    return String(FALLBACK[key] || key).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }

  /** The person's name as Discord shows it: the display name, else the user name. */
  function displayName(user) {
    return String(user.global_name || user.username || "");
  }

  /** The first letter of the name, upper case (one character, also for a letter outside the BMP). */
  function initialOf(name) {
    var first = Array.from(name.trim())[0];
    return first ? first.toLocaleUpperCase() : "?";
  }

  /** Where Log out returns to: this page, or the map from the account page (it needs a sign-in). */
  function afterLogout(here) {
    return here === ACCOUNT ? "/" : here;
  }
  var myNodes = null;
  var loaded = null;
  /** What the bar shows: user is undefined until /auth/me has answered, null when signed out. */
  var state = { user: undefined, tools: [] };

  function pagePath() {
    var p = location.pathname.replace(/\/+$/, "") || "/";
    if (p === ACCOUNT) return p;
    // The sign-out and failed pages are none of the pages.
    if (p.indexOf("/auth/") === 0) return null;
    return PAGES.some(function (x) { return x[0] === p; }) ? p : "/";
  }

  /** The listed tools that are not one of the four pages, in the site's order (NodeBook, MeshMate). */
  function otherTools(list) {
    var own = PAGES.map(function (p) { return p[0]; });
    return (Array.isArray(list) ? list : []).filter(function (x) {
      return x && typeof x.key === "string" && isToolUrl(x.url) && own.indexOf(x.url) < 0 && OWN_KEYS.indexOf(x.key) < 0;
    });
  }

  var SEEN = "bemesh.account.seen";

  /** Records whether someone is signed in (localStorage "bemesh.account.seen"), only on a change: the
   * device hubs of the site's other tools, open in other tabs, hear it and tell their page, and so
   * do the map's other tabs (see the storage listener below). */
  function recordSeen(signedIn) {
    try {
      var seen = JSON.stringify({ signedIn: signedIn });
      if (localStorage.getItem(SEEN) !== seen) localStorage.setItem(SEEN, seen);
    } catch (e) {
      /* blocked storage: the other tools learn it when they look again */
    }
  }

  /** Asks who is signed in; the bar redraws with the answer. */
  function askMe() {
    return fetch("/auth/me", { credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) {
        state.user = d && d.authenticated && d.user ? d.user : null;
        recordSeen(state.user !== null);
        render();
        return state.user;
      });
  }

  /** Asks once for the account and the site's tools; the bar redraws as each answer arrives. */
  function load() {
    if (!loaded) {
      var me = askMe();
      var tools = fetch("/api/v1/site-tools")
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; })
        .then(function (list) {
          state.tools = otherTools(list);
          render();
          return state.tools;
        });
      loaded = Promise.all([me, tools]);
    }
    return loaded;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function link(href, text, cls) {
    var a = el("a", cls, text);
    a.setAttribute("href", href);
    return a;
  }

  /** A Bootstrap icon, hidden from screen readers (the control carries the name). */
  function icon(name, cls) {
    var i = el("i", "bi " + name + (cls ? " " + cls : ""));
    i.setAttribute("aria-hidden", "true");
    return i;
  }

  function fillChip(slot, user, here) {
    var old = slot.querySelector("[data-account-menu]");
    var wasOpen = !!(old && !old.querySelector(".menu").hidden);
    slot.textContent = "";
    if (user) {
      var wrap = accountButton(user, here);
      slot.appendChild(wrap);
      if (wasOpen) setOpen(wrap, true, false);
      return;
    }
    if (user !== null) return;
    var a = link("/auth/login?next=" + (here || "/"), "", "chip signin-chip");
    a.title = t("menu.signInHint");
    a.setAttribute("aria-label", t("menu.signIn"));
    var icon = el("i", "bi bi-person-circle");
    icon.setAttribute("aria-hidden", "true");
    a.appendChild(icon);
    a.appendChild(el("span", "signin-text", t("menu.signIn")));
    slot.appendChild(a);
  }

  /** Log out of this browser: a POST from this page (the server refuses a logout by link or from another site). */
  function logoutForm(here) {
    var out = el("form", "menu-logout");
    out.method = "post";
    out.setAttribute("action", "/auth/logout?next=" + afterLogout(here || "/"));
    var outBtn = el("button", null, t("menu.logOut"));
    outBtn.type = "submit";
    out.appendChild(outBtn);
    return out;
  }

  /**
   * The account group, the same in the account menu and in ☰: the name (the @handle under it when
   * it differs), My nodes (with the count once the map knows it), Account, then Log out.
   */
  function accountRows(menu, user, here) {
    var name = displayName(user);
    var who = el("div", "menu-user");
    who.appendChild(el("span", "menu-name", name));
    if (user.username && user.username !== name) who.appendChild(el("span", "menu-handle", "@" + user.username));
    menu.appendChild(who);
    var nodes = link(ACCOUNT + "#my-nodes", "", "menu-account-nodes");
    nodes.appendChild(el("span", null, t("menu.myNodes")));
    var count = el("span", "menu-mynodes");
    count.hidden = true;
    nodes.appendChild(count);
    menu.appendChild(nodes);
    var page = link(ACCOUNT, t("account.title"), "menu-account");
    if (here === ACCOUNT) page.setAttribute("aria-current", "page");
    menu.appendChild(page);
    menu.appendChild(el("hr"));
    menu.appendChild(logoutForm(here));
  }

  /**
   * Signed in: in the sign-in chip's place, a 28px circle with the person's initial (no picture) that
   * opens a small menu: the name, My nodes, Account and Log out. Opened like ☰ (menu-place.js keeps it
   * in the window; only a keyboard opening moves the focus in).
   */
  function accountButton(user, here) {
    var name = displayName(user);
    var wrap = el("span", "menu-wrap account-wrap");
    wrap.setAttribute("data-account-menu", "");
    var btn = el("button", "icon account-btn");
    btn.type = "button";
    btn.id = "account-toggle";
    btn.setAttribute("aria-label", tp("account.label", { name: name }));
    btn.title = name;
    var circle = el("span", "account-initial", initialOf(name));
    circle.setAttribute("aria-hidden", "true");
    btn.appendChild(circle);
    var menu = el("nav", "menu account-menu");
    menu.id = "account-menu";
    menu.setAttribute("aria-label", t("account.title"));
    accountRows(menu, user, here);
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    wire(wrap);
    return wrap;
  }

  /** A listed tool's link text: its translated page.<key>, else the label the site gave. */
  function toolText(tool) {
    return t("page." + tool.key, tool.label);
  }

  /** The listed tools after the map's own links in the top bar; again on every call (the map page re-renders its bar). */
  function fillSwitcher(nav, tools) {
    nav.querySelectorAll("[data-site-tool]").forEach(function (a) { a.remove(); });
    tools.forEach(function (tool) {
      var a = link(tool.url, toolText(tool));
      a.setAttribute("data-site-tool", tool.key);
      nav.appendChild(a);
    });
  }

  /** The menu's rows that take the keyboard, in order. */
  function rows(menu) {
    var all = Array.prototype.slice.call(menu.querySelectorAll("a, button"));
    var shown = all.filter(function (x) {
      return x.getClientRects().length > 0;
    });
    // Without layout (a test document) every row counts as shown.
    return shown.length ? shown : all;
  }

  /**
   * The ☰ menu, in the order every #BEmesh tool uses: the tools (phone and tablet only), the
   * outside links, About, the account, the language (phone and tablet only).
   */
  function fillMenu(wrap, here) {
    var menu = wrap.querySelector(".menu");
    if (!menu) return;
    // A redraw keeps the keyboard where it was.
    var focused = menu.contains(document.activeElement) ? Array.prototype.indexOf.call(menu.querySelectorAll("a, button"), document.activeElement) : -1;
    menu.textContent = "";
    PAGES.forEach(function (p) {
      var a = link(p[0], t(p[1]), "menu-page");
      if (p[0] === here) {
        a.setAttribute("aria-current", "page");
        a.appendChild(icon("bi-check-lg", "menu-check"));
      }
      menu.appendChild(a);
    });
    state.tools.forEach(function (tool) {
      var a = link(tool.url, toolText(tool), "menu-page");
      a.setAttribute("data-site-tool", tool.key);
      menu.appendChild(a);
    });
    menu.appendChild(el("hr", "menu-page"));
    LINKS.forEach(function (l) {
      var a = link(l.href, t(l.key, l.label));
      a.title = t(l.key + ".title", l.title || "");
      a.target = "_blank";
      a.rel = "noopener";
      var ext = el("span", "ext muted", "↗");
      ext.setAttribute("aria-hidden", "true");
      a.appendChild(ext);
      menu.appendChild(a);
    });
    if (window.BEmeshAbout) {
      var about = el("button", "menu-about", window.BEmeshAbout.menuLabel());
      about.type = "button";
      about.addEventListener("click", function (e) {
        e.stopPropagation();
        closeMenus();
        window.BEmeshAbout.open(wrap.querySelector("button"));
      });
      menu.appendChild(about);
    }
    var user = wrap.hasAttribute("data-no-account") ? undefined : state.user;
    if (user !== undefined) {
      menu.appendChild(el("hr"));
      if (user) {
        accountRows(menu, user, here);
      } else {
        menu.appendChild(link("/auth/login?next=" + (here || "/"), t("menu.signIn"), "menu-signin"));
      }
    }
    var langRow = langSwitch("lang-switch menu-lang");
    if (langRow) {
      menu.appendChild(el("hr", "menu-lang"));
      menu.appendChild(langRow);
    }
    showMyNodes();
    if (focused >= 0) {
      var again = menu.querySelectorAll("a, button")[focused];
      if (again) again.focus();
    }
    if (!menu.hidden && window.BEmeshMenu) window.BEmeshMenu.place(menu);
  }

  /** EN · NL · FR: the current language pressed; a click saves the choice for all the tools and reloads in it. */
  function langSwitch(cls) {
    var i18n = window.BEmeshI18n;
    if (!i18n) return null;
    var group = el("span", cls);
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", t("lang.label"));
    i18n.LANGS.forEach(function (l) {
      var b = el("button", null, l.toUpperCase());
      b.type = "button";
      b.lang = l;
      b.title = i18n.NAMES[l];
      b.setAttribute("aria-label", i18n.NAMES[l]);
      b.setAttribute("aria-pressed", l === i18n.lang ? "true" : "false");
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        i18n.choose(l);
      });
      group.appendChild(b);
    });
    return group;
  }

  function fillLangSwitch(slot) {
    slot.textContent = "";
    var group = langSwitch("lang-switch");
    if (group) slot.appendChild(group);
  }

  function showMyNodes() {
    document.querySelectorAll(".menu-mynodes").forEach(function (m) {
      m.hidden = myNodes == null;
      m.textContent = myNodes == null ? "" : String(myNodes);
    });
  }

  /** The ☰ menus and the account menu: one open at a time. */
  var WRAPS = "[data-page-menu], [data-account-menu]";

  function openWrap() {
    return document.querySelector("[data-page-menu] .menu:not([hidden]), [data-account-menu] .menu:not([hidden])");
  }

  function setOpen(wrap, open, byKeyboard) {
    var btn = wrap.querySelector("button");
    var menu = wrap.querySelector(".menu");
    if (open) {
      document.querySelectorAll(WRAPS).forEach(function (w) {
        if (w !== wrap) setOpen(w, false);
      });
    }
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) return;
    if (window.BEmeshMenu) window.BEmeshMenu.place(menu);
    // Only a keyboard opening moves the focus in: a tap or click leaves no ring on the first row.
    if (byKeyboard) {
      var first = rows(menu)[0];
      if (first) first.focus();
    }
    document.dispatchEvent(new CustomEvent("bemesh:menu-opened"));
  }

  function closeMenus() {
    document.querySelectorAll(WRAPS).forEach(function (w) { setOpen(w, false); });
  }

  function wire(wrap) {
    // A property, not an attribute: the map page's Vue template may be compiled from this DOM
    // and its fresh elements must be wired again.
    if (wrap.__bemeshWired) return;
    wrap.__bemeshWired = true;
    var btn = wrap.querySelector("button");
    var menu = wrap.querySelector(".menu");
    btn.id = btn.id || "menu-toggle";
    menu.id = menu.id || "page-menu";
    // Rows of the ☰ menu's size: 32px, 44px on a phone.
    menu.classList.add("page-menu");
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-controls", menu.id);
    btn.setAttribute("aria-expanded", "false");
    menu.hidden = true;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      // A click from Enter or Space has no pointer behind it (detail 0).
      setOpen(wrap, menu.hidden, e.detail === 0);
    });
  }

  /** Draws the account chip, the language switches, the menus and the switcher's extra tools from what is known now. */
  function render() {
    var here = pagePath();
    document.querySelectorAll("[data-lang-switch]").forEach(fillLangSwitch);
    document.querySelectorAll("[data-account-chip]").forEach(function (s) { fillChip(s, state.user, here); });
    document.querySelectorAll("[data-page-menu]").forEach(function (w) {
      wire(w);
      fillMenu(w, here);
    });
    document.querySelectorAll(".topbar .switcher").forEach(function (nav) { fillSwitcher(nav, state.tools); });
  }

  function init() {
    render();
    load();
    var i18n = window.BEmeshI18n;
    var ready = i18n && i18n.ready ? i18n.ready : Promise.resolve();
    // The page language's texts arrive after the first draw.
    return Promise.all([loaded, ready]).then(function () {
      render();
      if (window.BEmeshLogoutNotice) window.BEmeshLogoutNotice.run();
    });
  }

  // Signed in or out in another tab of the site (the map's pages, the configurator, a tool's device
  // hub): ask again, so this tab's account button or sign-in chip follows without a reload.
  window.addEventListener("storage", function (e) {
    if (e.key !== SEEN) return;
    askMe();
  });

  // A press outside the open menu closes it right away, also when it starts a map drag (a drag
  // gives no click, so the menu would stay open over the panning map). The click below still puts
  // the focus back on ☰.
  document.addEventListener(
    "pointerdown",
    function (e) {
      var menu = openWrap();
      if (menu && !menu.parentNode.contains(e.target)) closeMenus();
    },
    true,
  );

  document.addEventListener(
    "click",
    function (e) {
      var menu = openWrap();
      if (!menu || menu.parentNode.contains(e.target)) return;
      var btn = menu.parentNode.querySelector("button");
      closeMenus();
      setTimeout(function () {
        if (!document.activeElement || document.activeElement === document.body) btn.focus();
      }, 0);
    },
    true,
  );

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var menu = openWrap();
    if (!menu) return;
    var btn = menu.parentNode.querySelector("button");
    closeMenus();
    btn.focus();
  });

  // A turned phone or a resized window keeps the open menu inside it.
  window.addEventListener("resize", function () {
    var menu = openWrap();
    if (menu && window.BEmeshMenu) window.BEmeshMenu.place(menu);
  });

  window.BEmeshTopbar = {
    init: init,
    closeMenus: closeMenus,
    /** The site's other tools (not the four pages), as this bar loaded them; [] when none. */
    siteTools: function () {
      return load().then(function () { return state.tools; });
    },
    setMyNodes: function (n) {
      myNodes = n;
      showMyNodes();
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
