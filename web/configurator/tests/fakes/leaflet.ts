/** A recording stand-in for Leaflet: tests assert on what was added where, not on Leaflet internals. */
type Handler = (e: unknown) => void;

export class FakeLayer {
  children: FakeLayer[] = [];
  handlers = new Map<string, Handler[]>();
  tooltip: unknown = null;
  removed = false;
  constructor(
    public kind: string,
    public args: unknown[] = [],
    public options: Record<string, any> = {},
  ) {
    created.push(this);
  }
  addTo(parent: FakeLayer) {
    parent.children.push(this);
    return this;
  }
  addLayer(l: FakeLayer) {
    this.children.push(l);
    return this;
  }
  removeLayer(l: FakeLayer) {
    this.children = this.children.filter((c) => c !== l);
    return this;
  }
  clearLayers() {
    this.children = [];
    return this;
  }
  setLatLng(ll: unknown) {
    this.args = [ll];
    return this;
  }
  getLatLng() {
    return this.args[0];
  }
  setView(c: unknown, z: number) {
    this.view = { c, z };
    return this;
  }
  view: { c: unknown; z: number } | null = null;
  invalidated = 0;
  invalidateSize() {
    this.invalidated++;
    return this;
  }
  bindTooltip(content: unknown) {
    this.tooltip = content;
    return this;
  }
  on(type: string, fn: Handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
    return this;
  }
  fire(type: string, e: unknown = {}) {
    (this.handlers.get(type) ?? []).forEach((h) => h(e));
  }
  remove() {
    this.removed = true;
    return this;
  }
  getContainer() {
    return this.args[0] as HTMLElement;
  }
  fitted: unknown = null;
  fitBounds(b: unknown) {
    this.fitted = b;
    return this;
  }
  getBounds() {
    return { bounds: this.args[0] };
  }
  eachLayer(fn: (l: FakeLayer) => void) {
    this.children.forEach(fn);
  }
}

export const created: FakeLayer[] = [];
export const resetFake = () => {
  created.length = 0;
};
export const ofKind = (kind: string) => created.filter((l) => l.kind === kind);

const make = (kind: string) => (...args: unknown[]) => new FakeLayer(kind, args, (args[args.length - 1] as Record<string, any>) ?? {});
export const map = (...a: unknown[]) => new FakeLayer("map", a, (a[1] as Record<string, any>) ?? {});
export const tileLayer = (url: string, o: Record<string, any> = {}) => new FakeLayer("tile", [url], o);
export const layerGroup = make("group");
export const circle = (ll: unknown, o: Record<string, any> = {}) => new FakeLayer("circle", [ll], o);
export const marker = (ll: unknown, o: Record<string, any> = {}) => new FakeLayer("marker", [ll], o);
export const geoJSON = (data: unknown, o: Record<string, any> = {}) => new FakeLayer("geojson", [data], o);
export const divIcon = (o: Record<string, any>) => ({ divIcon: true, ...o });

/** Just enough of Leaflet's control and DOM helpers for map-shade.js. */
export const DomUtil = {
  create(tag: string, className: string, parent?: HTMLElement) {
    const el = document.createElement(tag);
    el.className = className;
    parent?.appendChild(el);
    return el;
  },
};
export const DomEvent = {
  disableClickPropagation: () => {},
  preventDefault: (e: Event) => e.preventDefault(),
  on: (el: HTMLElement, type: string, fn: (e: Event) => void) => el.addEventListener(type, fn),
};
export const control = (o: { position?: string } = {}) => {
  const c: any = {
    options: o,
    el: null as HTMLElement | null,
    addTo(map: FakeLayer) {
      c.el = c.onAdd(map);
      map.getContainer().appendChild(c.el);
      return c;
    },
    remove() {
      c.el?.remove();
      return c;
    },
  };
  return c;
};
/** The zoom control's default options, which MapView sets to the page language's titles. */
export const Control = { Zoom: { prototype: { options: {} as Record<string, unknown> } } };
