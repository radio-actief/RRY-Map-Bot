/* The top bar's account chip, language switch and ☰ menu, shared by the map, stats and region map pages.
 * Fills [data-account-chip], [data-lang-switch] and [data-page-menu] (a wrapper holding the ☰ button and
 * an empty .menu) from bemesh-links.json and GET /auth/me, in the page language (src/shared/i18n.js).
 * Tools the site runs besides the map (GET /api/v1/site-tools, e.g. NodeBook, on a path of this site
 * or on its own address) join the page links in the top bar's .switcher and the menu; a site that
 * only runs the map lists none. The map's own pages in that list are not shown twice.
 * The configurator renders the same menu in AccountMenu.tsx. */
(function () {
  var PAGES = [
    ["/", "page.map"],
    ["/stats", "page.stats"],
    ["/region-map", "page.regionMap"],
    ["/configurator", "page.configurator"],
  ];
  var OWN_KEYS = ["map", "stats", "regionMap", "configurator"];
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
    "lang.label": "Language",
  };

  /** Text in the page language; English when the translation layer is not on the page. */
  function t(key, fallback) {
    var i18n = window.BEmeshI18n;
    if (i18n && i18n.has(key)) return i18n.t(key);
    return fallback != null ? fallback : FALLBACK[key] || key;
  }
  var script = document.currentScript;
  var linksUrl = new URL("bemesh-links.json", script && script.src ? script.src : location.href).href;
  var myNodes = null;
  var loaded = null;

  function pagePath() {
    var p = location.pathname.replace(/\/+$/, "") || "/";
    return PAGES.some(function (x) { return x[0] === p; }) ? p : "/";
  }

  function load() {
    if (!loaded) {
      var links = fetch(linksUrl).then(function (r) { return r.json(); }).catch(function () { return []; });
      var me = fetch("/auth/me", { credentials: "include" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (d) {
          return d && d.authenticated && d.user ? d.user : null;
        });
      var tools = fetch("/api/v1/site-tools")
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; })
        .then(function (list) {
          var own = PAGES.map(function (p) { return p[0]; });
          return (Array.isArray(list) ? list : []).filter(function (x) {
            return x && typeof x.key === "string" && isToolUrl(x.url) && own.indexOf(x.url) < 0 && OWN_KEYS.indexOf(x.key) < 0;
          });
        });
      loaded = Promise.all([links, me, tools]);
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

  function fillChip(slot, user, here) {
    slot.textContent = "";
    if (user) return;
    var a = link("/auth/login?next=" + here, t("menu.signIn"), "chip signin-chip");
    a.title = t("menu.signInHint");
    slot.appendChild(a);
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

  function fillMenu(wrap, links, user, here, tools) {
    var menu = wrap.querySelector(".menu");
    if (!menu) return;
    menu.textContent = "";
    PAGES.forEach(function (p) {
      var a = link(p[0], t(p[1]), "menu-page");
      if (p[0] === here) a.setAttribute("aria-current", "page");
      menu.appendChild(a);
    });
    (tools || []).forEach(function (tool) {
      menu.appendChild(link(tool.url, toolText(tool), "menu-page"));
    });
    menu.appendChild(el("hr", "menu-page"));
    links.forEach(function (l) {
      var a = link(l.href, t(l.key, l.label) + " ");
      a.title = t(l.key + ".title", l.title || "");
      a.target = "_blank";
      a.rel = "noopener";
      a.appendChild(el("span", "ext muted", "↗"));
      a.lastChild.setAttribute("aria-hidden", "true");
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
    menu.appendChild(el("hr"));
    if (user) {
      var row = el("div", "menu-user");
      row.appendChild(el("span", null, "@" + user.username));
      var mine = el("span", "menu-mynodes");
      mine.hidden = true;
      row.appendChild(mine);
      menu.appendChild(row);
      // A POST from this page: the server refuses a logout by link or from another site.
      var out = el("form", "menu-logout");
      out.method = "post";
      out.setAttribute("action", "/auth/logout?next=" + here);
      var outBtn = el("button", null, t("menu.logOut"));
      outBtn.type = "submit";
      out.appendChild(outBtn);
      menu.appendChild(out);
      showMyNodes();
    } else {
      menu.appendChild(link("/auth/login?next=" + here, t("menu.signIn")));
    }
    var langRow = langSwitch("lang-switch menu-lang");
    if (langRow) {
      menu.appendChild(el("hr", "menu-lang"));
      menu.appendChild(langRow);
    }
  }

  /** EN · NL · FR: the current language pressed; a click remembers the choice and reloads in it. */
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
    document.querySelectorAll("[data-page-menu] .menu-mynodes").forEach(function (m) {
      m.hidden = myNodes == null;
      m.textContent = "";
      if (myNodes == null) return;
      m.appendChild(document.createTextNode(t("menu.myNodes") + " "));
      m.appendChild(el("b", null, String(myNodes)));
    });
  }

  function openWrap() {
    return document.querySelector("[data-page-menu] .menu:not([hidden])");
  }

  function setOpen(wrap, open) {
    var btn = wrap.querySelector("button");
    var menu = wrap.querySelector(".menu");
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) document.dispatchEvent(new CustomEvent("bemesh:menu-opened"));
  }

  function closeMenus() {
    document.querySelectorAll("[data-page-menu]").forEach(function (w) { setOpen(w, false); });
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
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-controls", menu.id);
    btn.setAttribute("aria-expanded", "false");
    menu.hidden = true;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      setOpen(wrap, menu.hidden);
    });
  }

  function init() {
    var here = pagePath();
    document.querySelectorAll("[data-page-menu]").forEach(wire);
    var i18n = window.BEmeshI18n;
    var ready = i18n && i18n.ready ? i18n.ready : Promise.resolve();
    return Promise.all([load(), ready]).then(function (both) {
      var res = both[0];
      document.querySelectorAll("[data-lang-switch]").forEach(fillLangSwitch);
      document.querySelectorAll("[data-account-chip]").forEach(function (s) { fillChip(s, res[1], here); });
      document.querySelectorAll("[data-page-menu]").forEach(function (w) {
        wire(w);
        fillMenu(w, res[0], res[1], here, res[2]);
      });
      document.querySelectorAll(".topbar .switcher").forEach(function (nav) { fillSwitcher(nav, res[2]); });
    });
  }

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

  window.BEmeshTopbar = {
    init: init,
    closeMenus: closeMenus,
    /** The site's other tools (not the four pages), as this bar loaded them; [] when none. */
    siteTools: function () {
      return load().then(function (res) { return res[2]; });
    },
    setMyNodes: function (n) {
      myNodes = n;
      showMyNodes();
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
