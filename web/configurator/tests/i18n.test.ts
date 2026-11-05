import { describe, expect, it, vi } from "vitest";
import { t } from "../src/i18n/t";

describe("t", () => {
  it("returns plain text", () => {
    expect(t("apply.noDevice")).toBe("Connect a repeater first.");
  });
  it("resolves one/other plural forms with interpolation", () => {
    expect(t("changes", { count: 1 })).toBe("1 change");
    expect(t("changes", { count: 3 })).toBe("3 changes");
    expect(t("changes_other", { count: 3 })).toBe("3 changes");
  });
  it("returns the key for a missing key and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("no.such.key")).toBe("no.such.key");
    expect(t("no.such.key")).toBe("no.such.key");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
