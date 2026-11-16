import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module of the map page
import { coordsFallbackHtml, ownerHtml, typeLabelHtml } from "../../../src/popup-safe.js";

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
