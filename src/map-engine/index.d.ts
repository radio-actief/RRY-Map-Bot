// Types of the map engine (./index.js) for the configurator's TypeScript. The interface is described
// in index.js; MapLibre (maplibre-engine.js) and Leaflet (leaflet-engine.js) both implement it.
export type Spot = { lat: number; lon: number };
/** [[south, west], [north, east]] */
export type Bounds = [[number, number], [number, number]];
export type Translate = (key: string, params?: Record<string, string | number>) => string;

export type EngineOptions = {
  center: Spot;
  /** zoom as Leaflet counts it (256 px tiles) */
  zoom: number;
  t: Translate;
  attribution?: string;
  controls?: "bottom-left" | "top-right" | false;
  /** false: a still map, without controls or gestures */
  interactive?: boolean;
  /** leaflet-engine.js only: a Leaflet module to use instead of loading lib/leaflet.js */
  leaflet?: unknown;
};

/** Leaflet's path options; a className's CSS wins over them, as on Leaflet's SVG. */
export type PathStyle = {
  className?: string;
  color?: string;
  weight?: number;
  opacity?: number;
  fill?: boolean;
  fillColor?: string;
  fillOpacity?: number;
  dashArray?: string | null;
  lineCap?: string;
};

export type GeoFeature = { type: "Feature"; properties?: Record<string, unknown> | null; geometry: unknown };

export type Removable = { remove(): void };
export type AreaLayer = Removable & {
  select(test: ((feature: GeoFeature) => boolean) | null): void;
  bounds(): Bounds | null;
};
export type Mark = Removable & {
  readonly element: HTMLElement | undefined;
  getLatLng(): Spot;
  setLatLng(spot: Spot): void;
  setIcon(icon: { html?: string; className?: string }): void;
  setDraggable(on: boolean): void;
  isDragging(): boolean;
  on(type: "drag" | "dragend" | "dragstart", fn: () => void): void;
};
export type MarkOptions = {
  html?: string;
  className?: string;
  size?: [number, number];
  anchor?: [number, number];
  draggable?: boolean;
  title?: string;
  interactive?: boolean;
  /** a name on hover (as text) */
  tooltip?: string;
};

export type MapEngine = {
  kind: "maplibre" | "leaflet";
  container: HTMLElement;
  getCenter(): Spot;
  getZoom(): number;
  getSize(): { x: number; y: number };
  getBounds(): Bounds;
  setView(spot: Spot, zoom: number): void;
  flyTo(spot: Spot, zoom: number): Promise<void>;
  fitBounds(bounds: Bounds, padding?: { top?: number; bottom?: number; left?: number; right?: number; maxZoom?: number }): void;
  project(spot: Spot): { x: number; y: number };
  unproject(point: { x: number; y: number }): Spot;
  resize(): void;
  remove(): void;
  on(type: "click" | "contextmenu", fn: (e: Spot & { clientX?: number; clientY?: number; touch?: boolean }) => void): void;
  on(type: "movestart" | "moveend" | "zoomstart" | "zoomend", fn: () => void): void;
  off(type: string, fn: (...args: never[]) => void): void;
  openPopup(
    spot: Spot,
    options: { html: string; className?: string; width?: number; minWidth?: number; maxWidth?: number; offset?: number; onContent?(root: HTMLElement): void; onClose?(): void },
  ): unknown;
  closePopup(): void;
  addPath(spots: Spot[], style?: PathStyle): Removable;
  addCircle(spot: Spot, meters: number, style?: PathStyle): Removable;
  addMarker(spot: Spot, options?: MarkOptions): Mark;
  addGeoJSON(
    data: unknown,
    options?: {
      style?(feature: GeoFeature): PathStyle;
      label?(feature: GeoFeature): string;
      labelAt?(feature: GeoFeature): Spot | null;
      onClick?(feature: GeoFeature, spot: Spot): void;
      interactive?: boolean;
    },
  ): AreaLayer;
  showTooltip(spot: Spot, text: string, options?: { offset?: number }): void;
  hideTooltip(): void;
};

export type EngineLoaders = {
  maplibre(): Promise<(container: HTMLElement, options: EngineOptions) => Promise<MapEngine>>;
  leaflet(): Promise<(container: HTMLElement, options: EngineOptions) => Promise<MapEngine>>;
};

export function webglAvailable(doc?: Document): boolean;
export function preloadEngine(doc?: Document, options?: { webgl?: () => boolean }): void;
export function createMapEngine(container: HTMLElement, options: EngineOptions, deps?: { webgl?: () => boolean; load?: EngineLoaders }): Promise<MapEngine>;
