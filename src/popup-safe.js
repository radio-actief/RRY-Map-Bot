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

/** Whether someone claimed the node. The node list says so in `claimed`, also when the owner keeps
 * their name private; older answers only had the owner's name and id. */
export function isClaimed(node) {
  if (typeof node?.claimed === "boolean") return node.claimed;
  return Boolean(String(node?.discord_owner_name ?? "").trim() || String(node?.discord_owner_id ?? "").trim());
}

/**
 * The popup's owner block: "Claimed by @name", the name linked to a Discord message only when
 * `ownerId` is a Discord id (digits); "Claimed" without a name or link when the owner keeps their
 * name private; nothing for an unclaimed node.
 */
export function ownerBlockHtml(node, ownerId, t) {
  if (!isClaimed(node)) return "";
  const name = String(node?.discord_owner_name ?? "").trim();
  let kicker = t("map.claimedBy");
  let body;
  if (!name) {
    kicker = t("map.claimed");
    body = `<span class="node-popup__discord-user node-popup__discord-user--hidden">${escapeHtml(t("map.ownerNameHidden"))}</span>`;
  } else if (/^\d{1,20}$/.test(String(ownerId ?? ""))) {
    const dm = escapeHtml(t("map.dmOwner"));
    body = `<a class="node-popup__discord-user" href="https://discord.com/users/${ownerId}" target="_blank" rel="noopener noreferrer" title="${dm}" aria-label="${dm}">@${escapeHtml(name)}</a>`;
  } else {
    body = `<span class="node-popup__discord-user node-popup__discord-user--bare">@${escapeHtml(name)}</span>`;
  }
  return (
    `<div class="node-popup__panel-block node-popup__panel-block--owner">` +
    `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon node-popup__panel-icon--discord" aria-hidden="true"><i class="bi bi-shield-check" aria-hidden="true"></i></span><span>${escapeHtml(kicker)}</span></div>` +
    `<div class="node-popup__panel-body">${body}</div></div>`
  );
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
