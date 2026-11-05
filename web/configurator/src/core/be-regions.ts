// Side effect: src/shared/be-regions.js sets window.RRYRegions. That file stays the single source of province data.
import "../../../../src/shared/be-regions.js";

type RRYRegions = {
  PROVINCE_NAMES: Record<string, string>;
  PROVINCE_CODES: Record<string, string>;
  PROVINCE_ADJACENCY: Record<string, string[]>;
  PROVINCE_CAPITAL_LATLNG: Record<string, [number, number]>;
  GEWEST_NAMES: Record<string, string>;
  GEWEST_CODES: Record<string, string>;
  GEWEST_OF_PROVINCE: Record<string, string>;
};

const regions = (window as unknown as { RRYRegions: RRYRegions }).RRYRegions;

export const PROVINCE_NAMES = regions.PROVINCE_NAMES;
export const PROVINCE_CODES = regions.PROVINCE_CODES;
export const PROVINCE_ADJACENCY = regions.PROVINCE_ADJACENCY;
export const PROVINCE_CAPITAL_LATLNG = regions.PROVINCE_CAPITAL_LATLNG;
export const GEWEST_NAMES = regions.GEWEST_NAMES;
export const GEWEST_CODES = regions.GEWEST_CODES;
export const GEWEST_OF_PROVINCE = regions.GEWEST_OF_PROVINCE;
