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
  history.replaceState(null, "", "/");
});

describe("language choice", () => {
  it("follows the browser language on a first visit: nl* → nl, fr* → fr, else en", () => {
    expect(I18N.pick({ browser: "nl-BE" }).lang).toBe("nl");
    expect(I18N.pick({ browser: "nl" }).lang).toBe("nl");
    expect(I18N.pick({ browser: "fr-CA" }).lang).toBe("fr");
    expect(I18N.pick({ browser: "de-DE" }).lang).toBe("en");
    expect(I18N.pick({ browser: "en-US" }).lang).toBe("en");
    expect(I18N.pick({ browser: "" }).lang).toBe("en");
    expect(I18N.pick({}).remember).toBe(false);
  });

  it("prefers the stored choice over the browser", () => {
    expect(I18N.pick({ stored: "fr", browser: "nl-BE" })).toEqual({ lang: "fr", remember: false });
    expect(I18N.pick({ stored: "de", browser: "nl-BE" }).lang).toBe("nl");
  });

  it("lets ?lang override everything and asks to remember it", () => {
    expect(I18N.pick({ query: "nl", stored: "fr", browser: "en" })).toEqual({ lang: "nl", remember: true });
    expect(I18N.pick({ query: "FR", stored: "nl" })).toEqual({ lang: "fr", remember: true });
    expect(I18N.pick({ query: "xx", stored: "nl", browser: "fr" })).toEqual({ lang: "nl", remember: false });
  });

  it("detect() reads ?lang and stores it under bemesh.lang", () => {
    history.replaceState(null, "", "/?lang=fr");
    expect(I18N.detect()).toBe("fr");
    expect(localStorage.getItem("bemesh.lang")).toBe("fr");
    history.replaceState(null, "", "/");
    expect(I18N.detect()).toBe("fr");
  });

  it("detect() still works when storage throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    history.replaceState(null, "", "/?lang=nl");
    expect(I18N.detect()).toBe("nl");
    history.replaceState(null, "", "/");
    expect(I18N.detect()).toBe("en");
    get.mockRestore();
    set.mockRestore();
  });

  it("choose() remembers the language, updates a ?lang in the address and switches", async () => {
    history.replaceState(null, "", "/configurator?lang=en&x=1");
    I18N.choose("nl");
    await vi.waitFor(() => expect(I18N.lang).toBe("nl"));
    expect(localStorage.getItem("bemesh.lang")).toBe("nl");
    expect(location.search).toBe("?lang=nl&x=1");
    expect(document.documentElement.lang).toBe("nl-BE");
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
