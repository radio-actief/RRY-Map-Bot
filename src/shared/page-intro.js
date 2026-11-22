/* The map's short "what this is" caption ([data-page-intro]): a person may close it, and it stays
 * closed on this device (localStorage). Without storage it simply shows again on the next visit. */
(function () {
  var KEY = "bemesh.intro.closed";
  var box = document.querySelector("[data-page-intro]");
  if (!box) return;
  var page = box.getAttribute("data-page-intro");

  function closedPages() {
    try {
      return (localStorage.getItem(KEY) || "").split(",").filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  if (closedPages().indexOf(page) >= 0) box.hidden = true;
  var close = box.querySelector("[data-page-intro-close]");
  if (!close) return;
  close.addEventListener("click", function () {
    box.hidden = true;
    var pages = closedPages();
    if (pages.indexOf(page) < 0) pages.push(page);
    try {
      localStorage.setItem(KEY, pages.join(","));
    } catch (e) {
      /* storage unavailable: closed for this visit only */
    }
  });
})();
