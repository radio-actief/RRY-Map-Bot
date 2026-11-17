/* The account page (account.html, served at /account to a signed-in person): their name, the nodes
 * they claimed on the map (each a link to it on the map), their two privacy choices (saved as soon
 * as they switch one) and the site's tools that have an account part of their own, from
 * GET /api/v1/account. Log out and Log out everywhere are plain forms in the page. Signed out by now
 * (the session ended in another tab): back through sign-in. */
(function () {
  "use strict";

  var api = {
    /** Leaves the page (replaced in tests). */
    go: function (url) {
      location.replace(url);
    },
    ready: null,
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /** The row's "go there" mark: a Bootstrap icon, hidden from screen readers. */
  function chevron() {
    var i = el("i", "bi bi-chevron-right account-row-go");
    i.setAttribute("aria-hidden", "true");
    return i;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function nodeRow(t, node) {
    var key = typeof node.public_key === "string" ? node.public_key : "";
    var name = typeof node.name === "string" && node.name.trim() ? node.name : null;
    var shown = name || t("account.unnamed");
    var li = el("li");
    var a = el("a", "account-row");
    a.setAttribute("href", "/?node=" + encodeURIComponent(key));
    a.title = t("account.showOnMap", { name: shown });
    a.appendChild(el("span", "account-row-name", shown));
    var typeKey = "account.type." + node.type;
    var I18N = window.BEmeshI18n;
    if (I18N && I18N.has(typeKey)) a.appendChild(el("span", "muted", t(typeKey)));
    a.appendChild(chevron());
    li.appendChild(a);
    return li;
  }

  function toolRow(t, tool) {
    var li = el("li");
    var key = "account." + tool.key;
    var I18N = window.BEmeshI18n;
    var a = el("a", "account-row");
    a.appendChild(el("span", "account-row-name", I18N && I18N.has(key) ? t(key) : String(tool.label || tool.key)));
    a.setAttribute("href", tool.url);
    a.appendChild(chevron());
    li.appendChild(a);
    return li;
  }

  /** POSTs JSON to one of the account's own endpoints; resolves to the answer's JSON, or rejects. */
  function post(url, body) {
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      if (r.status === 401) {
        api.go("/auth/login?next=/account");
        throw new Error("signed out");
      }
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    });
  }

  function status(id, text, bad) {
    var p = byId(id);
    if (!p) return;
    p.textContent = text || "";
    p.classList.toggle("bad", Boolean(bad));
  }

  /** The two privacy choices: each switch saves at once; a failed save puts it back and says so. */
  function renderChoices(t, settings) {
    var card = byId("account-privacy");
    if (!settings || typeof settings !== "object") {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    Array.prototype.forEach.call(card.querySelectorAll("input[data-choice]"), function (input) {
      var name = input.getAttribute("data-choice");
      input.checked = settings[name] !== false;
      input.onchange = function () {
        var wanted = input.checked;
        var body = {};
        body[name] = wanted;
        input.disabled = true;
        status("account-choice-status", "");
        post("/api/v1/account/settings", body)
          .then(function () {
            status("account-choice-status", t("account.saved"));
          })
          .catch(function () {
            input.checked = !wanted;
            status("account-choice-status", t("account.saveFailed"), true);
          })
          .then(function () {
            input.disabled = false;
          });
      };
    });
  }

  function render(t, data) {
    var name = byId("account-name");
    name.textContent = typeof data.name === "string" ? data.name : "";
    var nodes = Array.isArray(data.nodes) ? data.nodes : [];
    var list = byId("account-nodes");
    list.textContent = "";
    nodes.forEach(function (n) {
      if (n && typeof n === "object") list.appendChild(nodeRow(t, n));
    });
    list.hidden = list.children.length === 0;
    byId("account-nodes-empty").hidden = list.children.length > 0;
    renderChoices(t, data.settings);
    var tools = (Array.isArray(data.tools) ? data.tools : []).filter(function (x) {
      // A path on this site or https only: never a javascript: or other odd address.
      return x && typeof x.url === "string" && /^(\/(?![/\\])|https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(x.url);
    });
    var toolList = byId("account-tools");
    toolList.textContent = "";
    tools.forEach(function (x) {
      toolList.appendChild(toolRow(t, x));
    });
    byId("account-tools-card").hidden = tools.length === 0;
    // Arrived through "My nodes" (/account#my-nodes): the list is there now.
    if (location.hash === "#my-nodes") {
      var target = byId("my-nodes");
      if (target && target.scrollIntoView) target.scrollIntoView();
    }
  }

  function failed(t) {
    var name = byId("account-name");
    name.textContent = "";
    name.appendChild(el("span", "muted", t("account.failed")));
  }

  function load(I18N) {
    var t = I18N.t;
    return fetch("/api/v1/account", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) {
        if (r.status === 401) {
          api.go("/auth/login?next=/account");
          return null;
        }
        if (!r.ok) throw new Error("account " + r.status);
        return r.json();
      })
      .then(function (data) {
        if (data) render(t, data);
      })
      .catch(function () {
        failed(t);
      });
  }

  api.ready = window.BEmeshI18n.ready.then(load);
  window.BEmeshAccount = api;
})();
