/* Light / dark / system theme for the tool pages, shared with the configurator's choice.
 * Load it in <head> so the theme is set before the page paints. */
(function () {
  var KEY = "configurator.theme";
  var NEXT = { system: "light", light: "dark", dark: "system" };
  var LABEL = { system: "Theme: follows the system", light: "Theme: light", dark: "Theme: dark" };

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : "system";
    } catch (e) {
      return "system";
    }
  }

  var current = read();

  /** "Theme: light" in the page language once src/shared/i18n.js has its messages, English before that. */
  function text() {
    var i18n = window.BEmeshI18n;
    if (i18n && i18n.has("top.theme")) return i18n.t("top.theme", { theme: i18n.t("theme." + current) });
    return LABEL[current];
  }

  function label() {
    var text_ = text();
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.setAttribute("aria-label", text_);
      b.title = text_;
    });
  }

  function apply() {
    current = read();
    show(current);
  }

  function show(theme) {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }

  function next() {
    current = NEXT[current];
    try {
      localStorage.setItem(KEY, current);
    } catch (e) {
      /* storage unavailable: the choice lasts until the page closes */
    }
    show(current);
    label();
    return current;
  }

  /** True when the page currently shows the dark theme. */
  function isDark() {
    var set = document.documentElement.getAttribute("data-theme");
    if (set) return set === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  window.BEmeshTheme = { apply: apply, next: next, isDark: isDark };
  apply();
  // One listener on the document: the map page's Vue template replaces its ◐ button after the
  // page's translations have loaded, so a listener on the first button would be lost.
  document.addEventListener("click", function (e) {
    if (e.target && e.target.closest && e.target.closest("[data-theme-toggle]")) next();
  });
  document.addEventListener("DOMContentLoaded", function () {
    label();
    if (window.BEmeshI18n && window.BEmeshI18n.ready) {
      window.BEmeshI18n.ready.then(function () {
        setTimeout(label, 0);
      });
    }
  });
})();
