/**
 * A recording stand-in for the configurator's map (src/app/map-engine.ts: the tool pages' map engine,
 * MapLibre or Leaflet): tests assert on what the views drew, not on a map library.
 */
type Spot = { lat: number; lon: number };
type Handler = (e: any) => void;
type Feature = { type: "Feature"; properties?: Record<string, any>; geometry: unknown };
type AreaOptions = {
  style?: (f: Feature) => { className?: string; fill?: boolean; weight?: number };
  onClick?: (f: Feature, spot: Spot) => void;
  interactive?: boolean;
};

const featuresOf = (data: unknown): Feature[] =>
  Array.isArray(data)
    ? (data as Feature[])
    : (data as { type?: string; features?: Feature[] })?.type === "FeatureCollection"
      ? ((data as { features: Feature[] }).features ?? [])
      : [data as Feature];

export class FakeArea {
  removed = false;
  selected: ((f: Feature) => boolean) | null = null;
  constructor(
    public data: unknown,
    public options: AreaOptions = {},
  ) {}
  /** Each feature with the class its style gives it, in drawing order. */
  get features() {
    return featuresOf(this.data).map((f) => ({ feature: f, className: this.options.style?.(f)?.className ?? "", style: this.options.style?.(f) ?? {} }));
  }
  click(f: Feature) {
    this.options.onClick?.(f, { lat: 0, lon: 0 });
  }
  remove() {
    this.removed = true;
  }
  select(test: ((f: Feature) => boolean) | null) {
    this.selected = test;
  }
  bounds() {
    return null;
  }
}

export class FakeMark {
  removed = false;
  handlers = new Map<string, Handler[]>();
  constructor(
    public spot: Spot,
    public options: Record<string, any> = {},
  ) {}
  get element() {
    return undefined;
  }
  getLatLng() {
    return this.spot;
  }
  setLatLng(spot: Spot) {
    this.spot = spot;
  }
  setIcon() {}
  setDraggable(on: boolean) {
    this.options.draggable = on;
  }
  isDragging() {
    return false;
  }
  on(type: string, fn: Handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  fire(type: string) {
    (this.handlers.get(type) ?? []).forEach((h) => h({}));
  }
  remove() {
    this.removed = true;
  }
}

export class FakeEngine {
  kind = "fake";
  handlers = new Map<string, Handler[]>();
  views: { spot: Spot; zoom: number }[] = [];
  fitted: { bounds: unknown; options: unknown } | null = null;
  resized = 0;
  removed = false;
  marks: FakeMark[] = [];
  areas: FakeArea[] = [];
  circles: { spot: Spot; meters: number; style: Record<string, any>; removed: boolean; remove(): void }[] = [];
  zoom: number;
  center: Spot;
  constructor(
    public container: HTMLElement,
    public options: Record<string, any>,
  ) {
    this.zoom = options.zoom;
    this.center = options.center;
  }
  on(type: string, fn: Handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  off() {}
  fire(type: string, e: unknown = {}) {
    (this.handlers.get(type) ?? []).forEach((h) => h(e));
  }
  setView(spot: Spot, zoom: number) {
    this.views.push({ spot, zoom });
    this.center = spot;
    this.zoom = zoom;
  }
  getZoom() {
    return this.zoom;
  }
  getCenter() {
    return this.center;
  }
  getSize() {
    return { x: 0, y: 0 };
  }
  project(s: Spot) {
    return { x: s.lon * 100, y: -s.lat * 100 };
  }
  unproject(p: { x: number; y: number }) {
    return { lat: -p.y / 100, lon: p.x / 100 };
  }
  fitBounds(bounds: unknown, options: unknown) {
    this.fitted = { bounds, options };
  }
  resize() {
    this.resized++;
  }
  remove() {
    this.removed = true;
  }
  addMarker(spot: Spot, options: Record<string, any> = {}) {
    const m = new FakeMark(spot, options);
    this.marks.push(m);
    return m;
  }
  addCircle(spot: Spot, meters: number, style: Record<string, any> = {}) {
    const c = {
      spot,
      meters,
      style,
      removed: false,
      remove() {
        c.removed = true;
      },
    };
    this.circles.push(c);
    return c;
  }
  addGeoJSON(data: unknown, options: AreaOptions = {}) {
    const a = new FakeArea(data, options);
    this.areas.push(a);
    return a;
  }
  /** Areas and marks still on the map. */
  live() {
    return { areas: this.areas.filter((a) => !a.removed), marks: this.marks.filter((m) => !m.removed), circles: this.circles.filter((c) => !c.removed) };
  }
  /** The features drawn (still) with a class, in drawing order. */
  classed(className: string) {
    return this.live()
      .areas.flatMap((a) => a.features.map((f) => ({ ...f, area: a })))
      .filter((f) => f.className.split(/\s+/).includes(className));
  }
}

export const engines: FakeEngine[] = [];
export const resetFakeEngine = () => {
  engines.length = 0;
};
/** The configurator's createMap: a fake engine, at once. */
export function createMap(container: HTMLElement, options: Record<string, any>) {
  const e = new FakeEngine(container, options);
  engines.push(e);
  return Promise.resolve(e);
}
