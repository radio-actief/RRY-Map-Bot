/* The ☰ menu's About box, shared by the map, stats, region map and the configurator: the release
 * the site runs (GET /api/v1/version: version, date, notes, public links), in the page language.
 * Sets window.BEmeshAbout.open(opener); the box is a <dialog>, so Escape closes it and focus goes
 * back to the opener. */
(function () {
  var FALLBACK = {
    "about.menu": "About",
    "about.title": "About #BEmesh",
    "about.text": "BEmesh is Radio-Actief's community initiative for one Belgian MeshCore network on shared, voluntary settings. This is its map, configurator and Discord bot.",
    "about.version": "Version",
    "about.released": "Released",
    "about.whatsNew": "What's new in this version",
    "about.notesInEnglish": "Release notes are in English.",
    "about.allNotes": "All release notes",
    "about.source": "Source code",
    "about.close": "Close",
    "about.loadFailed": "Couldn't load the release details. Try again later.",
    "about.loading": "Loading…",
  };
  var GROUPS = { New: "about.group.new", Fixed: "about.group.fixed", Other: "about.group.other" };

  function t(key) {
    var i18n = window.BEmeshI18n;
    if (i18n && i18n.has(key)) return i18n.t(key);
    return FALLBACK[key] || key;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var info = null;
  function load() {
    if (!info) {
      info = fetch("/api/v1/version", { headers: { Accept: "application/json" } }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
      info.catch(function () {
        info = null;
      });
    }
    return info;
  }

  function released(d) {
    var i18n = window.BEmeshI18n;
    try {
      return i18n ? i18n.date(d + "T12:00:00Z", { day: "numeric", month: "long", year: "numeric" }) : d;
    } catch (e) {
      return d;
    }
  }

  function extLink(href, text) {
    var a = el("a", null, text + " ");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    var arrow = el("span", "ext muted", "↗");
    arrow.setAttribute("aria-hidden", "true");
    a.appendChild(arrow);
    return a;
  }

  function render(body, data) {
    body.textContent = "";
    var dl = el("dl", "about-facts");
    dl.appendChild(el("dt", null, t("about.version")));
    dl.appendChild(el("dd", "about-version", data.version));
    if (data.released) {
      dl.appendChild(el("dt", null, t("about.released")));
      dl.appendChild(el("dd", null, released(data.released)));
    }
    body.appendChild(dl);
    if (data.intro || (data.changes && data.changes.length)) {
      body.appendChild(el("h3", null, t("about.whatsNew")));
      var lang = window.BEmeshI18n && window.BEmeshI18n.lang;
      if (lang && lang !== "en") body.appendChild(el("p", "sub", t("about.notesInEnglish")));
      if (data.intro) body.appendChild(el("p", null, data.intro));
      (data.changes || []).forEach(function (g) {
        body.appendChild(el("h4", null, GROUPS[g.group] ? t(GROUPS[g.group]) : g.group));
        var ul = el("ul");
        g.items.forEach(function (item) {
          ul.appendChild(el("li", null, item));
        });
        body.appendChild(ul);
      });
    }
    var links = el("p", "about-links");
    links.appendChild(extLink(data.notes_url, t("about.allNotes")));
    links.appendChild(extLink(data.source_url, t("about.source")));
    body.appendChild(links);
  }

  var dialog = null;
  var returnTo = null;

  function build() {
    dialog = el("dialog", "about-dialog");
    dialog.id = "about-dialog";
    dialog.setAttribute("aria-labelledby", "about-title");
    var head = el("h2", null, t("about.title"));
    head.id = "about-title";
    dialog.appendChild(head);
    dialog.appendChild(el("p", "sub", t("about.text")));
    dialog.appendChild(el("div", "about-body"));
    var close = el("button", "btn small", t("about.close"));
    close.type = "button";
    close.addEventListener("click", shut);
    var foot = el("div", "about-foot");
    foot.appendChild(close);
    dialog.appendChild(foot);
    // A click on the backdrop (outside the box) closes it too.
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) shut();
    });
    // Escape is handled here: Chrome may skip the dialog's own cancel for a box a script opened.
    dialog.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      shut();
    });
    dialog.addEventListener("close", restoreFocus);
    document.body.appendChild(dialog);
  }

  function restoreFocus() {
    if (returnTo && document.contains(returnTo)) returnTo.focus();
    returnTo = null;
  }

  function shut() {
    if (dialog.open) dialog.close();
    restoreFocus();
  }

  function open(opener) {
    if (!dialog || !document.contains(dialog)) build();
    // Texts follow the current page language each time it opens.
    dialog.querySelector("h2").textContent = t("about.title");
    dialog.querySelector(":scope > .sub").textContent = t("about.text");
    dialog.querySelector(".about-foot button").textContent = t("about.close");
    var body = dialog.querySelector(".about-body");
    body.textContent = "";
    body.appendChild(el("p", "sub", t("about.loading")));
    returnTo = opener || document.activeElement;
    if (!dialog.open) dialog.showModal();
    load().then(
      function (data) {
        render(body, data);
      },
      function () {
        body.textContent = "";
        body.appendChild(el("p", "about-error", t("about.loadFailed")));
      },
    );
  }

  window.BEmeshAbout = { open: open, menuLabel: function () { return t("about.menu"); } };
})();
