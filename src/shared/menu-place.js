/* Keeps a menu that opens from the top bar inside the window: it opens right-aligned under its
 * button (bemesh-shell.css) and moves sideways, and gets a lower maximum height, when that would
 * leave the window. Shared by the tool pages (topbar.js) and the configurator (AccountMenu.tsx),
 * which imports this file for its side effect. */
(function (global) {
  /** Space kept between the menu and the window's edge, in CSS px. */
  var MARGIN = 8;

  function place(menu) {
    if (!menu || menu.hidden) return;
    menu.style.right = "";
    menu.style.maxHeight = "";
    var doc = global.document.documentElement;
    var width = doc.clientWidth || global.innerWidth;
    var height = global.innerHeight || doc.clientHeight;
    var r = menu.getBoundingClientRect();
    var shift = 0;
    if (r.right > width - MARGIN) shift = r.right - (width - MARGIN);
    if (r.left - shift < MARGIN) shift = r.left - MARGIN;
    // right: 0 in the style sheet; a positive right moves the menu left, a negative one right.
    if (shift) menu.style.right = shift + "px";
    var room = Math.floor(height - Math.max(r.top, 0) - MARGIN);
    if (room > 0 && r.height > room) menu.style.maxHeight = room + "px";
  }

  global.BEmeshMenu = { place: place, MARGIN: MARGIN };
})(window);
