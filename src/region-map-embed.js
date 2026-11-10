/* Region map in a frame (or with ?embed=1): the embed layout, set before the page draws. */
(function () {
  var q = new URLSearchParams(window.location.search || "");
  var ev = (q.get("embed") || "").toLowerCase();
  var embedParam = ev === "1" || ev === "true" || (q.has("embed") && ev === "");
  var inFrame = false;
  try {
    inFrame = window.self !== window.top;
  } catch (e) {
    inFrame = true;
  }
  if (embedParam || inFrame) {
    document.documentElement.classList.add("region-map-embed");
  }
})();
