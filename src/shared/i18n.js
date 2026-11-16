/* Site translations (English, Nederlands, Français) for the tool pages and the configurator: the
 * language choice, message lookup with English fallback, plurals and Intl formatting.
 *
 * Tool pages load it in <head> as <script src="./src/shared/i18n.js" data-i18n-page="<page>">: it fetches
 * src/shared/i18n/shared.<lang>.json and <page>.<lang>.json (plus English for fallback), translates
 * [data-i18n], [data-i18n-html] and [data-i18n-attr] in the page and then resolves BEmeshI18n.ready.
 * The configurator imports this file and adds its own messages (web/configurator/src/i18n/t.ts).
 *
 * The language, the same way in every tool of the site: ?lang=en|nl|fr (that page only), else the choice
 * the site's tools share (cookie bemesh_lang), else the first of the browser's languages the site has
 * (nl-BE → nl), else English. Only a person picking a language saves it: the map sets the shared
 * cookie (POST /api/v1/lang). No cookie means the browser decides, also after a tool removed it. */
(function (global) {
  "use strict";

  var LANGS = ["en", "nl", "fr"];
  /** Where the pages kept their own choice before the shared cookie; cleared, never read. */
  var STORE_KEY = "bemesh.lang";
  var COOKIE = "bemesh_lang";
  /** Intl locale per page language. */
  var LOCALES = { en: "en-GB", nl: "nl-BE", fr: "fr-FR" };
  /** Value of <html lang> per page language. */
  var HTML_LANG = { en: "en", nl: "nl-BE", fr: "fr-FR" };
  /** Each language's own name, for the switch. */
  var NAMES = { en: "English", nl: "Nederlands", fr: "Français" };

  /**
   * Official French names of the 19 Brussels municipalities, keyed by the Dutch name the data
   * holds (gemeente / plaats, and the node cities from the API). Brussels municipalities are the
   * only ones with official names in both languages; every other place keeps its one official name.
   */
  var BRUSSELS_FR = {
    Anderlecht: "Anderlecht",
    Oudergem: "Auderghem",
    "Sint-Agatha-Berchem": "Berchem-Sainte-Agathe",
    Brussel: "Bruxelles",
    Etterbeek: "Etterbeek",
    Evere: "Evere",
    Vorst: "Forest",
    Ganshoren: "Ganshoren",
    Elsene: "Ixelles",
    Jette: "Jette",
    Koekelberg: "Koekelberg",
    "Sint-Jans-Molenbeek": "Molenbeek-Saint-Jean",
    "Sint-Gillis": "Saint-Gilles",
    "Sint-Joost-ten-Node": "Saint-Josse-ten-Noode",
    Schaarbeek: "Schaerbeek",
    Ukkel: "Uccle",
    "Watermaal-Bosvoorde": "Watermael-Boitsfort",
    "Sint-Lambrechts-Woluwe": "Woluwe-Saint-Lambert",
    "Sint-Pieters-Woluwe": "Woluwe-Saint-Pierre",
  };

  function normalize(code) {
    var c = code == null ? "" : String(code).trim().toLowerCase();
    return LANGS.indexOf(c) >= 0 ? c : null;
  }

  /** The first of the browser's language tags the site has (nl-BE → nl, fr_CA → fr), else null. */
  function fromBrowser(tags) {
    var list = Array.isArray(tags) ? tags : [tags];
    for (var i = 0; i < list.length; i++) {
      var l = normalize(String(list[i] || "").split(/[-_]/)[0]);
      if (l) return l;
    }
    return null;
  }

  /** The language without side effects: a valid ?lang, the shared choice, the browser's languages, English. */
  function pick(opts) {
    var o = opts || {};
    return { lang: normalize(o.query) || normalize(o.cookie) || fromBrowser(o.browser) || "en" };
  }

  function readQuery() {
    try {
      return new URLSearchParams(global.location.search).get("lang");
    } catch (e) {
      return null;
    }
  }

  function forgetStored() {
    try {
      global.localStorage.removeItem(STORE_KEY);
    } catch (e) {
      /* storage unavailable: nothing kept there */
    }
  }

  /** The shared choice: the first valid bemesh_lang cookie this page can see. */
  function readCookie() {
    try {
      var parts = String(global.document.cookie || "").split(";");
      for (var i = 0; i < parts.length; i++) {
        var eq = parts[i].indexOf("=");
        if (eq < 0 || parts[i].slice(0, eq).trim() !== COOKIE) continue;
        var l = normalize(parts[i].slice(eq + 1));
        if (l) return l;
      }
    } catch (e) {
      /* no document or cookies blocked */
    }
    return null;
  }

  function browserLangs() {
    var n = global.navigator || {};
    if (n.languages && n.languages.length) return Array.prototype.slice.call(n.languages);
    return n.language ? [n.language] : [];
  }

  /** The page language from ?lang, the shared choice and the browser. Saves nothing. */
  function detect() {
    forgetStored();
    return pick({ query: readQuery(), cookie: readCookie(), browser: browserLangs() }).lang;
  }

  /** Asks the map to save the choice for all the site's tools; resolves to whether it did. */
  function save(lang) {
    try {
      return global
        .fetch("/api/v1/lang", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lang: lang }),
        })
        .then(
          function (r) {
            return r.ok;
          },
          function () {
            return false;
          },
        );
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function isDevHost() {
    try {
      var h = global.location.hostname;
      return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || /\.(localhost|test)$/.test(h);
    } catch (e) {
      return false;
    }
  }

  var messages = { en: {}, nl: {}, fr: {} };
  var rulesCache = {};
  var warned = {};
  var listeners = [];

  function rules(lang) {
    if (!rulesCache[lang]) rulesCache[lang] = new Intl.PluralRules(LOCALES[lang]);
    return rulesCache[lang];
  }

  function find(lang, key, count) {
    var d = messages[lang];
    if (!d) return undefined;
    if (count != null) {
      var v = d[key + "_" + rules(lang).select(count)];
      if (v != null) return v;
      if (d[key + "_other"] != null) return d[key + "_other"];
    }
    return d[key];
  }

  function warn(key, lang) {
    if (!api.dev || warned[lang + ":" + key]) return;
    warned[lang + ":" + key] = true;
    console.warn("Missing translation" + (lang === "en" ? "" : " (" + lang + ")") + ": " + key);
  }

  function interpolate(text, params) {
    return text.replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m;
    });
  }

  /**
   * Translate a key into the page language. `{name}` takes params.name; with a numeric
   * params.count the plural form key_<one|few|many|other> of that language is used. A key the
   * language lacks falls back to English (with a warning in development), then to the key itself.
   */
  function t(key, params) {
    var count = params && typeof params.count === "number" ? params.count : null;
    var text = find(api.lang, key, count);
    if (text == null) {
      warn(key, api.lang);
      if (api.lang !== "en") text = find("en", key, count);
      if (text == null) {
        if (api.lang !== "en") warn(key, "en");
        return key;
      }
    }
    return params ? interpolate(text, params) : text;
  }

  /** A key's text in a given language without fallback, or undefined (that language may not be loaded). */
  function textIn(lang, key) {
    return messages[lang] ? messages[lang][key] : undefined;
  }

  /** Whether the page language (or English) has this key. */
  function has(key) {
    return messages[api.lang][key] != null || messages.en[key] != null;
  }

  function add(lang, dict) {
    if (!messages[lang]) return;
    for (var k in dict) {
      if (Object.prototype.hasOwnProperty.call(dict, k)) messages[lang][k] = dict[k];
    }
  }

  function locale() {
    return LOCALES[api.lang];
  }

  /** A number in the page language (Intl.NumberFormat options optional). */
  function number(n, opts) {
    return new Intl.NumberFormat(locale(), opts).format(n);
  }

  /** A date in the page language (Intl.DateTimeFormat options optional). */
  function date(d, opts) {
    return new Intl.DateTimeFormat(locale(), opts).format(d instanceof Date ? d : new Date(d));
  }

  /** Province, gewest or country name for a region code in the page language; the code itself when unknown. */
  function regionName(code) {
    var c = String(code || "");
    var key = /^be-(vlg|wal)$/.test(c) ? "gewest." + c : /^be-/.test(c) ? "province." + c : "region.name." + c;
    return has(key) ? t(key) : c;
  }

  /** A municipality in the page language where it has an official name in that language. */
  function municipalityName(name) {
    var n = name == null ? "" : String(name);
    if (api.lang === "fr" && Object.prototype.hasOwnProperty.call(BRUSSELS_FR, n)) return BRUSSELS_FR[n];
    return n;
  }

  /** Switches the page language now (messages for it must be added first) and tells the listeners. */
  function use(lang) {
    var l = normalize(lang);
    if (!l) return;
    api.lang = l;
    if (global.document && global.document.documentElement) {
      global.document.documentElement.lang = HTML_LANG[l];
    }
    listeners.slice().forEach(function (fn) {
      fn(l);
    });
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (x) {
        return x !== fn;
      });
    };
  }

  /**
   * The visitor picks a language: save it for all the site's tools, keep a ?lang in the address in
   * step, then api.switchTo (the configurator re-renders) or a reload once it is saved (the tool
   * pages). When it can't be saved, the page reloads with ?lang so the pick still holds here.
   */
  function choose(lang) {
    var l = normalize(lang);
    if (!l) return;
    forgetStored();
    var saved = save(l);
    var url = null;
    try {
      url = new URL(global.location.href);
      if (url.searchParams.has("lang")) {
        url.searchParams.set("lang", l);
        global.history.replaceState(global.history.state, "", url.toString());
      }
    } catch (e) {
      /* no history: the saved choice still applies */
    }
    if (l === api.lang) return;
    if (api.switchTo) {
      api.switchTo(l);
      return;
    }
    saved.then(function (ok) {
      if (ok || !url) {
        global.location.reload();
        return;
      }
      url.searchParams.set("lang", l);
      global.location.replace(url.toString());
    });
  }

  /**
   * Translates the static text of a page: [data-i18n] text, [data-i18n-html] markup (our own messages
   * only), [data-i18n-attr] "attr:key; attr:key"; [data-i18n-args] holds JSON {placeholder: value}.
   */
  function apply(root) {
    var r = root || global.document;
    var args = function (el) {
      var raw = el.getAttribute("data-i18n-args");
      if (!raw) return undefined;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return undefined;
      }
    };
    r.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"), args(el));
    });
    r.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"), args(el));
    });
    r.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr")
        .split(";")
        .forEach(function (pair) {
          var i = pair.indexOf(":");
          if (i < 0) return;
          var attr = pair.slice(0, i).trim();
          var key = pair.slice(i + 1).trim();
          if (attr && key) el.setAttribute(attr, t(key));
        });
    });
  }

  var api = {
    LANGS: LANGS,
    NAMES: NAMES,
    STORE_KEY: STORE_KEY,
    COOKIE: COOKIE,
    lang: "en",
    dev: isDevHost(),
    pick: pick,
    fromBrowser: fromBrowser,
    detect: detect,
    t: t,
    has: has,
    textIn: textIn,
    add: add,
    use: use,
    onChange: onChange,
    choose: choose,
    switchTo: null,
    apply: apply,
    locale: locale,
    number: number,
    date: date,
    regionName: regionName,
    municipalityName: municipalityName,
    ready: null,
  };

  api.lang = detect();
  if (global.document && global.document.documentElement) {
    global.document.documentElement.lang = HTML_LANG[api.lang];
  }

  /* A tool page: fetch its messages and translate the page once both it and the DOM are there. */
  var script = global.document && global.document.currentScript;
  var page = script && script.getAttribute("data-i18n-page");
  if (page) {
    var root = global.document.documentElement;
    var base = new URL("i18n/", script.src).href;
    var pending = api.lang !== "en";
    if (pending) {
      root.classList.add("i18n-pending");
      var style = global.document.createElement("style");
      style.textContent = "html.i18n-pending body{visibility:hidden}";
      global.document.head.appendChild(style);
    }
    var reveal = function () {
      root.classList.remove("i18n-pending");
    };
    if (pending) setTimeout(reveal, 3000);
    var wanted = api.lang === "en" ? ["en"] : ["en", api.lang];
    var files = [];
    wanted.forEach(function (l) {
      ["shared", page].forEach(function (name) {
        files.push(
          fetch(base + name + "." + l + ".json")
            .then(function (r) {
              return r.ok ? r.json() : {};
            })
            .catch(function () {
              return {};
            })
            .then(function (dict) {
              add(l, dict);
            }),
        );
      });
    });
    var domReady = new Promise(function (resolve) {
      if (global.document.readyState === "loading") {
        global.document.addEventListener("DOMContentLoaded", resolve);
      } else resolve();
    });
    api.ready = Promise.all(files.concat([domReady])).then(function () {
      apply(global.document);
      reveal();
      return api;
    });
  } else {
    api.ready = Promise.resolve(api);
  }

  global.BEmeshI18n = api;
})(window);
