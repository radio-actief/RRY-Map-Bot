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

const FULL_KEY = /^[0-9a-f]{64}$/i;

/**
 * The popup's coverage and profile actions for a node: "Show coverage" for a repeater, and "Profile
 * from here" or, once a profile has its start, "Profile to here" (not on the start itself while the
 * profile waits for its other end). `profile` is { a, b } with { publicKey } or { lat, lon } ends.
 * Only a full hex key goes into the data attributes; anything else gets no actions.
 */
export function planningActionsHtml(node, profile, t) {
  const raw = String(node?.public_key ?? "");
  if (!FULL_KEY.test(raw)) return "";
  const key = raw.toLowerCase();
  const actions = [];
  if (Number(node.type) === 2) {
    actions.push(
      `<button type="button" class="node-popup-plan node-popup-plan--coverage" data-plan-action="coverage" data-public-key="${key}">` +
        `<i class="bi bi-broadcast" aria-hidden="true"></i>${escapeHtml(t("map.plan.showCoverage"))}</button>`,
    );
  }
  const a = profile?.a ?? null;
  const waitingHere = a?.publicKey === key && !profile?.b;
  if (!waitingHere) {
    const to = Boolean(a);
    actions.push(
      `<button type="button" class="node-popup-plan node-popup-plan--profile" data-plan-action="${to ? "profile-to" : "profile-from"}" data-public-key="${key}">` +
        `<i class="bi bi-graph-up" aria-hidden="true"></i>${escapeHtml(t(to ? "map.plan.profileTo" : "map.plan.profileFrom"))}</button>`,
    );
  }
  return `<div class="node-popup-plan-row">${actions.join("")}</div>`;
}
