/* The account page (account.html, served at /account to a signed-in person): their name, the nodes
 * they own or manage (each a link to it on the map, with its role; an owned node with its managers,
 * Remove, and "Invite a manager" for a one-time link; a managed one with Stop managing), their two
 * privacy choices (saved as soon as they switch one), the partner tools they allowed (each with
 * Remove) and the site's tools that have an account part of their own, from GET /api/v1/account.
 * Log out and Log out everywhere are plain forms in the page. Signed out by now (the session ended
 * in another tab): back through sign-in. */
(function () {
  "use strict";

  var api = {
    /** Leaves the page (replaced in tests). */
    go: function (url) {
      location.replace(url);
    },
    /** Asks before removing a manager or leaving (replaced in tests). */
    confirm: function (text) {
      return window.confirm(text);
    },
    /** Puts text on the clipboard; rejects when the browser won't (replaced in tests). */
    copy: function (text) {
      return navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error("no clipboard"));
    },
    /** Loads the page's data again, after a change (set below). */
    reload: null,
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

  function icon(name) {
    var i = el("i", "bi " + name);
    i.setAttribute("aria-hidden", "true");
    return i;
  }

  function button(cls, text, iconName) {
    var b = el("button", "btn small " + cls);
    b.type = "button";
    if (iconName) b.appendChild(icon(iconName));
    b.appendChild(document.createTextNode(text));
    return b;
  }

  /** Under an owned node: its managers (each with Remove) and "Invite a manager", which makes a
   * one-time link to copy. */
  function ownerTools(t, key, shown, managers) {
    var box = el("div", "account-node-tools");
    var list = (Array.isArray(managers) ? managers : []).filter(function (m) {
      return m && typeof m.id === "number";
    });
    var note = el("p", "account-status");
    note.setAttribute("role", "status");
    if (list.length) {
      box.appendChild(el("p", "account-managers-title muted", t("account.managers")));
      var ul = el("ul", "account-managers");
      list.forEach(function (m) {
        var name = typeof m.name === "string" && m.name.trim() ? m.name : t("account.unnamed");
        var li = el("li");
        li.appendChild(el("span", "account-manager-name", name));
        var remove = button("account-remove", t("account.removeManager"));
        remove.setAttribute("aria-label", t("account.removeManager.label", { name: name }));
        remove.onclick = function () {
          if (!api.confirm(t("account.removeManager.confirm", { name: name, node: shown }))) return;
          remove.disabled = true;
          post("/api/v1/nodes/" + encodeURIComponent(key) + "/managers/" + m.id + "/remove")
            .then(api.reload)
            .catch(function () {
              remove.disabled = false;
              status(note, t("account.actionFailed"), true);
            });
        };
        li.appendChild(remove);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    var inviteBtn = button("account-invite-btn", t("account.invite"), "bi-person-plus");
    var linkBox = el("div", "account-invite");
    linkBox.hidden = true;
    var row = el("div", "account-invite-row");
    var input = el("input", "account-invite-link");
    input.readOnly = true;
    input.setAttribute("aria-label", t("account.inviteLink"));
    var copy = button("account-copy", t("account.copy"), "bi-copy");
    row.appendChild(input);
    row.appendChild(copy);
    linkBox.appendChild(row);
    linkBox.appendChild(el("p", "muted account-invite-hint", t("account.inviteHint")));
    inviteBtn.onclick = function () {
      inviteBtn.disabled = true;
      status(note, "");
      fetch("/api/v1/nodes/" + encodeURIComponent(key) + "/invites", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
        .then(function (r) {
          if (r.status === 429) throw new Error("too_many");
          if (!r.ok) throw new Error("invite " + r.status);
          return r.json();
        })
        .then(function (data) {
          if (!data || typeof data.path !== "string" || data.path.indexOf("/invite/") !== 0) throw new Error("odd answer");
          input.value = location.origin + data.path;
          linkBox.hidden = false;
          input.focus();
          input.select();
        })
        .catch(function (e) {
          status(note, t(e && e.message === "too_many" ? "account.tooManyInvites" : "account.actionFailed"), true);
        })
        .then(function () {
          inviteBtn.disabled = false;
        });
    };
    copy.onclick = function () {
      api.copy(input.value).then(
        function () {
          status(note, t("account.copied"));
        },
        function () {
          input.select();
        },
      );
    };
    box.appendChild(inviteBtn);
    box.appendChild(linkBox);
    box.appendChild(note);
    return box;
  }

  /** Under a managed node: Stop managing. */
  function managerTools(t, key, shown) {
    var box = el("div", "account-node-tools");
    var note = el("p", "account-status");
    note.setAttribute("role", "status");
    var leave = button("account-leave", t("account.leave"), "bi-box-arrow-right");
    leave.onclick = function () {
      if (!api.confirm(t("account.leave.confirm", { node: shown }))) return;
      leave.disabled = true;
      post("/api/v1/nodes/" + encodeURIComponent(key) + "/leave")
        .then(api.reload)
        .catch(function () {
          leave.disabled = false;
          status(note, t("account.actionFailed"), true);
        });
    };
    box.appendChild(leave);
    box.appendChild(note);
    return box;
  }

  function nodeRow(t, node) {
    var key = typeof node.public_key === "string" ? node.public_key : "";
    var name = typeof node.name === "string" && node.name.trim() ? node.name : null;
    var shown = name || t("account.unnamed");
    var role = node.role === "owner" || node.role === "manager" ? node.role : null;
    var li = el("li", role ? "account-node" : null);
    var a = el("a", "account-row");
    a.setAttribute("href", "/?node=" + encodeURIComponent(key));
    a.title = t("account.showOnMap", { name: shown });
    a.appendChild(el("span", "account-row-name", shown));
    var typeKey = "account.type." + node.type;
    var I18N = window.BEmeshI18n;
    if (I18N && I18N.has(typeKey)) a.appendChild(el("span", "muted", t(typeKey)));
    if (role) a.appendChild(el("span", "account-role account-role--" + role, t("account.role." + role)));
    a.appendChild(chevron());
    li.appendChild(a);
    if (role === "owner") li.appendChild(ownerTools(t, key, shown, node.managers));
    if (role === "manager") li.appendChild(managerTools(t, key, shown));
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

  function status(target, text, bad) {
    var p = typeof target === "string" ? byId(target) : target;
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

  /** The partner tools the person allowed to sign them in, each with Remove (after a question). */
  function renderPartners(t, partners) {
    var list = byId("account-partners");
    list.textContent = "";
    (Array.isArray(partners) ? partners : []).forEach(function (p) {
      if (!p || typeof p.key !== "string") return;
      var label = typeof p.label === "string" && p.label.trim() ? p.label : p.key;
      var li = el("li", "account-partner");
      li.appendChild(el("span", "account-row-name", label));
      var remove = button("account-partner-remove", t("account.partnerRemove"));
      remove.setAttribute("aria-label", t("account.partnerRemove.label", { name: label }));
      remove.onclick = function () {
        if (!api.confirm(t("account.partnerRemove.confirm", { name: label }))) return;
        remove.disabled = true;
        post("/api/v1/account/partners/" + encodeURIComponent(p.key) + "/remove")
          .then(api.reload)
          .catch(function () {
            remove.disabled = false;
            status("account-partners-status", t("account.actionFailed"), true);
          });
      };
      li.appendChild(remove);
      list.appendChild(li);
    });
    byId("account-partners-card").hidden = list.children.length === 0;
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
    renderPartners(t, data.partners);
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

  api.reload = function () {
    return load(window.BEmeshI18n);
  };
  api.ready = window.BEmeshI18n.ready.then(load);
  window.BEmeshAccount = api;
})();
