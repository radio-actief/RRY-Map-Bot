// Adapted from map.meshcore.io (https://github.com/meshcore-dev/map.meshcore.io), MIT License,
// Copyright (c) 2025 Rastislav Vysoky. See LICENSE in this folder.
// Changed here: drawn in the #BEmesh house style (colours from the page's CSS variables, see
// planning.js; a hatched Fresnel zone, masts ending in the A / B discs, the line of sight in the
// result colour), translated hover texts, and getClearance tells where the path is tightest.
// Point-to-point profile chart: the terrain (raised by the earth's bulge, so the line of sight is
// straight), trees and buildings on it, the line of sight between the antennas and the first Fresnel zone around it

const PADDING = { left: 54, right: 10, top: 10, bottom: 22 };
const EARTH_RADIUS = 6371008.8;
// the Fresnel zone counts as clear with 60 % of it free
const FRESNEL_CLEAR = 0.6;

// Fallback colours (the page passes its own, from its CSS variables)
export const DEFAULT_COLORS = {
	background: '#ffffff',
	grid: '#e2e8f0',
	text: '#64748b',
	terrain: '#e2e8f0',
	terrainEdge: '#64748b',
	trees: 'rgba(26, 127, 55, 0.45)',
	buildings: '#94a3b8',
	fresnel: 'rgba(17, 89, 175, 0.35)',
	// the line of sight: the result colour
	los: '#1159af',
	blocked: '#c62828',
	mast: '#1a202c',
	point: '#1159af',
	pointText: '#ffffff',
	hover: '#1a202c',
	tooltip: 'rgba(255, 255, 255, 0.94)',
	tooltipText: '#1a202c',
};

// Texts in English (the page passes translated ones); numbers come formatted
export const DEFAULT_LABELS = {
	km: km => `${km} km`,
	m: m => `${m} m`,
	distance: km => `distance ${km} km`,
	ground: (m, trees) => `ground ${m} m${trees ? ` + ${trees} m trees` : ''}`,
	building: (m, estimated) => `building ${m} m${estimated ? ' (height unknown, assumed)' : ''}`,
	los: m => `line of sight ${m} m above the ground`,
	clearance: m => `clearance ${m} m`,
	number: (n, digits = 0) => n.toFixed(digits),
};
const FONT = '11px Figtree, system-ui, sans-serif';
const MONO = '11px "JetBrains Mono", ui-monospace, monospace';
const POINT_RADIUS = 9;

// Heights along the path (m above sea level, with the earth's bulge) for antenna heights a and b:
// { x (m), bulge, ground, trees, buildings, estimated (building height is a guess),
// top (ground + the higher of trees and buildings), los, fresnel (first zone radius) } per sample
export function getProfileLines(result, heightA, heightB) {
	const { elevations, trees, buildings, buildingsEstimated, stepLength, distance, wavelength, refractionK } = result;
	const last = elevations.length - 1;
	const losA = elevations[0] + heightA, losB = elevations[last] + heightB;
	const samples = [];
	for(let i = 0; i <= last; i++) {
		const x = i * stepLength;
		const bulge = x * (distance - x) / (2 * refractionK * EARTH_RADIUS);
		const ground = elevations[i] + bulge;
		samples.push({
			x,
			bulge,
			ground,
			trees: trees[i],
			buildings: buildings[i],
			estimated: buildingsEstimated[i] === 1,
			top: ground + Math.max(trees[i], buildings[i]),
			los: losA + (losB - losA) * x / distance,
			fresnel: Math.sqrt(wavelength * x * (distance - x) / distance),
		});
	}
	return samples;
}

// How free the path is: the least free share of the first Fresnel zone (1: clear, 0: the line of
// sight touches the terrain, below 0: blocked), what that means and where it is tightest
export function getClearance(samples) {
	let worst = Infinity, index = 0;
	samples.forEach(({ top, los, fresnel }, i) => {
		if(fresnel > 0 && (los - top) / fresnel < worst) { worst = (los - top) / fresnel; index = i; }
	});
	const status = worst >= FRESNEL_CLEAR ? 'clear' : worst >= 0 ? 'fresnel' : 'blocked';
	// index: the sample where the path is tightest
	return { worst, status, index };
}

function niceStep(range, targetCount) {
	const raw = range / targetCount;
	const power = 10 ** Math.floor(Math.log10(raw));
	return [1, 2, 2.5, 5, 10].map(m => m * power).find(step => step >= raw);
}

// A 45° hatch in `color`, as a fill pattern
function hatch(ctx, color, ratio) {
	const size = Math.round(8 * ratio);
	const tile = document.createElement('canvas');
	tile.width = tile.height = size;
	const t = tile.getContext('2d');
	t.strokeStyle = color;
	t.lineWidth = Math.max(1, ratio);
	t.beginPath();
	for(const offset of [-size, 0, size]) {
		t.moveTo(offset, size);
		t.lineTo(offset + size, 0);
	}
	t.stroke();
	const pattern = ctx.createPattern(tile, 'repeat');
	pattern.setTransform?.(new DOMMatrix().scale(1 / ratio));
	return pattern;
}

// Draws the chart with `colors` (see DEFAULT_COLORS) and `labels` (DEFAULT_LABELS); `hover` is a
// sample index or null. Returns the sample index at a canvas x.
export function drawProfileChart(canvas, samples, { colors = DEFAULT_COLORS, labels = DEFAULT_LABELS, hover = null } = {}) {
	const theme = { ...DEFAULT_COLORS, ...colors };
	const label = { ...DEFAULT_LABELS, ...labels };
	const width = canvas.clientWidth, height = canvas.clientHeight;
	const ratio = devicePixelRatio;
	if(canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
	}
	const ctx = canvas.getContext('2d');
	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	ctx.fillStyle = theme.background;
	ctx.fillRect(0, 0, width, height);
	if(samples.length < 2) return () => null;

	const distance = samples.at(-1).x;
	let low = Infinity, high = -Infinity;
	for(const { ground, top, los, fresnel } of samples) {
		low = Math.min(low, ground);
		high = Math.max(high, top, los + fresnel);
	}
	const span = Math.max(20, high - low);
	low -= span * 0.05;
	high += span * 0.12;

	const plotWidth = width - PADDING.left - PADDING.right;
	const plotHeight = height - PADDING.top - PADDING.bottom;
	const toX = x => PADDING.left + x / distance * plotWidth;
	const toY = h => PADDING.top + (high - h) / (high - low) * plotHeight;

	ctx.save();
	ctx.beginPath();
	ctx.rect(PADDING.left, PADDING.top, plotWidth, plotHeight);
	ctx.clip();

	// elevation grid lines, bent by the earth's bulge like the terrain
	const elevationStep = niceStep(high - low, 5);
	const gridPoints = Array.from({ length: 41 }, (_, j) => samples[Math.round(j / 40 * (samples.length - 1))]);
	ctx.strokeStyle = theme.grid;
	ctx.lineWidth = 1;
	for(let h = Math.ceil((low - samples[samples.length >> 1].bulge) / elevationStep) * elevationStep; h <= high; h += elevationStep) {
		ctx.beginPath();
		for(const { x, bulge } of gridPoints) ctx.lineTo(toX(x), toY(h + bulge));
		ctx.stroke();
	}

	// Fresnel zone, hatched
	ctx.beginPath();
	samples.forEach(({ x, los, fresnel }) => ctx.lineTo(toX(x), toY(los + fresnel)));
	for(let i = samples.length - 1; i >= 0; i--) ctx.lineTo(toX(samples[i].x), toY(samples[i].los - samples[i].fresnel));
	ctx.closePath();
	ctx.fillStyle = hatch(ctx, theme.fresnel, ratio);
	ctx.fill();

	// trees, then the ground over them
	ctx.beginPath();
	ctx.moveTo(toX(0), toY(low));
	samples.forEach(({ x, ground, trees }) => ctx.lineTo(toX(x), toY(ground + trees)));
	ctx.lineTo(toX(distance), toY(low));
	ctx.fillStyle = theme.trees;
	ctx.fill();
	// each building as a block (a filled line would turn narrow buildings into spikes)
	const halfStep = samples.length > 1 ? (samples[1].x - samples[0].x) / 2 : 0;
	ctx.fillStyle = theme.buildings;
	ctx.beginPath();
	for(const { x, ground, buildings } of samples) {
		if(buildings <= 0) continue;
		const left = toX(Math.max(0, x - halfStep)), right = toX(Math.min(distance, x + halfStep));
		const top = toY(ground + buildings);
		ctx.rect(left, top, Math.max(1, right - left), toY(low) - top);
	}
	ctx.fill();
	ctx.beginPath();
	ctx.moveTo(toX(0), toY(low));
	samples.forEach(({ x, ground }) => ctx.lineTo(toX(x), toY(ground)));
	ctx.lineTo(toX(distance), toY(low));
	ctx.fillStyle = theme.terrain;
	ctx.fill();
	ctx.beginPath();
	samples.forEach(({ x, ground }) => ctx.lineTo(toX(x), toY(ground)));
	ctx.strokeStyle = theme.terrainEdge;
	ctx.lineWidth = 1.2;
	ctx.stroke();

	// where the terrain (or trees) cuts the line of sight
	ctx.strokeStyle = theme.blocked;
	ctx.lineWidth = 2.5;
	ctx.beginPath();
	let drawing = false;
	for(const { x, top, los } of samples) {
		if(top > los) {
			if(!drawing) ctx.moveTo(toX(x), toY(top));
			else ctx.lineTo(toX(x), toY(top));
			drawing = true;
		} else {
			drawing = false;
		}
	}
	ctx.stroke();

	// line of sight between the antennas, in the result colour
	const first = samples[0], last = samples.at(-1);
	ctx.strokeStyle = theme.los;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(toX(0), toY(first.los));
	ctx.lineTo(toX(distance), toY(last.los));
	ctx.stroke();
	ctx.restore();

	// masts: a line from the ground up to the antenna, ending in the A / B disc
	ctx.strokeStyle = theme.mast;
	ctx.lineWidth = 2;
	const masts = [[toX(0) + 1, first, 'A'], [toX(distance) - 1, last, 'B']];
	ctx.beginPath();
	for(const [mx, sample] of masts) {
		ctx.moveTo(mx, Math.min(toY(sample.ground), PADDING.top + plotHeight));
		ctx.lineTo(mx, toY(sample.los));
	}
	ctx.stroke();
	for(const [mx, sample, letter] of masts) {
		const cy = Math.max(POINT_RADIUS + 1, toY(sample.los));
		ctx.beginPath();
		ctx.arc(mx, cy, POINT_RADIUS, 0, Math.PI * 2);
		ctx.fillStyle = theme.point;
		ctx.fill();
		ctx.strokeStyle = theme.mast;
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.fillStyle = theme.pointText;
		ctx.font = `700 ${FONT}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(letter, mx, cy + 0.5);
	}

	// axes
	ctx.fillStyle = theme.text;
	ctx.font = FONT;
	ctx.textAlign = 'right';
	ctx.textBaseline = 'middle';
	for(let h = Math.ceil(low / elevationStep) * elevationStep; h <= high; h += elevationStep) {
		ctx.fillText(label.m(label.number(Math.round(h))), PADDING.left - 5, toY(h));
	}
	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';
	const kmStep = niceStep(distance / 1000, Math.max(2, Math.floor(plotWidth / 70)));
	for(let km = 0; km <= distance / 1000 + 1e-9; km += kmStep) {
		const digits = kmStep < 1 ? (String(kmStep).split('.')[1]?.length ?? 1) : 0;
		ctx.fillText(km === 0 ? '0' : label.km(label.number(km, digits)), toX(km * 1000), height - PADDING.bottom + 5);
	}

	// hovered spot: a crosshair and a tooltip
	if(hover !== null && samples[hover]) {
		const { x, bulge, ground, trees, buildings, estimated, top, los } = samples[hover];
		ctx.strokeStyle = theme.hover;
		ctx.lineWidth = 1;
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(toX(x), PADDING.top);
		ctx.lineTo(toX(x), PADDING.top + plotHeight);
		ctx.moveTo(PADDING.left, toY(los));
		ctx.lineTo(PADDING.left + plotWidth, toY(los));
		ctx.stroke();
		ctx.setLineDash([]);

		const lines = [
			label.distance(label.number(x / 1000, 2)),
			label.ground(label.number(Math.round(ground - bulge)), trees > 0.5 ? label.number(Math.round(trees)) : 0),
			...(buildings > 0 ? [label.building(label.number(Math.round(buildings)), estimated)] : []),
			label.los(label.number(Math.round(los - ground))),
			label.clearance(label.number(Math.round(los - top))),
		];
		ctx.font = MONO;
		const boxWidth = Math.max(...lines.map(line => ctx.measureText(line).width)) + 12;
		const boxHeight = lines.length * 15 + 8;
		let boxX = toX(x) + 8;
		if(boxX + boxWidth > width - 4) boxX = toX(x) - 8 - boxWidth;
		ctx.fillStyle = theme.tooltip;
		ctx.strokeStyle = theme.grid;
		ctx.beginPath();
		if(ctx.roundRect) ctx.roundRect(boxX, PADDING.top + 4, boxWidth, boxHeight, 6);
		else ctx.rect(boxX, PADDING.top + 4, boxWidth, boxHeight);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = theme.tooltipText;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		lines.forEach((line, i) => ctx.fillText(line, boxX + 6, PADDING.top + 8 + i * 15));
	}

	return canvasX => {
		const share = (canvasX - PADDING.left) / plotWidth;
		if(share < 0 || share > 1) return null;
		return Math.round(share * (samples.length - 1));
	};
}
