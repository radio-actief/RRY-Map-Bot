/* After the on-screen keyboard closes, put full-height pages (map, configurator) back as they were.
 *
 * iOS may leave the page scrolled after a field had focus, so the page no longer fills the screen,
 * and the map keeps the size it had with the keyboard open. On every visual viewport change this
 * calls onResize (the page re-measures its map); once the keyboard has closed and the page is
 * still shifted, it scrolls back to the top. Returns a function that stops listening. */

/**
 * @param {() => void} onResize
 * @returns {() => void}
 */
export function settleAfterKeyboard(onResize) {
  const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
  if (!vv) return () => {};
  let last = vv.height;
  const handler = () => {
    const opened = vv.height < last;
    last = vv.height;
    onResize();
    const closed = !opened && vv.height >= window.innerHeight - 2;
    if (closed && (window.scrollY || window.scrollX)) window.scrollTo(0, 0);
  };
  vv.addEventListener("resize", handler);
  return () => vv.removeEventListener("resize", handler);
}
