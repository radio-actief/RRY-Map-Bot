import { useEffect } from "preact/hooks";
import { ensureData, loadAppData, loadOnDemand } from "../state/appdata";
import { isWide, store } from "../state/store";
import { DeviceDrawer } from "./DeviceDrawer";
import { useLazy } from "./lazy";
import { Panel } from "./Panel";
import { TopBar } from "./TopBar";

/**
 * The map (Leaflet and its outlines) loads after the first paint, so the panel is usable first;
 * until then an empty map area holds its place, and the map fades in.
 */
function LazyMap() {
  const Map = useLazy(() => {
    void ensureData(["countries", "provinces", "gewesten"]);
    return import("./MapView").then((m) => m.MapView);
  });
  return Map ? <Map /> : <div class="map-container map-waiting" hidden={isWide(store.step.value)} />;
}

export function App() {
  useEffect(() => {
    void loadAppData();
    return loadOnDemand();
  }, []);
  return (
    <div class="app">
      <TopBar />
      <main class="stage">
        <LazyMap />
        <Panel />
        <DeviceDrawer />
      </main>
    </div>
  );
}
