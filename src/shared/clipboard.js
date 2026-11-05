/* Copy text to the clipboard, shared by the map and the configurator.
 *
 * navigator.clipboard only exists on secure pages (https, localhost). On a plain http page, such as
 * a LAN address, or when the browser refuses it, the text is copied from a selected, off-screen
 * textarea instead. Call it straight from the click: browsers only allow that fallback during the
 * user's own action. Resolves true only when the copy really happened. */

/** The textarea fallback: synchronous, so it runs inside the click that asked for it. */
function copyBySelection(text) {
  const active = document.activeElement;
  const selection = document.getSelection();
  const ranges = [];
  for (let i = 0; selection && i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i));

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  // 16px: iOS zooms in on focus of smaller text. Fixed at the top, so the page doesn't scroll.
  area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px";
  document.body.appendChild(area);
  area.focus({ preventScroll: true });
  area.select();
  area.setSelectionRange(0, text.length); // iOS ignores select() on its own
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();

  if (selection) {
    selection.removeAllRanges();
    ranges.forEach((r) => selection.addRange(r));
  }
  if (active && typeof active.focus === "function") active.focus({ preventScroll: true });
  return ok;
}

/**
 * Copies text; resolves true when it is on the clipboard, false when the browser refused.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export function copyText(text) {
  const value = String(text ?? "");
  const api = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!api || typeof api.writeText !== "function") return Promise.resolve(copyBySelection(value));
  return api.writeText(value).then(
    () => true,
    () => copyBySelection(value),
  );
}
