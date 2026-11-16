/* "You're logged out.": the short word a map page shows after a log out. The map sends the person
 * back with ?logout=success (Log out) or ?logout=everywhere (Log out everywhere); run() shows it
 * as a snackbar on ink at the bottom for 6 s (role=status, read out by screen readers) and takes
 * the parameter out of the address, so a reload or a shared link doesn't say it again.
 * The tool pages call run() from src/shared/topbar.js once their texts are there; the configurator
 * imports this file and calls it from AccountMenu.tsx. A listed tool on its own address gets no
 * parameter: it says so itself. */
(function () {
  var KEYS = { success: "logout.done", everywhere: "logout.everywhere" };
  var FALLBACK = { "logout.done": "You're logged out.", "logout.everywhere": "You're logged out everywhere." };
  var SHOW_MS = 6000;
  var timer = 0;

  function text(key) {
    var i18n = window.BEmeshI18n;
    return i18n && i18n.has(key) ? i18n.t(key) : FALLBACK[key];
  }

  /** The kind of log out the address names (success / everywhere), taken out of the address; else null. */
  function take() {
    var url;
    try {
      url = new URL(window.location.href);
    } catch (e) {
      return null;
    }
    if (!url.searchParams.has("logout")) return null;
    var kind = url.searchParams.get("logout");
    url.searchParams.delete("logout");
    try {
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch (e) {
      /* no history: the word still shows */
    }
    return Object.prototype.hasOwnProperty.call(KEYS, kind) ? kind : null;
  }

  /** Shows a short word at the bottom of the page for SHOW_MS. */
  function show(message) {
    var bar = document.querySelector(".bemesh-toast");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "bemesh-toast";
      bar.setAttribute("role", "status");
      document.body.appendChild(bar);
    }
    bar.textContent = "";
    var icon = document.createElement("i");
    icon.className = "bi bi-box-arrow-right";
    icon.setAttribute("aria-hidden", "true");
    var span = document.createElement("span");
    span.textContent = message;
    bar.appendChild(icon);
    bar.appendChild(span);
    bar.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(function () {
      bar.hidden = true;
    }, SHOW_MS);
    return bar;
  }

  /** After a log out (?logout= in the address): the word, and the address without it. Returns the text shown, or null. */
  function run() {
    var kind = take();
    if (!kind) return null;
    var message = text(KEYS[kind]);
    show(message);
    return message;
  }

  window.BEmeshLogoutNotice = { run: run, show: show, SHOW_MS: SHOW_MS };
})();
