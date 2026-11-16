/* Map popup cells built from stored text (owner names, odd coordinate text, node types): every
 * value is escaped, and links are only made from values of a known shape. */

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** "@name", linked to the owner's Discord profile only when the owner id is a Discord id (digits). */
export function ownerHtml(name, ownerId, t) {
  const label = `@${escapeHtml(name)}`;
  if (!/^\d{1,20}$/.test(String(ownerId ?? ""))) return label;
  const title = escapeHtml(t("map.sendDm", { name }));
  return `<a href="https://discord.com/users/${ownerId}" target="_blank" rel="noopener noreferrer" title="${title}">${label}</a>`;
}

/** Coordinate text that isn't "lat, lon": shown as text, linked to a map search for it. */
export function coordsFallbackHtml(value) {
  const compact = String(value ?? "").replace(/\s/g, "");
  return `<a target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/place/${escapeHtml(
    encodeURIComponent(compact),
  )}">${escapeHtml(value ?? "")}</a>`;
}

/** The node type's name, as text. */
export function typeLabelHtml(type, t) {
  return escapeHtml(t(`map.type.${type}`));
}
