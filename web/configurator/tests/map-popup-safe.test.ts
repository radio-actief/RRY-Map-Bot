import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module of the map page
import { coordsFallbackHtml, isClaimed, ownerBlockHtml, ownerHtml, typeLabelHtml } from "../../../src/popup-safe.js";

const EVIL = `"><img src=x onerror=alert(1)><a href="javascript:x">`;
const t = (k: string, o?: Record<string, unknown>) => (k === "map.sendDm" ? `Send ${o?.name} a message` : k);
const parse = (html: string) => new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body.firstElementChild!;

describe("the map popup's cells from stored text", () => {
  it("shows an owner name as text, with a DM link only for a numeric Discord id", () => {
    const el = parse(ownerHtml(EVIL, "123456789012345678", t));
    expect(el.querySelectorAll("img").length).toBe(0);
    expect(el.textContent).toBe(`@${EVIL}`);
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://discord.com/users/123456789012345678");
    const odd = parse(ownerHtml("ann", `1" onclick="x`, t));
    expect(odd.querySelector("a")).toBeNull();
    expect(odd.textContent).toBe("@ann");
  });

  it("says a node is claimed from the list's flag, also without a name", () => {
    expect(isClaimed({ claimed: true, discord_owner_name: null })).toBe(true);
    expect(isClaimed({ claimed: false })).toBe(false);
    // An older answer without the flag: a name or an id means claimed.
    expect(isClaimed({ discord_owner_name: "ann" })).toBe(true);
    expect(isClaimed({ discord_owner_name: " " })).toBe(false);
  });

  it("the owner block names the owner, linked only for a Discord id", () => {
    const tt = (k: string) => ({ "map.claimedBy": "Claimed by", "map.claimed": "Claimed", "map.dmOwner": "Message", "map.ownerNameHidden": "Name not shown" })[k] ?? k;
    const named = parse(ownerBlockHtml({ claimed: true, discord_owner_name: EVIL }, "123456789012345678", tt));
    expect(named.querySelectorAll("img").length).toBe(0);
    expect(named.querySelector(".node-popup__panel-kicker")!.textContent).toBe("Claimed by");
    expect(named.querySelector("a")!.getAttribute("href")).toBe("https://discord.com/users/123456789012345678");
    expect(named.querySelector("a")!.textContent).toBe(`@${EVIL}`);
    const noLink = parse(ownerBlockHtml({ claimed: true, discord_owner_name: "ann" }, undefined, tt));
    expect(noLink.querySelector("a")).toBeNull();
    expect(noLink.querySelector(".node-popup__panel-body")!.textContent).toBe("@ann");
  });

  it("an owner who keeps their name private shows as Claimed, without a name or a link", () => {
    const tt = (k: string) => ({ "map.claimedBy": "Claimed by", "map.claimed": "Claimed", "map.ownerNameHidden": "Name not shown" })[k] ?? k;
    const hidden = parse(ownerBlockHtml({ claimed: true, discord_owner_name: null }, "123456789012345678", tt));
    expect(hidden.querySelector(".node-popup__panel-kicker")!.textContent).toBe("Claimed");
    expect(hidden.querySelector(".node-popup__panel-body")!.textContent).toBe("Name not shown");
    expect(hidden.querySelector("a")).toBeNull();
    expect(ownerBlockHtml({ claimed: false, discord_owner_name: null }, null, tt)).toBe("");
  });

  it("keeps odd coordinate text as text and links only to a plain search", () => {
    const el = parse(coordsFallbackHtml(EVIL));
    expect(el.querySelectorAll("img").length).toBe(0);
    const a = el.querySelector("a")!;
    expect(a.textContent).toBe(EVIL);
    expect(a.getAttribute("href")).toBe(`https://www.google.com/maps/place/${encodeURIComponent(EVIL.replace(/\s/g, ""))}`);
  });

  it("shows a node type as text", () => {
    const el = parse(typeLabelHtml(EVIL, (k: string) => k));
    expect(el.querySelectorAll("img").length).toBe(0);
    expect(el.textContent).toBe(`map.type.${EVIL}`);
  });
});
