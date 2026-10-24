import { useEffect } from "preact/hooks";
import { loadAppData } from "../state/appdata";
import { DeviceDrawer } from "./DeviceDrawer";
import { MapView } from "./MapView";
import { Panel } from "./Panel";
import { TopBar } from "./TopBar";

export function App() {
  useEffect(() => {
    void loadAppData();
  }, []);
  return (
    <div class="app">
      <TopBar />
      <main class="stage">
        <MapView />
        <Panel />
        <DeviceDrawer />
      </main>
    </div>
  );
}
