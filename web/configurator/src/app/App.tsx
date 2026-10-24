import { store } from "../state/store";
import { Panel } from "./Panel";
import { TopBar } from "./TopBar";

export function App() {
  return (
    <div class="app">
      <TopBar />
      <main class="stage">
        <div class="map-container" hidden={store.step.value >= 4} />
        <Panel />
      </main>
    </div>
  );
}
