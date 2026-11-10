/* The map's node popup and the site's other tools (GET /api/v1/site-tools): a NodeBook line for a
 * signed-in visitor and "Connect live" in MeshMate for a companion. A site that lists neither tool
 * shows nothing extra. A tool is on a path of this site or on its own address. */
import { isOtherOrigin, isToolUrl } from "./shared/site-urls.js";

const HEX_KEY = /^[0-9a-f]{64}$/i;
const COMPANION = 1;

/** The listed tool with this key whose url (a path on this site or its own address) ends in "/"; null otherwise. */
export function toolByKey(tools, key) {
  const tool = (Array.isArray(tools) ? tools : []).find((x) => x && x.key === key);
  if (!tool || !isToolUrl(tool.url) || !tool.url.endsWith("/")) return null;
  return tool;
}

/** NodeBook's answer for one node: "in" when it is in one of the visitor's fleets, "out" when not, null when unknown. */
export function nodebookState(status, body) {
  if (status !== 200 || !body || typeof body !== "object") return null;
  return Array.isArray(body.fleets) && body.fleets.length > 0 ? "in" : "out";
}

/** Where to ask NodeBook about a node; null when the site has no NodeBook or the key is not a full hex key. */
export function nodebookApiUrl(tools, publicKey) {
  const nb = toolByKey(tools, "nodebook");
  return nb && HEX_KEY.test(publicKey || "") ? `${nb.url}api/nodes/${publicKey.toLowerCase()}` : null;
}

/** How to ask NodeBook: with the visitor's cookies when it is on its own address (it allows the map's origin). */
export function nodebookFetchInit(tools, here) {
  const nb = toolByKey(tools, "nodebook");
  return { credentials: nb && isOtherOrigin(nb.url, here) ? "include" : "same-origin" };
}

/**
 * The popup's tool links as HTML, or "" when there are none.
 * nodebook: "in" | "out" | null (unknown: no NodeBook line yet). t: the page's translator.
 */
export function toolLinksHtml({ tools, node, signedIn, nodebook, t, escape }) {
  const key = node && HEX_KEY.test(node.public_key || "") ? node.public_key.toLowerCase() : null;
  if (!key) return "";
  const links = [];
  const nb = toolByKey(tools, "nodebook");
  if (nb && signedIn && (nodebook === "in" || nodebook === "out")) {
    const text = nodebook === "in" ? t("map.nodebook.in") : t("map.nodebook.add");
    links.push(`<a class="node-popup-action node-popup-action--tool" data-tool="nodebook" href="${escape(`${nb.url}node/${key}`)}">${escape(text)}</a>`);
  }
  const mm = toolByKey(tools, "meshmate");
  if (mm && Number(node.type) === COMPANION) {
    links.push(`<a class="node-popup-action node-popup-action--tool" data-tool="meshmate" href="${escape(`${mm.url}#node=${key}`)}">${escape(t("map.connectLive"))}</a>`);
  }
  return links.length ? `<div class="node-popup__tools">${links.join("")}</div>` : "";
}
