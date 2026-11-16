// Adapted from map.meshcore.io (https://github.com/meshcore-dev/map.meshcore.io), MIT License,
// Copyright (c) 2025 Rastislav Vysoky. See LICENSE in this folder.
// Changed here: no Vue state in this file (the panel keeps it, see planning.js), #BEmesh radio
// defaults instead of the presets API, the map's own node shape, sites in the URL from url-state.js.
import {
	ANTENNA_TYPES, BUILDINGS_MAX_DISTANCE, EARTH_RADIUS, FADE_MARGIN_DB, LORA_SNR_LIMIT, RECEIVER, getSensitivity, toWorldPixels,
} from './coverage-model.js';

// Coverage estimates: the model (coverage-model.js) runs in a worker, so the map stays responsive
export { ANTENNA_TYPES, BUILDINGS_MAX_DISTANCE, FADE_MARGIN_DB, RECEIVER, getSensitivity };

// The settings with a choice of values (the panel's labels are translations: cov.option.*)
export const COVERAGE_OPTIONS = {
	frequency: [433, 868],
	antennaType: ['omni', 'yagi', 'panel'],
	distanceKm: [40, 120, 250],
	// loss of antennas among buildings and trees (ITU-R P.2108)
	clutter: [true, false],
	// share of the extra loss of rounded hills (ITU-R P.526) added to the knife edges
	ridgeRounding: [0, 0.25, 0.5, 1],
	nodeDisplay: ['reachable', 'all'],
};

// settings set with sliders: their range and step
export const COVERAGE_SLIDERS = {
	txPower: { min: 0, max: 40, step: 1, unit: 'dBm' },
	antennaGain: { min: 0, max: 20, step: 0.5, unit: 'dBi' },
	antennaHeight: { min: 0, max: 300, step: 1, unit: 'm' },
	// half-power beam width of directional antennas
	beamWidth: { min: 10, max: 180, step: 5, unit: '°' },
	// where they point (bearing)
	direction: { min: 0, max: 359, step: 1, unit: '°' },
};

export const DEFAULT_SETTINGS = Object.freeze({
	frequency: 868,
	txPower: 22,
	antennaGain: 2,
	antennaHeight: 10,
	distanceKm: 40,
	ridgeRounding: 0.25,
	clutter: true,
	nodeDisplay: 'reachable',
	antennaType: 'omni',
	beamWidth: 60,
	direction: 0,
});

// The #BEmesh radio plan (EU/UK Narrow), the start for 868 MHz; for 433 MHz the EU 433 preset
export const BEMESH_PRESET_NAME = 'EU/UK (Narrow)';
export const BAND_RADIO = Object.freeze({
	868: Object.freeze({ freq: 869.618, bw: 62.5, sf: 8 }),
	433: Object.freeze({ freq: 433.65, bw: 250, sf: 11 }),
});
// radio preset for picked points: a preset name, or this for the settings of the repeaters around them
export const AUTO_PRESET = 'auto';

export function isAllowed(key, value) {
	const slider = COVERAGE_SLIDERS[key];
	if(slider) {
		return typeof value === 'number' && value >= slider.min && value <= slider.max &&
			Math.abs(Math.round((value - slider.min) / slider.step) * slider.step - (value - slider.min)) < 1e-9;
	}
	return COVERAGE_OPTIONS[key]?.includes(value) ?? false;
}

// Stored settings (JSON text) with only known keys and allowed values, defaults for the rest
export function sanitizeSettings(stored) {
	let parsed = {};
	try { parsed = typeof stored === 'string' ? JSON.parse(stored) ?? {} : stored ?? {}; } catch {}
	return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [key, isAllowed(key, parsed[key]) ? parsed[key] : value]));
}

// Link quality of reachable nodes: margin (dB, on top of the fade margin) needed for 3 / 2 / 1 bars
const LINK_BAR_MARGINS = [20, 10, 0];

export function getLinkBars(margin) {
	const index = LINK_BAR_MARGINS.findIndex(min => margin >= min);
	return index === -1 ? 0 : LINK_BAR_MARGINS.length - index;
}

// Same radio settings as the estimate (otherwise the nodes can't hear each other at all)
export function hasSameRadio(node, radio) {
	const params = node.params ?? {};
	return Math.abs(Number(params.freq) - radio.freq) < 0.01 &&
		Number(params.bw) === radio.bw &&
		Number(params.sf) === radio.sf;
}

// The coverage settings in a URL: their values in this order, comma separated
// (new ones go at the end, so older links still work)
const SHARED_SETTINGS = [
	'frequency', 'txPower', 'antennaGain', 'antennaHeight', 'distanceKm', 'clutter', 'ridgeRounding', 'nodeDisplay',
	'antennaType', 'beamWidth', 'direction',
];
const SHARED_VALUES = {
	clutter: [[true, '1'], [false, '0']],
	nodeDisplay: [['reachable', 'r'], ['all', 'a']],
	antennaType: [['omni', 'o'], ['yagi', 'y'], ['panel', 'p']],
};

export function encodeCoverageSettings(settings) {
	return SHARED_SETTINGS.map(key => {
		const value = settings[key];
		return SHARED_VALUES[key]?.find(([v]) => v === value)?.[1] ?? String(value);
	}).join(',');
}

// Puts the settings of a URL value into `settings`; values that aren't allowed are left out
export function applyCoverageSettings(text, settings) {
	const parts = String(text).split(',');
	SHARED_SETTINGS.forEach((key, i) => {
		if(parts[i] === undefined || parts[i] === '') return;
		const mapped = SHARED_VALUES[key]?.find(([, code]) => code === parts[i]);
		const value = mapped ? mapped[0] : SHARED_VALUES[key] ? undefined : Number(parts[i]);
		if(isAllowed(key, value)) settings[key] = value;
	});
	return settings;
}

const inBand = (freq, band) => band === 433 ? freq >= 410 && freq <= 525 : freq >= 850 && freq <= 930;

// Radio values for an estimate: the node's radio params when they are in the band of the settings,
// otherwise the band's #BEmesh start values
export function getCoverageRadio(node, settings) {
	const params = node?.params ?? {};
	const freq = Number(params.freq), bw = Number(params.bw), sf = Number(params.sf);
	if(inBand(freq, settings.frequency) && bw > 0 && LORA_SNR_LIMIT[sf] !== undefined) return { freq, bw, sf };
	return { ...BAND_RADIO[settings.frequency] ?? BAND_RADIO[868] };
}

// repeaters within this distance decide the radio settings of a picked point
const LOCAL_RADIO_RADIUS_KM = 50;

// Radio params for a picked point: the most common ones among the repeaters around it (in the band
// of the settings), so its estimate matches the local network. Null when there are none.
// `nodes`: [{ lat, lon, type, params }]
export function getLocalRadioParams(lat, lon, nodes, settings) {
	const counts = new Map();
	const cosLat = Math.cos(lat * Math.PI / 180);
	for(const node of nodes) {
		if(node.type !== 2 || !node.params) continue;
		const distanceKm = Math.hypot((node.lon - lon) * cosLat, node.lat - lat) * 111.2;
		if(distanceKm > LOCAL_RADIO_RADIUS_KM) continue;
		const radio = getCoverageRadio(node, settings);
		if(!hasSameRadio(node, radio)) continue;
		const key = `${radio.freq}|${radio.bw}|${radio.sf}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	let best = null, bestCount = 0;
	for(const [key, count] of counts) {
		if(count > bestCount) { best = key; bestCount = count; }
	}
	if(!best) return null;
	const [freq, bw, sf] = best.split('|').map(Number);
	return { freq, bw, sf };
}

// Bounds ([west, south], [east, north]) of the estimate's circle around a point
export function getCoverageBounds(lon, lat, distanceKm) {
	const latDelta = distanceKm * 1000 / EARTH_RADIUS * 180 / Math.PI;
	const lonDelta = latDelta / Math.cos(lat * Math.PI / 180);
	return [[lon - lonDelta, Math.max(-85, lat - latDelta)], [lon + lonDelta, Math.min(85, lat + latDelta)]];
}

// The image corners of an estimate ([lon, lat]: top left, top right, bottom right, bottom left) as
// Leaflet bounds [[south, west], [north, east]] (the image is web mercator aligned, as ImageOverlay)
export function cornersToLatLngBounds(coordinates) {
	const [topLeft, , bottomRight] = coordinates;
	return [[bottomRight[1], topLeft[0]], [topLeft[1], bottomRight[0]]];
}

// Planning sites in the URL: a node's public key, or "lat,lon" of a picked point
export function encodeSite(site) {
	if(!site) return null;
	return site.publicKey ?? `${site.lat.toFixed(5)},${site.lon.toFixed(5)}`;
}

export function decodeSite(value) {
	if(typeof value !== 'string') return null;
	if(/^[0-9a-f]{64}$/i.test(value)) return { publicKey: value.toLowerCase() };
	const parts = value.split(',');
	if(parts.length !== 2 || parts.some(part => part.trim() === '')) return null;
	const [lat, lon] = parts.map(Number);
	if(!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
	return { lat, lon };
}

// Antenna heights of the profile ends in a URL ("a,b"); null for a height that isn't allowed
export function decodeHeights(text) {
	const { min, max } = COVERAGE_SLIDERS.antennaHeight;
	const parts = String(text ?? '').split(',');
	return [parts[0] ?? '', parts[1] ?? ''].map(part => {
		const value = part === '' ? NaN : Number(part);
		return Number.isInteger(value) && value >= min && value <= max ? value : null;
	});
}

// --- running the model ---

let worker = null;
let workerFailed = false;
let nextJob = 0;
const jobs = new Map();

function runInWorker(kind, job) {
	if(!worker) {
		worker = new Worker(new URL('./coverage-worker.js', import.meta.url), { type: 'module' });
		worker.onmessage = ({ data: { id, result, error } }) => {
			const pending = jobs.get(id);
			jobs.delete(id);
			if(error) pending?.reject(new Error(error));
			else pending?.resolve(result);
		};
		// the worker couldn't start (e.g. no module workers): compute on the main thread instead
		worker.onerror = event => {
			event.preventDefault();
			console.warn('Coverage worker failed, computing on the main thread', event.message);
			workerFailed = true;
			worker = null;
			for(const [id, pending] of jobs) {
				jobs.delete(id);
				runHere(pending.kind, pending.job).then(pending.resolve, pending.reject);
			}
		};
	}
	return new Promise((resolve, reject) => {
		const id = ++nextJob;
		jobs.set(id, { kind, job, resolve, reject });
		worker.postMessage({ id, kind, job });
	});
}

async function runHere(kind, job) {
	const model = await import('./coverage-model.js');
	return kind === 'profile' ? model.computeProfile(job) : model.computeCoverageGrid(job);
}

function run(kind, job) {
	return workerFailed ? runHere(kind, job) : runInWorker(kind, job);
}

// Terrain profile and link budget between two antennas ({ lat, lon, height }) with the coverage
// settings (TX power and antenna gain on both ends) and the given radio values (see computeProfile)
export function computeLinkProfile(a, b, settings, radio) {
	const { antennaType, beamWidth, direction } = settings;
	return run('profile', {
		// a has the coverage settings' antenna, pointing where they say; b's is aimed at a
		a: { ...a, gain: settings.antennaGain, antenna: ANTENNA_TYPES[antennaType] ? { antennaType, beamWidth, direction } : null },
		b: { ...b, gain: settings.antennaGain },
		settings: { ...settings },
		radio,
		rounding: settings.ridgeRounding,
	});
}

// Estimates the coverage around a site ({ lat, lon }) with the radio values (in a worker). Returns
// the image ({ url, coordinates }; the url is a blob URL, release it with releaseCoverage), the link
// margin at any location (marginAt), the lines to draw and some stats. `style`: how the image is drawn
// ({ rgb, steps, alphas }, see computeCoverageGrid).
export async function computeCoverage(site, settings, radio, style) {
	const job = { lat: site.lat, lon: site.lon, settings: { ...settings }, radio, rounding: settings.ridgeRounding, style };
	const { grid, blob, coordinates, incomplete, stats } = await run('coverage', job);
	const { margins, clutter, clutterLosses, left, top, size, worldSize, cx, cy, radius } = grid;

	// link margin at a location (dB), null outside the estimate's circle; with `clutter`, for an
	// antenna among the buildings and trees there (a handheld), otherwise above them (on a roof or mast)
	function marginAt(lonAt, latAt, { clutter: withClutter = true } = {}) {
		const [wx, wy] = toWorldPixels(lonAt, latAt, worldSize);
		const sx = Math.floor(wx) - left, sy = Math.floor(wy) - top;
		if(Math.hypot(sx - cx, sy - cy) > radius) return null;
		// a pixel the rays skipped: the best of its neighbours
		let best = -Infinity;
		for(let y = Math.max(0, sy - 1); y <= Math.min(size - 1, sy + 1); y++) {
			for(let x = Math.max(0, sx - 1); x <= Math.min(size - 1, sx + 1); x++) {
				const index = y * size + x;
				const margin = withClutter ? margins[index] - clutterLosses[clutter[index]] : margins[index];
				if(x === sx && y === sy && margin > -Infinity) return margin;
				best = Math.max(best, margin);
			}
		}
		return best;
	}

	// lines on the map: the estimate's edge and where a directional antenna points
	const lines = {
		center: [site.lon, site.lat],
		radius: settings.distanceKm * 1000,
		bearing: ANTENNA_TYPES[settings.antennaType] ? settings.direction : null,
	};
	return { marginAt, url: URL.createObjectURL(blob), coordinates, lines, radio, incomplete, stats };
}

// Frees the image of an estimate that isn't shown anymore
export function releaseCoverage(result) {
	if(result?.url?.startsWith('blob:')) URL.revokeObjectURL(result.url);
}
