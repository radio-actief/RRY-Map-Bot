import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no WebGL: the map engine takes its Leaflet map, here on the recording stand-in.
vi.mock("leaflet", async () => await import("./fakes/leaflet"));

import { MapView } from "../src/app/MapView";
import { defaultPlan } from "../src/core/plan";
import { store } from "../src/state/store";
import { ofKind, resetFake } from "./fakes/leaflet";

const KEY = "bemesh.mapShade";

beforeEach(() => {
  resetFake();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  store.plan.value = defaultPlan();
  store.step.value = "place";
  store.layers.value = { nodes: true, borders: true };
  store.data.value = { failed: new Set() };
});
afterEach(cleanup);

const container = () => ofKind("map")[0].getContainer();
/** MapView, once its map engine (Leaflet here) is in. */
async function renderMap() {
  render(<MapView />);
  await waitFor(() => expect(document.querySelector(".map-shade-button")).not.toBeNull());
}
const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLElement;

describe("map shade switch", () => {
  it("renders a switch and the OSM layer carries the osm-tiles class", async () => {
    await renderMap();
    expect(button(/^Dark map \(follows the theme\)$/)).toBeTruthy();
    expect(ofKind("tile")[0].options.className).toBe("osm-tiles");
    expect(container().classList.contains("map-dark")).toBe(false);
  });

  it("follows the theme live", async () => {
    await renderMap();
    await act(async () => {
      document.documentElement.setAttribute("data-theme", "dark");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container().classList.contains("map-dark")).toBe(true);
    expect(button(/^Light map \(follows the theme\)$/)).toBeTruthy();
  });

  it("a click flips the shade, stores the override and a second click goes back to following", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    await renderMap();
    expect(container().classList.contains("map-dark")).toBe(true);
    fireEvent.click(button(/^Light map/));
    expect(container().classList.contains("map-dark")).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("light");
    expect(button(/^Dark map$/)).toBeTruthy();
    fireEvent.click(button(/^Dark map$/));
    expect(container().classList.contains("map-dark")).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("a stored dark override on the light theme gives a dark map", async () => {
    localStorage.setItem(KEY, "dark");
    await renderMap();
    expect(container().classList.contains("map-dark")).toBe(true);
  });
});
