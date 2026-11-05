/** A component whose code loads after the first paint (Leaflet and the maps): null until it has arrived. */
import type { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";

export function useLazy(load: () => Promise<FunctionComponent>): FunctionComponent | null {
  const [Comp, setComp] = useState<FunctionComponent | null>(null);
  useEffect(() => {
    let live = true;
    // Effects run after the browser has painted.
    void load().then((c) => live && setComp(() => c));
    return () => void (live = false);
  }, []);
  return Comp;
}
