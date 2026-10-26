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

  function label() {
    var text = LABEL[current];
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.setAttribute("aria-label", text);
      b.title = text;
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
  document.addEventListener("DOMContentLoaded", function () {
    label();
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.addEventListener("click", next);
    });
  });
})();
