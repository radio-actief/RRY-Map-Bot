/* Light / dark map tiles for the Leaflet maps. By default the map follows the site theme;
 * a button on the map overrides it (localStorage "bemesh.mapShade": "light" | "dark").
 * window.BEmeshMapShade.attach(L, map, tileLayer, { position }) returns a detach function.
 * The tile layer needs className "osm-tiles"; the filter lives in bemesh-shell.css. */
(function () {
  var KEY = "bemesh.mapShade";

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : null;
    } catch (e) {
      return null;
    }
  }

  function store(v) {
    try {
      if (v) localStorage.setItem(KEY, v);
      else localStorage.removeItem(KEY);
    } catch (e) {
      /* storage unavailable: the choice lasts until the page closes */
    }
  }

  /** The shade the site theme gives. */
  function themeShade() {
    var set = document.documentElement.getAttribute("data-theme");
    if (set) return set === "dark" ? "dark" : "light";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  /** The shade to show: the stored choice, else the theme's. */
  function shade() {
    return stored() || themeShade();
  }

  function attach(L, map, tileLayer, opts) {
    opts = opts || {};
    var container = map.getContainer();
    var override = stored;
    var link;
    var control = L.control({ position: opts.position || "topleft" });

    function render() {
      var now = shade();
      container.classList.toggle("map-dark", now === "dark");
      if (!link) return;
      var follows = !override();
      var label = (now === "dark" ? "Light map" : "Dark map") + (follows ? " (follows the theme)" : "");
      link.textContent = now === "dark" ? "☀" : "☾";
      link.setAttribute("aria-label", label);
      link.title = label;
    }

    control.onAdd = function () {
      var bar = L.DomUtil.create("div", "leaflet-bar leaflet-control map-shade-control");
      link = L.DomUtil.create("a", "map-shade-button", bar);
      link.href = "#";
      link.setAttribute("role", "button");
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(link, "click", function (e) {
        L.DomEvent.preventDefault(e);
        var next = shade() === "dark" ? "light" : "dark";
        store(next === themeShade() ? null : next);
        render();
      });
      render();
      return bar;
    };

    var timer;
    function changed() {
      clearTimeout(timer);
      timer = setTimeout(render, 0);
    }
    var observer = new MutationObserver(changed);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) mq.addEventListener("change", changed);

    control.addTo(map);
    render();

    return function detach() {
      clearTimeout(timer);
      observer.disconnect();
      if (mq && mq.removeEventListener) mq.removeEventListener("change", changed);
      control.remove();
      container.classList.remove("map-dark");
    };
  }

  window.BEmeshMapShade = { attach: attach, shade: shade, themeShade: themeShade };
})();
