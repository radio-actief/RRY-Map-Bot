/* The top bar's account chip and ☰ menu, shared by the map, stats and region map pages.
 * Fills [data-account-chip] and [data-page-menu] (a wrapper holding the ☰ button and an empty .menu)
 * from bemesh-links.json and GET /auth/me. The configurator renders the same menu in AccountMenu.tsx. */
(function () {
  var PAGES = [
    ["/", "Map"],
    ["/stats", "Stats"],
    ["/region-map", "Region map"],
    ["/configurator", "Configurator"],
  ];
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
      loaded = Promise.all([links, me]);
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
    var a = link("/auth/login?next=" + here, "Sign in with Discord", "chip signin-chip");
    a.title = "Sign in to claim your node. Having trouble? Reach Radio-Actief on Discord or open an issue on GitHub.";
    slot.appendChild(a);
  }

  function fillMenu(wrap, links, user, here) {
    var menu = wrap.querySelector(".menu");
    if (!menu) return;
    menu.textContent = "";
    PAGES.forEach(function (p) {
      var a = link(p[0], p[1], "menu-page");
      if (p[0] === here) a.setAttribute("aria-current", "page");
      menu.appendChild(a);
    });
    menu.appendChild(el("hr", "menu-page"));
    links.forEach(function (l) {
      var a = link(l.href, l.label + " ");
      a.title = l.title || "";
      a.target = "_blank";
      a.rel = "noopener";
      a.appendChild(el("span", "ext muted", "↗"));
      a.lastChild.setAttribute("aria-hidden", "true");
      menu.appendChild(a);
    });
    menu.appendChild(el("hr"));
    if (user) {
      var row = el("div", "menu-user");
      row.appendChild(el("span", null, "@" + user.username));
      var mine = el("span", "menu-mynodes");
      mine.hidden = true;
      row.appendChild(mine);
      menu.appendChild(row);
      menu.appendChild(link("/auth/logout?next=" + here, "Log out"));
      showMyNodes();
    } else {
      menu.appendChild(link("/auth/login?next=" + here, "Sign in with Discord"));
    }
  }

  function showMyNodes() {
    document.querySelectorAll("[data-page-menu] .menu-mynodes").forEach(function (m) {
      m.hidden = myNodes == null;
      m.textContent = "";
      if (myNodes == null) return;
      m.appendChild(document.createTextNode("My nodes "));
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
    if (wrap.hasAttribute("data-wired")) return;
    wrap.setAttribute("data-wired", "");
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
    return load().then(function (res) {
      document.querySelectorAll("[data-account-chip]").forEach(function (s) { fillChip(s, res[1], here); });
      document.querySelectorAll("[data-page-menu]").forEach(function (w) {
        wire(w);
        fillMenu(w, res[0], res[1], here);
      });
    });
  }

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
    setMyNodes: function (n) {
      myNodes = n;
      showMyNodes();
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
