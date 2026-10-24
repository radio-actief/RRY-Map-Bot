import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultPlan } from "../src/core/plan";
import { regionsByState } from "../src/core/regions";
import type { Place } from "../src/core/search";
import { Regions } from "../src/steps/Regions";
import { chooseLocation, resetPlan, store } from "../src/state/store";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(__dirname, "../../../data/be-locode.json"), "utf8"));
const RONSE = PLACES.find((p) => p.city_code === "beron")!;

beforeEach(() => {
  resetPlan(defaultPlan());
  store.data.value = { failed: new Set(), places: PLACES };
  store.deviceRegions.value = undefined;
  store.step.value = 3;
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
});
