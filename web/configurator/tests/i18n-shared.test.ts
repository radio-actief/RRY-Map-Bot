import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { anchorFromChoice, policyFor, relabelPolicy } from "../src/core/regions";
import { locationChoices, type Place } from "../src/core/search";
import { I18N, setLang, t } from "../src/i18n/t";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(__dirname, "../../../data/be-locode.json"), "utf8"));

afterEach(async () => {
  await setLang("en");
  localStorage.clear();
  document.cookie = "bemesh_lang=; Path=/; Max-Age=0";
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("language choice", () => {
  it("follows the browser's languages on a first visit: the first one the site has, else English", () => {
    expect(I18N.pick({ browser: ["nl-BE"] }).lang).toBe("nl");
    expect(I18N.pick({ browser: ["nl"] }).lang).toBe("nl");
    expect(I18N.pick({ browser: ["fr-CA"] }).lang).toBe("fr");
    expect(I18N.pick({ browser: ["en-US", "nl-BE"] }).lang).toBe("en");
    // A browser set to German first, Dutch second, gets Dutch.
    expect(I18N.pick({ browser: ["de-DE", "nl-BE", "en"] }).lang).toBe("nl");
    expect(I18N.pick({ browser: ["de-DE", "es"] }).lang).toBe("en");
    expect(I18N.pick({ browser: ["FR_be"] }).lang).toBe("fr");
    expect(I18N.pick({ browser: ["nld"] }).lang).toBe("en");
    expect(I18N.pick({ browser: [] }).lang).toBe("en");
    expect(I18N.pick({}).lang).toBe("en");
  });

  it("the choice shared by the site's tools (cookie bemesh_lang) beats the browser", () => {
    expect(I18N.pick({ cookie: "fr", browser: ["nl-BE"] }).lang).toBe("fr");
    expect(I18N.pick({ cookie: "de", browser: ["nl-BE"] }).lang).toBe("nl");
  });

  it("without the cookie the browser decides, also when this page kept an older choice of its own", () => {
    localStorage.setItem("bemesh.lang", "fr");
    vi.stubGlobal("navigator", { languages: ["nl-BE"], language: "nl-BE" });
    expect(I18N.detect()).toBe("nl");
    // The old per-page choice is cleared, so it can never come back.
    expect(localStorage.getItem("bemesh.lang")).toBeNull();
  });

  it("?lang in the address wins for that page", () => {
    expect(I18N.pick({ query: "nl", cookie: "fr", browser: ["en"] }).lang).toBe("nl");
    expect(I18N.pick({ query: "FR", cookie: "nl" }).lang).toBe("fr");
    expect(I18N.pick({ query: "xx", cookie: "nl", browser: ["fr"] }).lang).toBe("nl");
  });

  it("detect() reads the shared cookie, and a ?lang is never saved", () => {
    document.cookie = "other=1; Path=/";
    document.cookie = "bemesh_lang=fr; Path=/";
    expect(I18N.detect()).toBe("fr");
    history.replaceState(null, "", "/?lang=nl");
    expect(I18N.detect()).toBe("nl");
    history.replaceState(null, "", "/");
    expect(I18N.detect()).toBe("fr");
    expect(localStorage.getItem("bemesh.lang")).toBeNull();
    expect(document.cookie).toContain("bemesh_lang=fr");
  });

  it("a first visit saves nothing", () => {
    vi.stubGlobal("navigator", { languages: ["nl-BE", "en"], language: "nl-BE" });
    expect(I18N.detect()).toBe("nl");
    expect(document.cookie).not.toContain("bemesh_lang");
    expect(localStorage.getItem("bemesh.lang")).toBeNull();
  });

  it("detect() still works when storage throws", () => {
    const get = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    history.replaceState(null, "", "/?lang=nl");
    expect(I18N.detect()).toBe("nl");
    history.replaceState(null, "", "/");
    vi.stubGlobal("navigator", { languages: ["de"], language: "de" });
    expect(I18N.detect()).toBe("en");
    get.mockRestore();
  });

  it("choose() asks the map to save the choice for all tools, drops the page's old one, updates a ?lang and switches", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    localStorage.setItem("bemesh.lang", "fr");
    history.replaceState(null, "", "/configurator?lang=en&x=1");
    I18N.choose("nl");
    await vi.waitFor(() => expect(I18N.lang).toBe("nl"));
    expect(fetch).toHaveBeenCalledWith("/api/v1/lang", expect.objectContaining({ method: "POST", body: JSON.stringify({ lang: "nl" }) }));
    expect(localStorage.getItem("bemesh.lang")).toBeNull();
    expect(location.search).toBe("?lang=nl&x=1");
    expect(document.documentElement.lang).toBe("nl-BE");
  });

  it("choose() ignores a language the site doesn't have", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    I18N.choose("de");
    expect(fetch).not.toHaveBeenCalled();
    expect(I18N.lang).toBe("en");
  });
});

describe("translation", () => {
  it("translates into the chosen language and sets <html lang>", async () => {
    await setLang("fr");
    expect(t("page.map")).toBe("Carte");
    expect(document.documentElement.lang).toBe("fr-FR");
    await setLang("nl");
    expect(t("page.map")).toBe("Kaart");
    await setLang("en");
    expect(t("page.map")).toBe("Map");
    expect(document.documentElement.lang).toBe("en");
  });

  it("picks plural forms with each language's rules", async () => {
    await setLang("fr");
    expect(t("changes", { count: 0 })).toBe("0 modification");
    expect(t("changes", { count: 2 })).toBe("2 modifications");
    await setLang("nl");
    expect(t("changes", { count: 0 })).toBe("0 wijzigingen");
    expect(t("changes", { count: 1 })).toBe("1 wijziging");
    await setLang("en");
    expect(t("changes", { count: 0 })).toBe("0 changes");
  });

  it("falls back to English for a key the language lacks, warning in development", async () => {
    await setLang("nl");
    I18N.add("en", { "test.onlyEnglish": "Only {what}" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("test.onlyEnglish", { what: "English" })).toBe("Only English");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("test.onlyEnglish");
    I18N.dev = false;
    expect(t("test.onlyEnglishToo")).toBe("test.onlyEnglishToo");
    expect(warn).toHaveBeenCalledTimes(1);
    I18N.dev = true;
    warn.mockRestore();
  });

  it("names regions and Brussels municipalities in the page language", async () => {
    await setLang("fr");
    expect(I18N.regionName("be-wlg")).toBe("Liège");
    expect(I18N.regionName("be-vlg")).toBe("Flandre");
    expect(I18N.regionName("nl")).toBe("Pays-Bas");
    expect(I18N.regionName("be-xyz")).toBe("be-xyz");
    expect(I18N.municipalityName("Elsene")).toBe("Ixelles");
    expect(I18N.municipalityName("Gent")).toBe("Gent");
    await setLang("nl");
    expect(I18N.regionName("be-wlg")).toBe("Luik");
    expect(I18N.regionName("be-wal")).toBe("Wallonië");
    expect(I18N.municipalityName("Elsene")).toBe("Elsene");
    await setLang("en");
    expect(I18N.regionName("be-wlg")).toBe("Luik");
  });

  it("formats numbers with the page language", async () => {
    await setLang("nl");
    expect(I18N.number(12345.5)).toBe("12.345,5");
    await setLang("en");
    expect(I18N.number(12345.5)).toBe("12,345.5");
  });
});

describe("region rows", () => {
  it("are labelled in the page language and relabelled after a switch, codes unchanged", async () => {
    const anchor = anchorFromChoice(locationChoices("Elsene", PLACES).find((c) => c.type === "city")!);
    const en = policyFor(anchor, PLACES);
    const label = (p: typeof en, code: string) => p.rows.find((r) => r.code === code)!.label;
    expect(label(en, "be-bru")).toBe("Brussel (be-bru)");
    await setLang("fr");
    const fr = relabelPolicy(en, PLACES);
    expect(fr.rows.map((r) => r.code)).toEqual(en.rows.map((r) => r.code));
    expect(label(fr, "be-bru")).toBe("Bruxelles (be-bru)");
    expect(label(fr, "be")).toBe("Belgique (be)");
    expect(label(fr, anchor.place!.city_code)).toBe(`Ixelles (${anchor.place!.city_code})`);
    const neighbour = fr.rows.find((r) => r.group === "neighbourMunicipality" && r.label.startsWith("Uccle"));
    expect(neighbour?.label).toMatch(/^Uccle \(~\d+ km\) \(be\w+\)$/);
    expect(locationChoices("Liège", PLACES).find((c) => c.type === "province")?.label).toBe("Liège (be-wlg)");
    await setLang("en");
    expect(relabelPolicy(fr, PLACES).rows.map((r) => r.label)).toEqual(en.rows.map((r) => r.label));
  });
});
