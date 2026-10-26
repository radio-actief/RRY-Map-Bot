import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultPlan } from "../src/core/plan";
import { regionCommandLines, regionsByState, addFreeRegion, policyFor, MAX_REGIONS } from "../src/core/regions";
import type { Place } from "../src/core/search";
import { Regions } from "../src/steps/Regions";
import { chooseLocation, regionCount, resetPlan, store } from "../src/state/store";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(__dirname, "../../../data/be-locode.json"), "utf8"));
const RONSE = PLACES.find((p) => p.city_code === "beron")!;

beforeEach(() => {
  resetPlan(defaultPlan());
  store.data.value = { failed: new Set(), places: PLACES };
  store.deviceRegions.value = undefined;
  store.step.value = "regions";
});
afterEach(cleanup);

const rowFor = (code: string) => document.querySelector(`li[data-code="${code}"]`) as HTMLElement;
const press = (code: string, state: string) => fireEvent.click(within(rowFor(code)).getByRole("button", { name: new RegExp(`^${state}:`) }));
const state = () => regionsByState(store.plan.value.regions!);

describe("Regions step", () => {
  it("shows a notice and no rows without a location", () => {
    render(<Regions />);
    expect(screen.getByText("Choose a location in the previous step to set the regions.")).toBeTruthy();
    expect(document.querySelectorAll("li.region-row")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Recommended" })).toBeNull();
  });

  it("lists the home rows for Ronse and links to the wiki", () => {
    chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
    render(<Regions />);
    for (const code of ["be", "be-vov", "beron"]) expect(rowFor(code)).toBeTruthy();
    const link = screen.getByRole("link", { name: "What are regions?" });
    expect(link.getAttribute("href")).toBe("https://meshwiki.radio-actief.be/index.php/MeshCore/RegioScopes");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(within(rowFor("nl")).getByText("Netherlands (nl)")).toBeTruthy();
  });

  it("lists neighbours in three groups: municipalities, provinces, countries", () => {
    chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
    render(<Regions />);
    const headings = [...document.querySelectorAll(".region-group h3")].map((h) => h.textContent);
    expect(headings).toEqual([
      "Country and wider",
      "Region and province",
      "Municipality",
      "Neighbouring municipalities",
      "Neighbouring provinces",
      "Neighbouring regions",
      "Neighbouring countries",
      "Your own regions",
    ]);
    const groupOf = (code: string) => rowFor(code).closest(".region-group")!.querySelector("h3")!.textContent;
    expect(groupOf("bemak")).toBe("Neighbouring municipalities");
    expect(groupOf("be-wht")).toBe("Neighbouring provinces");
    expect(groupOf("be-wal")).toBe("Neighbouring regions");
    expect(groupOf("nl")).toBe("Neighbouring countries");
  });

  it("denying a neighbour moves it into the denied list", () => {
    chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
    render(<Regions />);
    press("nl", "Deny");
    expect(state().denied).toContain("nl");
    press("nl", "Allow");
    expect(state().denied).not.toContain("nl");
    expect(state().allowed).toContain("nl");
    press("nl", "Not set");
    expect(state().allowed).not.toContain("nl");
  });

  it("locks neighbour municipalities until the home municipality is set, with the reason", () => {
    chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
    render(<Regions />);
    const mak = rowFor("bemak");
    const allow = within(mak).getByRole("button", { name: /^Allow:/ }) as HTMLButtonElement;
    expect(allow.disabled).toBe(true);
    expect(within(mak).getByRole("group").getAttribute("title")).toBe("Allow or deny your home municipality first.");
    press("beron", "Allow");
    expect((within(rowFor("bemak")).getByRole("button", { name: /^Allow:/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Clear leaves nothing allowed or denied; Deny all and Recommended work", () => {
    chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
    render(<Regions />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(state()).toEqual({ allowed: [], denied: [] });
    fireEvent.click(screen.getByRole("button", { name: "Deny all" }));
    expect(state().denied).toContain("beron");
    expect(state().allowed).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Recommended" }));
    expect(state()).toEqual({ allowed: ["be", "be-vov"], denied: [] });
    fireEvent.click(screen.getByRole("button", { name: "Allow all" }));
    expect(state().denied).toEqual([]);
    expect(state().allowed).toContain("eu");
  });

  it("keeps untagged flood, home override and default scope in a folded section", () => {
    chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
    render(<Regions />);
    const details = document.querySelector("details.region-options") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText("Not an active function in the current firmware.")).toBeTruthy();
    fireEvent.click(within(details).getByRole("checkbox"));
    expect(store.plan.value.regions!.untaggedFlood).toBe(false);
    const [home, def] = within(details).getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(home, { target: { value: "be-vov" } });
    expect(store.plan.value.regions!.homeOverride).toBe("be-vov");
    fireEvent.change(def, { target: { value: "__none__" } });
    expect(store.plan.value.regions!.defaultScope).toBe("__none__");
  });

  describe("your own regions", () => {
    const ronse = () => store.plan.value.anchor!;
    const addZone = (code: string, parent = "") => {
      fireEvent.input(screen.getByLabelText("Region code"), { target: { value: code } });
      if (parent) fireEvent.change(screen.getByLabelText("Parent region"), { target: { value: parent } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    };

    const setRow = (code: string, s: "Allow" | "Deny") =>
      fireEvent.click(within(rowFor(code)).getByRole("button", { name: new RegExp(`^${s}: `) }));

    it("adds a free region under a parent on Allow and defines it in the script", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      setRow("be-wht", "Deny");
      addZone("zone", "be-wht");
      expect(state().allowed).toContain("zone");
      expect(within(rowFor("zone")).getByRole("button", { name: /^Allow: zone/ }).getAttribute("aria-pressed")).toBe("true");
      expect((screen.getByLabelText("Region code") as HTMLInputElement).value).toBe("");
      const def = regionCommandLines(ronse(), store.plan.value.regions!, PLACES).filter((l) => l.startsWith("region def "));
      expect(def.join("|")).toMatch(/\bzone\b/);
    });

    it("shows the group with only the form when empty, before the device group", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      expect(screen.getByRole("heading", { name: "Your own regions" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
    });

    it("rejects uppercase with the message and keeps Add disabled", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      fireEvent.input(screen.getByLabelText("Region code"), { target: { value: "Zone" } });
      expect(screen.getByText("Use lowercase a–z, digits and -.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
    });

    it("adds on Enter when valid", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      const input = screen.getByLabelText("Region code");
      fireEvent.input(input, { target: { value: "zone" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(rowFor("zone")).toBeTruthy();
    });

    it("disables remove on a parent with a child, and removes a leaf", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      addZone("zone");
      addZone("child", "zone");
      const parentX = within(rowFor("zone")).getByRole("button", { name: "Remove zone" });
      expect(parentX.hasAttribute("disabled")).toBe(true);
      expect(parentX.getAttribute("title")).toBe("Another region sits under this one.");
      fireEvent.click(within(rowFor("child")).getByRole("button", { name: "Remove child" }));
      expect(rowFor("child")).toBeNull();
      expect(within(rowFor("zone")).getByRole("button", { name: "Remove zone" }).hasAttribute("disabled")).toBe(false);
    });

    it("offers only regions on Allow or Deny as parent region", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      const parents = () => [...(screen.getByLabelText("Parent region") as HTMLSelectElement).options].map((o) => o.value);
      expect(parents()).not.toContain("nl");
      setRow("nl", "Allow");
      expect(parents()).toContain("nl");
      expect(parents()[0]).toBe("");
    });

    it("keeps a parent region off neither while a region sits under it", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      setRow("nl", "Deny");
      addZone("zone", "nl");
      const none = within(rowFor("nl")).getByRole("button", { name: /^Not set: / });
      expect(none.hasAttribute("disabled")).toBe(true);
      const reason = document.getElementById(none.getAttribute("aria-describedby")!)!;
      expect(reason.textContent).toBe("Another region sits under this one.");
      expect(within(rowFor("nl")).getByRole("button", { name: /^Allow: / }).hasAttribute("disabled")).toBe(false);
      fireEvent.click(within(rowFor("zone")).getByRole("button", { name: "Remove zone" }));
      expect(within(rowFor("nl")).getByRole("button", { name: /^Not set: / }).hasAttribute("disabled")).toBe(false);
    });

    it("offers an allowed free row in the default scope select", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      addZone("zone");
      const sel = screen.getByLabelText(/Default flood scope/) as HTMLSelectElement;
      expect([...sel.options].map((o) => o.value)).toContain("zone");
    });

    it("does not keep a parent that was removed from the choices", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      addZone("xx");
      fireEvent.change(screen.getByLabelText("Parent region"), { target: { value: "xx" } });
      fireEvent.click(within(rowFor("xx")).getByRole("button", { name: "Remove xx" }));
      expect((screen.getByLabelText("Parent region") as HTMLSelectElement).selectedOptions[0]?.textContent).toBe("Top level");
      addZone("zz");
      expect(store.plan.value.regions!.rows.find((r) => r.code === "zz")!.parent).toBeNull();
      const lines = regionCommandLines(ronse(), store.plan.value.regions!, PLACES);
      expect(lines.join("\n")).not.toMatch(/\bxx\b/);
    });

    it("does not keep a parent the moved pin no longer offers", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      setRow("beron", "Allow");
      fireEvent.change(screen.getByLabelText("Parent region"), { target: { value: "beron" } });
      const kortrijk = PLACES.find((p) => p.city_code === "bekjk")!;
      act(() => chooseLocation({ type: "city", label: "Kortrijk", place: kortrijk } as never));
      expect((screen.getByLabelText("Parent region") as HTMLSelectElement).selectedOptions[0]?.textContent).toBe("Top level");
      addZone("zz");
      expect(store.plan.value.regions!.rows.find((r) => r.code === "zz")!.parent).toBeNull();
      const lines = regionCommandLines(ronse(), store.plan.value.regions!, PLACES);
      expect(lines.join("\n")).not.toMatch(/\bberon\b/);
    });

    it("links the code error to the input and marks it invalid", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      const input = screen.getByLabelText("Region code");
      expect(input.hasAttribute("aria-invalid")).toBe(false);
      expect(input.hasAttribute("aria-describedby")).toBe(false);
      fireEvent.input(input, { target: { value: "Zone" } });
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const error = document.getElementById(input.getAttribute("aria-describedby")!)!;
      expect(error.textContent).toBe("Use lowercase a–z, digits and -.");
    });

    it("gives the disabled remove button its reason without hover", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      addZone("zone");
      addZone("child", "zone");
      const x = within(rowFor("zone")).getByRole("button", { name: "Remove zone" });
      const reason = document.getElementById(x.getAttribute("aria-describedby")!)!;
      expect(reason.textContent).toBe("Another region sits under this one.");
      expect(reason.classList.contains("sr")).toBe(true);
      expect(within(rowFor("child")).getByRole("button", { name: "Remove child" }).hasAttribute("aria-describedby")).toBe(false);
    });

    it("shows where each free region sits in its sub-label", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      render(<Regions />);
      addZone("top");
      setRow("be-wht", "Allow");
      addZone("zone", "be-wht");
      expect(within(rowFor("zone")).getByText("Your own region · under Henegouwen (be-wht)")).toBeTruthy();
      expect(within(rowFor("top")).getByText("Your own region · top level")).toBeTruthy();
    });

    it("shows the count notice above the limit", () => {
      chooseLocation({ type: "city", label: "Ronse", place: RONSE } as never);
      let p = store.plan.value.regions!;
      for (let i = 0; i < MAX_REGIONS; i++) p = addFreeRegion(p, `zone${i}`, null);
      store.plan.value = { ...store.plan.value, regions: p };
      render(<Regions />);
      expect(screen.getByText(`The repeater holds at most 32 regions; this plan needs ${regionCount.value}.`)).toBeTruthy();
    });
  });
});
