// Types of ./geo.js for the configurator's TypeScript.
import type { Bounds, Spot } from "./index";
export function toMapZoom(zoom: number): number;
export function fromMapZoom(zoom: number): number;
export function clusterMaxZoomFor(until: number): number;
export function wrapLon(lon: number): number;
export function roundCoord(x: number): number;
export function project(spot: Spot): { x: number; y: number };
export function unproject(point: { x: number; y: number }): Spot;
export function destination(lonLat: [number, number], bearing: number, meters: number): Spot;
export function interpolate(a: Spot, b: Spot, share: number): Spot;
export function circleRing(spot: Spot, meters: number, steps?: number): [number, number][];
export function dashInLineWidths(dashArray: string | null | undefined, weight: number): number[] | null;
export function boundsOf(points: Spot[]): Bounds;
export function boundsOfGeoJSON(geojson: unknown): Bounds | null;
export function distanceKm(a: Spot, b: Spot): number;
