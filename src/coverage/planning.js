// Adapted from map.meshcore.io (https://github.com/meshcore-dev/map.meshcore.io), MIT License,
// Copyright (c) 2025 Rastislav Vysoky. See LICENSE in this folder.
// The coverage and profile tools of the map page: the panels (a Vue app of their own, template in
// panels.html, compiled by `npm run build:map`) and their marks on the Leaflet map. Rewritten here for
// Leaflet and the #BEmesh map from upstream's app.js / map.js; the model is coverage-model.js.
// Loaded by src/map.js only when someone opens a tool: startPlanning(host) once, then its actions.
import {
	computed, createApp, nextTick, reactive, ref, shallowRef, watch,
} from '../../lib/vue.runtime.esm-browser.prod.js';
import {
	AUTO_PRESET, BAND_RADIO, BEMESH_PRESET_NAME, BUILDINGS_MAX_DISTANCE, COVERAGE_OPTIONS, COVERAGE_SLIDERS, FADE_MARGIN_DB,
	RECEIVER, applyCoverageSettings, computeCoverage, computeLinkProfile, cornersToLatLngBounds, decodeHeights, decodeSite,
	encodeCoverageSettings, encodeSite, getCoverageBounds, getCoverageRadio, getLinkBars, getLocalRadioParams, getSensitivity,
	hasSameRadio, releaseCoverage, sanitizeSettings,
} from './coverage.js';
import { drawProfileChart, getClearance, getProfileLines } from './profile-chart.js';
import { addProfileEnd, closeProfile, createProfileState, sameEnds, setProfileStart, swapProfileEnds } from './profile.js';
import { render } from './panels.render.js';
import { SettingSlider } from './setting-slider.js';

const SETTINGS_KEY = 'bemesh.coverage.settings';
const PRESET_KEY = 'bemesh.coverage.preset';
// repeaters and room servers are usually on roofs and masts, above the clutter
const ELEVATED_TYPES = new Set([2, 3]);
// the coverage image: one opacity per link margin step (dB above the fade margin)
export const COVERAGE_STEPS = [0, 10, 20, 30];
// icons of the link quality (1-3 bars) and of a profile's result
const BAR_ICONS = { 1: 'bi-reception-1', 2: 'bi-reception-3', 3: 'bi-reception-4' };
const RESULT_ICONS = { clear: 'bi-check-lg', fresnel: 'bi-exclamation-lg', blocked: 'bi-x-lg', unchecked: 'bi-info-lg' };
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// A long name cut in the middle, at most `max` characters: "Test RPT Gent-Noord" → "Test RPT…Noord"
export function middleCut(name, max) {
	const chars = [...String(name)];
	if(chars.length <= max) return chars.join('');
	const head = Math.ceil((max - 1) * 0.6), tail = max - 1 - head;
	return `${chars.slice(0, head).join('').trimEnd()}…${chars.slice(-tail).join('').trimStart()}`;
}

export function compassPoint(bearing) {
	return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

function storageGet(key) {
	try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
	try { localStorage.setItem(key, value); } catch {}
}

// The tool's texts (src/shared/i18n/coverage.<lang>.json), added to the page's translations
async function loadTexts(i18n) {
	const langs = i18n.lang === 'en' ? ['en'] : ['en', i18n.lang];
	await Promise.all(langs.map(async lang => {
		try {
			const res = await fetch(new URL(`../shared/i18n/coverage.${lang}.json`, import.meta.url));
			if(res.ok) i18n.add(lang, await res.json());
		} catch(e) {
			console.warn('Coverage texts', lang, e);
		}
	}));
}

function loadStyles() {
	if(document.querySelector('link[data-planning-css]')) return Promise.resolve();
	return new Promise(resolve => {
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = new URL('../../css/planning.css', import.meta.url).href;
		link.dataset.planningCss = '';
		link.onload = link.onerror = () => resolve();
		document.head.append(link);
	});
}

// "r g b" or "rgb(r, g, b)" of a CSS colour, as [r, g, b]
function cssRgb(probe, value) {
	probe.style.color = '';
	probe.style.color = value;
	const match = getComputedStyle(probe).color.match(/[\d.]+/g);
	return match ? match.slice(0, 3).map(Number) : [26, 32, 44];
}

let started = null;

export async function startPlanning(host) {
	started ??= start(host);
	return started;
}

async function start(host) {
	const { map, L, i18n } = host;
	await Promise.all([loadTexts(i18n), loadStyles()]);
	const t = i18n.t;
	const num = (n, digits = 0, min = 0) => i18n.number(n, { maximumFractionDigits: digits, minimumFractionDigits: min });

	// --- panes: the coverage image under the node markers, the planning marks over them ---
	map.createPane('planCoverage').style.zIndex = 350;
	map.createPane('planLines').style.zIndex = 450;
	map.createPane('planMarks').style.zIndex = 650;
	for(const pane of ['planCoverage', 'planLines']) map.getPane(pane).style.pointerEvents = 'none';

	const root = document.createElement('div');
	root.id = 'planning';
	document.body.append(root);
	// a probe for CSS colours (custom properties of the panel's theme)
	const probe = document.createElement('span');
	probe.hidden = true;
	root.before(probe);
	const cssVar = name => getComputedStyle(document.body).getPropertyValue(name).trim();

	// --- state ---
	const coverage = reactive({
		publicKey: null,
		point: null,
		name: '',
		settings: sanitizeSettings(storageGet(SETTINGS_KEY)),
		radioPreset: storageGet(PRESET_KEY) || BEMESH_PRESET_NAME,
		radio: null,
		linkCounts: null,
		loading: false,
		error: '',
	});
	const profile = reactive(createProfileState());
	// sheet: the one a phone shows when both tools are open; coverageMore: the coverage panel's rest on a
	// desktop, folded away while the profile is open
	const ui = reactive({ settingsOpen: false, dark: host.isDark(), lang: i18n.lang, phone: false, sheet: 'coverage', coverageMore: false });
	watch(() => ({ ...coverage.settings }), s => storageSet(SETTINGS_KEY, JSON.stringify(s)));
	watch(() => coverage.radioPreset, p => storageSet(PRESET_KEY, p));
	// the popup's profile links read the ends
	watch(() => [profile.a, profile.b], ([a, b]) => { host.ends.a = a; host.ends.b = b; }, { immediate: true });

	const phoneQuery = matchMedia('(max-width: 600px)');
	ui.phone = phoneQuery.matches;
	phoneQuery.addEventListener?.('change', e => { ui.phone = e.matches; });
	new MutationObserver(() => { ui.dark = host.isDark(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { ui.dark = host.isDark(); });

	// --- nodes ---
	const nodesByKey = computed(() => {
		const byKey = new Map();
		for(const node of host.nodes() ?? []) {
			if(node.adv_lat == null || node.adv_lon == null || !node.public_key) continue;
			byKey.set(String(node.public_key).toLowerCase(), node);
		}
		return byKey;
	});
	const siteOf = node => ({
		lat: node.adv_lat, lon: node.adv_lon, adv_name: node.adv_name || node.public_key.slice(0, 8),
		params: node.params, type: Number(node.type), publicKey: String(node.public_key).toLowerCase(), node,
	});
	const radioNodes = computed(() => [...nodesByKey.value.values()].map(node => ({ lat: node.adv_lat, lon: node.adv_lon, type: Number(node.type), params: node.params })));

	// --- radio presets for picked points: ours, #BEmesh first ---
	const presets = computed(() => {
		const list = (host.presets() ?? []).filter(p => Number.isFinite(Number(p.freq)) && Number(p.bw) > 0 && Number(p.sf) >= 5);
		const own = list.find(p => p.name === BEMESH_PRESET_NAME);
		return [...(own ? [own] : []), ...list.filter(p => p !== own)].map(p => ({
			name: p.name, radio: { freq: Number(p.freq), bw: Number(p.bw), sf: Number(p.sf) },
		}));
	});
	const selectedPreset = computed(() => presets.value.find(p => p.name === coverage.radioPreset) ?? null);
	// a preset brings its band along
	watch(selectedPreset, preset => {
		if(preset) coverage.settings.frequency = preset.radio.freq < 600 ? 433 : 868;
	});
	const pointLabel = ({ lat, lon }) => t('cov.point', { lat: num(lat, 5, 5), lon: num(lon, 5, 5) });
	// A picked point as a site: the chosen preset, or the radio of the repeaters around it
	function pointSite(point, settings = coverage.settings) {
		const local = coverage.radioPreset === AUTO_PRESET ? getLocalRadioParams(point.lat, point.lon, radioNodes.value, settings) : null;
		return {
			lat: point.lat, lon: point.lon, adv_name: pointLabel(point),
			params: selectedPreset.value?.radio ?? local ?? BAND_RADIO[settings.frequency], isPoint: true,
		};
	}
	const presetName = radio => {
		const match = presets.value.find(p => p.radio.freq === radio.freq && p.radio.bw === radio.bw && p.radio.sf === radio.sf);
		return match ? (match.name === BEMESH_PRESET_NAME ? t('cov.bemeshPreset') : match.name) : t('cov.customRadio');
	};

	// --- the coverage image and its lines ---
	const layers = { image: null, circle: null, direction: null, badges: L.layerGroup() };
	let coverageResult = null;
	const coverageSite = shallowRef(null);

	function coverageStyle() {
		const alphas = cssVar('--plan-veil-alphas').split(/[\s,]+/).map(Number).filter(Number.isFinite);
		return {
			rgb: cssRgb(probe, cssVar('--plan-veil') || '#a21caf'),
			steps: COVERAGE_STEPS,
			alphas: alphas.length === COVERAGE_STEPS.length ? alphas : [0.18, 0.32, 0.46, 0.6],
			edge: true,
		};
	}

	function destination([lon, lat], bearing, meters) {
		// web mercator keeps angles: the line goes straight on the map, like the estimate's rays
		const origin = L.Projection.SphericalMercator.project(L.latLng(lat, lon));
		const scale = 1 / Math.cos(lat * Math.PI / 180);
		const radians = bearing * Math.PI / 180;
		return L.Projection.SphericalMercator.unproject(L.point(origin.x + Math.sin(radians) * meters * scale, origin.y + Math.cos(radians) * meters * scale));
	}

	function drawCoverage(result) {
		for(const key of ['image', 'circle', 'direction']) {
			layers[key]?.remove();
			layers[key] = null;
		}
		if(!result) return;
		layers.image = L.imageOverlay(result.url, cornersToLatLngBounds(result.coordinates), {
			pane: 'planCoverage', interactive: false, className: 'plan-coverage-image',
		}).addTo(map);
		const { center, radius, bearing } = result.lines;
		layers.circle = L.circle([center[1], center[0]], {
			radius, pane: 'planLines', interactive: false, fill: false, className: 'plan-reach-edge', weight: 2, dashArray: '6 4',
		}).addTo(map);
		if(bearing !== null) {
			layers.direction = L.polyline([[center[1], center[0]], destination(center, bearing, radius)], {
				pane: 'planLines', interactive: false, className: 'plan-reach-edge', weight: 2, dashArray: '6 4',
			}).addTo(map);
		}
	}

	function setCoverageResult(result, site) {
		const previous = coverageResult;
		coverageResult = result;
		coverageSite.value = site;
		drawCoverage(result);
		if(previous !== result) releaseCoverage(previous);
		updateLinks();
	}

	// nodes in reach (same radio settings): [{ node, bars }], null without an estimate
	const reachable = shallowRef(null);
	function updateLinks() {
		if(!coverageResult) {
			reachable.value = null;
			coverage.linkCounts = null;
			return;
		}
		const links = [];
		const counts = { 1: 0, 2: 0, 3: 0 };
		for(const node of host.shownNodes() ?? []) {
			if(node === coverageSite.value?.node || node.adv_lat == null || !hasSameRadio(node, coverageResult.radio)) continue;
			const margin = coverageResult.marginAt(node.adv_lon, node.adv_lat, { clutter: !ELEVATED_TYPES.has(Number(node.type)) });
			const bars = margin === null ? 0 : getLinkBars(margin);
			if(!bars) continue;
			links.push({ node, bars });
			counts[bars]++;
		}
		reachable.value = links;
		coverage.linkCounts = counts;
	}
	watch(() => host.shownNodes(), updateLinks);

	// "reachable only": the node and the nodes in its reach, each with its link quality
	const reachableOnly = computed(() => reachable.value !== null && coverage.settings.nodeDisplay === 'reachable');
	watch([reachable, reachableOnly], ([links, only]) => {
		const site = coverageSite.value;
		host.showOnly(only ? [...(site?.node ? [site.node] : []), ...links.map(link => link.node)] : null);
		layers.badges.clearLayers();
		for(const { node, bars } of links ?? []) {
			const word = t(`cov.bars.${bars}`);
			L.marker([node.adv_lat, node.adv_lon], {
				pane: 'planMarks', interactive: false, keyboard: false,
				icon: L.divIcon({
					className: `plan-badge plan-badge--${bars}`,
					html: `<i class="bi ${BAR_ICONS[bars]}" aria-hidden="true"></i><span class="plan-sr">${word}</span>`,
					iconSize: [18, 18],
					iconAnchor: [-5, 23],
				}),
			}).addTo(layers.badges);
		}
		if(links?.length) layers.badges.addTo(map);
		else layers.badges.remove();
	});

	const settingsOpen = computed(() => ui.settingsOpen);
	let coverageRequest = 0;
	// set while a dragged point gets its new position: the map stays where it is
	let keepView = false;

	watch(
		// the display mode doesn't change the estimate; the theme changes its colour
		[() => coverage.publicKey, () => coverage.point, () => { const { nodeDisplay, ...s } = coverage.settings; return s; }, selectedPreset, () => ui.dark, nodesByKey],
		async ([publicKey, point, settings], [previousKey, previousPoint, previousSettings] = []) => {
			const request = ++coverageRequest;
			const node = publicKey ? nodesByKey.value.get(publicKey) : null;
			const site = node ? siteOf(node) : point ? pointSite(point, settings) : null;
			if(!site) {
				setCoverageResult(null, null);
				// a node that isn't (yet) on the map: wait for the nodes, or close
				if(publicKey && nodesByKey.value.size) closeCoverage();
				return;
			}
			coverage.name = site.adv_name;
			// (a plain object for the worker: the reactive copy can't be posted)
			const radio = getCoverageRadio(site, settings);
			coverage.radio = radio;
			const moved = publicKey !== previousKey || (point !== previousPoint && !keepView);
			if(moved || settings.distanceKm !== previousSettings?.distanceKm) {
				host.closePopup();
				await nextTick();
				fitCoverage(site, settings.distanceKm);
			}
			coverage.loading = true;
			coverage.error = '';
			try {
				const result = await computeCoverage(site, settings, radio, coverageStyle());
				if(request !== coverageRequest) {
					releaseCoverage(result);
					return;
				}
				console.debug('coverage', JSON.stringify(result.stats));
				setCoverageResult(result, site);
				if(result.incomplete) coverage.error = t('cov.incomplete');
			} catch(e) {
				if(request !== coverageRequest) return;
				console.error(e);
				setCoverageResult(null, null);
				coverage.error = t('cov.failed', { error: e.message });
			} finally {
				if(request === coverageRequest) coverage.loading = false;
			}
		},
		{ deep: false },
	);

	// room for the search box and coverage panel above, the profile panel below
	// The space the panels take from the map (px from its edges). The map may run under the top bar;
	// #planning covers the part below it. The profile panel counts at its full size (with its chart),
	// which it only reaches after the computation. With both tools open on a desktop, the coverage goes
	// to the right of its panel.
	function panelSpace({ forCoverage }) {
		const c = map.getContainer().getBoundingClientRect();
		const r = root.getBoundingClientRect();
		const above = r.top - c.top, below = c.bottom - r.bottom, h = r.height;
		const panel = root.querySelector('.plan-coverage')?.getBoundingClientRect();
		if(ui.phone) {
			const sheets = Math.max(profile.a ? h * 0.62 : 0, panel ? Math.min(h * 0.62, r.bottom - panel.top) : 0);
			return { top: above + 60, bottom: below + sheets + 10, left: 20 };
		}
		const profileHeight = profile.a ? Math.min(h * 0.6, 470) + 20 : 20;
		if(forCoverage && panel && !profile.a) return { top: above + Math.min(panel.bottom - r.top + 10, h * 0.45), bottom: below + 20, left: 20 };
		const left = forCoverage && panel ? panel.right - c.left + 10 : 20;
		return { top: above + 60, bottom: below + profileHeight, left };
	}

	function fitCoverage(site, distanceKm) {
		const [[w, s], [e, n]] = getCoverageBounds(site.lon, site.lat, distanceKm);
		fitPadded([[s, w], [n, e]], panelSpace({ forCoverage: true }));
	}

	// fitBounds, keeping at least MIN_VIEW px of the map free between the panels (less padding first
	// at the top, then at the bottom): paddings past the map's size would zoom out to the world
	const MIN_VIEW = 160;
	function fitPadded(bounds, { top, bottom, left = 20, side = 20, maxZoom }) {
		// Leaflet's size can be stale after the page settled (a phone's toolbars): measure it again
		map.invalidateSize({ animate: false, pan: false });
		const height = map.getSize().y;
		let extra = top + bottom + MIN_VIEW - height;
		if(extra > 0) { const cut = Math.min(extra, Math.max(0, top - 20)); top -= cut; extra -= cut; }
		if(extra > 0) bottom = Math.max(20, bottom - extra);
		left = Math.min(Math.max(left, side), map.getSize().x - side - MIN_VIEW);
		map.fitBounds(bounds, { paddingTopLeft: [left, top], paddingBottomRight: [side, bottom], animate: false, ...(maxZoom ? { maxZoom } : {}) });
	}

	function closeCoverage() {
		coverage.publicKey = null;
		coverage.point = null;
		coverage.linkCounts = null;
		coverage.loading = false;
		coverage.error = '';
		ui.settingsOpen = false;
	}

	// --- profile ---
	function resolveEnd(end) {
		if(!end) return null;
		if(end.publicKey) {
			const node = nodesByKey.value.get(end.publicKey);
			return node ? siteOf(node) : null;
		}
		return pointSite(end);
	}
	const profileEnds = computed(() => [resolveEnd(profile.a), resolveEnd(profile.b)]);
	const profileUsesPreset = computed(() => profileEnds.value.every(end => !end || end.isPoint));
	const profileView = shallowRef(null);
	const profileHover = ref(null);
	let profileRequest = 0;

	function profileRadio(ends, settings) {
		const node = ends.find(end => end && !end.isPoint && end.params) ?? ends.find(end => end?.params) ?? ends[0];
		return getCoverageRadio(node, settings);
	}

	watch(
		[profileEnds, () => profile.heightA, () => profile.heightB, () => { const { nodeDisplay, distanceKm, ...s } = coverage.settings; return s; }],
		async ([[a, b], heightA, heightB, settings], [previousEnds] = []) => {
			const request = ++profileRequest;
			profileHover.value = null;
			if(!a || !b) {
				profileView.value = null;
				profile.loading = false;
				profile.error = '';
				return;
			}
			if(sameEnds(profile.a, profile.b) || (a.lat === b.lat && a.lon === b.lon)) {
				profileView.value = null;
				profile.loading = false;
				profile.error = t('prof.samePlace');
				return;
			}
			const endsChanged = !sameSpot(a, previousEnds?.[0]) || !sameSpot(b, previousEnds?.[1]);
			if(endsChanged && !keepView) {
				host.closePopup();
				await nextTick();
				fitPadded([[Math.min(a.lat, b.lat), Math.min(a.lon, b.lon)], [Math.max(a.lat, b.lat), Math.max(a.lon, b.lon)]], {
					...panelSpace({ forCoverage: false }), side: 40, maxZoom: 14,
				});
			}
			const radio = profileRadio([a, b], settings);
			profile.loading = true;
			profile.error = '';
			try {
				const result = await computeLinkProfile(
					{ lat: a.lat, lon: a.lon, height: heightA },
					{ lat: b.lat, lon: b.lon, height: heightB },
					settings, radio,
				);
				if(request !== profileRequest) return;
				console.debug('profile', JSON.stringify(result.stats));
				const samples = getProfileLines(result, heightA, heightB);
				profileView.value = {
					result, samples, clearance: getClearance(samples), radio,
					heights: [heightA, heightB], bars: getLinkBars(result.margin),
					sensitivity: Math.round(getSensitivity(radio)),
				};
				if(result.incomplete) profile.error = t('prof.incomplete');
			} catch(e) {
				if(request !== profileRequest) return;
				console.error(e);
				profileView.value = null;
				profile.error = /same place/.test(e.message) ? t('prof.samePlace') : t('prof.failed', { error: e.message });
			} finally {
				if(request === profileRequest) profile.loading = false;
			}
		},
	);
	const sameSpot = (a, b) => !!a && !!b && a.lat === b.lat && a.lon === b.lon;

	// the result in words and colour: clear / partly obstructed / blocked, or not fully checked
	const profileStatus = computed(() => {
		const view = profileView.value;
		if(!view) return null;
		if(view.result.incomplete) return 'unchecked';
		return view.clearance.status;
	});

	// the profile panel's height, so the coverage panel above it stays clear of it (CSS --plan-profile-h)
	const profileResize = new ResizeObserver(([entry]) => {
		root.style.setProperty('--plan-profile-h', `${Math.ceil(entry.target.getBoundingClientRect().height)}px`);
	});
	watch(() => Boolean(profile.a), open => nextTick(() => {
		profileResize.disconnect();
		const panel = root.querySelector('.plan-profile');
		if(open && panel) profileResize.observe(panel);
		else root.style.removeProperty('--plan-profile-h');
	}));

	// --- the chart ---
	const chartColors = () => ({
		background: cssVar('--plan-chart-bg'),
		grid: cssVar('--plan-chart-grid'),
		text: cssVar('--plan-chart-text'),
		terrain: cssVar('--plan-chart-terrain'),
		terrainEdge: cssVar('--plan-chart-terrain-edge'),
		trees: cssVar('--plan-chart-trees'),
		buildings: cssVar('--plan-chart-buildings'),
		fresnel: cssVar('--plan-chart-fresnel'),
		los: cssVar(`--plan-result-${profileStatus.value ?? 'unchecked'}`),
		blocked: cssVar('--plan-chart-blocks'),
		mast: cssVar('--plan-rim'),
		point: cssVar(`--plan-result-${profileStatus.value ?? 'unchecked'}`),
		pointText: cssVar('--plan-point-text'),
		hover: cssVar('--plan-rim'),
		tooltip: cssVar('--plan-chart-tooltip'),
		tooltipText: cssVar('--plan-chart-text-strong'),
	});
	const chartLabels = () => ({
		km: km => `${km} km`,
		m: m => `${m} m`,
		number: (n, digits = 0) => num(n, digits, digits),
		distance: km => t('prof.tip.distance', { km }),
		ground: (m, trees) => (trees ? t('prof.tip.groundTrees', { m, trees }) : t('prof.tip.ground', { m })),
		building: (m, estimated) => t(estimated ? 'prof.tip.buildingGuess' : 'prof.tip.building', { m }),
		los: m => t('prof.tip.los', { m }),
		clearance: m => t('prof.tip.clearance', { m }),
	});
	const profileCanvas = ref(null);
	let chartHitTest = () => null;
	function drawChart() {
		const canvas = profileCanvas.value;
		if(!canvas || !profileView.value) return;
		chartHitTest = drawProfileChart(canvas, profileView.value.samples, { colors: chartColors(), labels: chartLabels(), hover: profileHover.value });
	}
	watch([profileView, profileHover, () => ui.dark, profileCanvas], () => nextTick(drawChart));
	const chartResize = new ResizeObserver(() => drawChart());
	watch(profileCanvas, (canvas, previous) => {
		if(previous) chartResize.unobserve(previous);
		if(canvas) chartResize.observe(canvas);
	});
	function onChartPointer(ev) {
		const rect = ev.currentTarget.getBoundingClientRect();
		profileHover.value = chartHitTest(ev.clientX - rect.left);
	}
	function onChartLeave(ev) {
		// a tap on a phone keeps its tooltip
		if(ev.pointerType !== 'touch') profileHover.value = null;
	}

	// --- marks on the map: the coverage point, the profile ends and the line between them ---
	const marks = { line: null, outline: null, result: null, hover: null, points: new Map() };
	function pointIcon(label, status) {
		return L.divIcon({
			className: `plan-point plan-point--${status}${label ? '' : ' plan-point--site'}`,
			html: `<span class="plan-point__disc">${label}</span>`,
			iconSize: [44, 44],
			iconAnchor: [22, 22],
		});
	}
	function getDraggableEnd(label) {
		if(label === 'A') return profile.a?.publicKey ? null : profile.a;
		if(label === 'B') return profile.b?.publicKey ? null : profile.b;
		return coverage.point;
	}
	function placePoint(label, latlng, status) {
		let marker = marks.points.get(label);
		if(!latlng) {
			marker?.remove();
			marks.points.delete(label);
			return;
		}
		const draggable = Boolean(getDraggableEnd(label));
		const title = label ? t('prof.end', { end: label }) : t('cov.pointMark');
		if(!marker) {
			marker = L.marker(latlng, { pane: 'planMarks', icon: pointIcon(label, status), draggable, title, alt: title, riseOnHover: true }).addTo(map);
			marker.on('dragend', () => {
				const { lat, lng } = marker.getLatLng();
				const end = { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(L.Util.wrapNum(lng, [-180, 180], true) * 1e5) / 1e5 };
				keepView = true;
				if(label === 'A') profile.a = end;
				else if(label === 'B') profile.b = end;
				else coverage.point = end;
				nextTick(() => { keepView = false; });
			});
			marks.points.set(label, marker);
		} else {
			marker.setLatLng(latlng);
			marker.setIcon(pointIcon(label, status));
			if(draggable) marker.dragging?.enable();
			else marker.dragging?.disable();
		}
	}
	function interpolate(a, b, share) {
		const pa = map.options.crs.latLngToPoint(L.latLng(a), 0), pb = map.options.crs.latLngToPoint(L.latLng(b), 0);
		return map.options.crs.pointToLatLng(L.point(pa.x + (pb.x - pa.x) * share, pa.y + (pb.y - pa.y) * share), 0);
	}
	watch(
		[() => coverage.point, profileEnds, profileHover, profileView, profileStatus],
		([point, [a, b], hover, view, status]) => {
			const state = status ?? 'pending';
			placePoint('', point ? [point.lat, point.lon] : null, 'pending');
			placePoint('A', a ? [a.lat, a.lon] : null, b ? state : 'pending');
			placePoint('B', b ? [b.lat, b.lon] : null, state);
			for(const key of ['line', 'outline', 'result', 'hover']) {
				marks[key]?.remove();
				marks[key] = null;
			}
			if(!a || !b) return;
			const line = [[a.lat, a.lon], [b.lat, b.lon]];
			marks.outline = L.polyline(line, { pane: 'planLines', interactive: false, weight: 5, lineCap: 'round', className: 'plan-line-outline' }).addTo(map);
			marks.line = L.polyline(line, {
				pane: 'planLines', interactive: false, weight: 3, lineCap: 'round',
				dashArray: view ? null : '8 6', className: `plan-line plan-line--${state}`,
			}).addTo(map);
			if(view) {
				const icon = RESULT_ICONS[state];
				const at = interpolate(line[0], line[1], view.clearance.index / (view.samples.length - 1));
				marks.result = L.marker(at, {
					pane: 'planMarks', interactive: false, keyboard: false,
					icon: L.divIcon({ className: `plan-result plan-result--${state}`, html: `<i class="bi ${icon}" aria-hidden="true"></i>`, iconSize: [20, 20], iconAnchor: [10, 10] }),
				}).addTo(map);
				if(hover !== null) {
					marks.hover = L.circleMarker(interpolate(line[0], line[1], hover / (view.samples.length - 1)), {
						pane: 'planMarks', interactive: false, radius: 6, weight: 3, className: 'plan-hover', fillOpacity: 1,
					}).addTo(map);
				}
			}
		},
	);

	// --- turn handle of a directional antenna: on the coverage site, or on the profile's A end ---
	const handle = { marker: null, site: null };
	const ARM = 64;
	function handlePosition(site, bearing) {
		const center = map.latLngToContainerPoint(site);
		const radians = bearing * Math.PI / 180;
		return map.containerPointToLatLng(center.add(L.point(Math.sin(radians) * ARM, -Math.cos(radians) * ARM)));
	}
	function handleIcon(bearing) {
		return L.divIcon({
			className: 'plan-knob',
			html: `<span class="plan-knob__disc"><i class="bi bi-arrow-repeat" aria-hidden="true"></i></span><span class="plan-knob__label">${bearing}° ${compassPoint(bearing)}</span>`,
			iconSize: [44, 44],
			iconAnchor: [22, 22],
		});
	}
	function updateHandle() {
		const site = handle.site;
		const direction = coverage.settings.direction;
		if(!site || coverage.settings.antennaType === 'omni') {
			handle.marker?.remove();
			handle.marker = null;
			return;
		}
		const at = handlePosition(site, direction);
		if(!handle.marker) {
			handle.marker = L.marker(at, { pane: 'planMarks', draggable: true, icon: handleIcon(direction), title: t('cov.turn'), alt: t('cov.turn') }).addTo(map);
			const bearingOf = latlng => {
				const c = map.latLngToContainerPoint(handle.site), p = map.latLngToContainerPoint(latlng);
				return Math.round(Math.atan2(p.x - c.x, c.y - p.y) * 180 / Math.PI + 360) % 360;
			};
			handle.marker.on('drag', () => handle.marker.setIcon(handleIcon(bearingOf(handle.marker.getLatLng()))));
			handle.marker.on('dragend', () => {
				coverage.settings.direction = bearingOf(handle.marker.getLatLng());
				updateHandle();
			});
			handle.marker.on('add', () => {
				handle.marker.getElement()?.addEventListener('keydown', ev => {
					const turn = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[ev.key];
					if(!turn) return;
					ev.preventDefault();
					coverage.settings.direction = (coverage.settings.direction + turn * (ev.shiftKey ? 15 : 1) + 360) % 360;
				});
			});
		} else if(!handle.marker.dragging?.moved?.()) {
			handle.marker.setLatLng(at);
			handle.marker.setIcon(handleIcon(direction));
		}
	}
	watch(
		[() => coverage.settings.antennaType, () => coverage.settings.direction, () => coverage.publicKey, () => coverage.point, profileEnds],
		([, , publicKey, point, [a]]) => {
			const node = publicKey ? nodesByKey.value.get(publicKey) : null;
			const site = node ? [node.adv_lat, node.adv_lon] : point ? [point.lat, point.lon] : a ? [a.lat, a.lon] : null;
			handle.site = site && L.latLng(site);
			updateHandle();
		},
	);
	map.on('zoomend moveend', updateHandle);

	// --- the URL: coverage and profile in it, so a shared link shows them too ---
	const setParam = (key, value) => {
		if(value === null || value === undefined || value === '') delete host.urlParams[key];
		else host.urlParams[key] = value;
	};
	watch(
		[
			() => coverage.publicKey ?? encodeSite(coverage.point), () => encodeSite(profile.a), () => encodeSite(profile.b),
			() => `${profile.heightA},${profile.heightB}`, () => encodeCoverageSettings(coverage.settings), () => coverage.radioPreset,
		],
		([site, a, b, heights, settings, preset]) => {
			const planning = Boolean(site || a);
			setParam('cov', site);
			setParam('pa', a);
			setParam('pb', a ? b : null);
			setParam('ph', a ? heights : null);
			setParam('covs', planning ? settings : null);
			setParam('preset', planning && preset !== BEMESH_PRESET_NAME ? preset : null);
		},
	);

	function applyShared(params) {
		if(params.covs) applyCoverageSettings(params.covs, coverage.settings);
		if(params.cov || params.pa) {
			const preset = String(params.preset ?? '');
			coverage.radioPreset = preset === AUTO_PRESET || presets.value.some(p => p.name === preset) ? preset : BEMESH_PRESET_NAME;
		}
		const [heightA, heightB] = decodeHeights(params.ph);
		if(heightA !== null) profile.heightA = heightA;
		if(heightB !== null) profile.heightB = heightB;
		const a = decodeSite(params.pa), b = decodeSite(params.pb);
		if(a) profile.a = a;
		if(a && b) profile.b = b;
		const site = decodeSite(params.cov);
		if(site?.publicKey) showCoverage(site.publicKey);
		else if(site) showPointCoverage(site.lat, site.lon);
		// both in the link: a phone shows the profile's sheet (after the watchers above have run)
		if(a && b) nextTick(() => { ui.sheet = 'profile'; });
	}

	// --- the actions the map calls ---
	// a new profile shows its sheet on a phone, a new coverage its own
	watch(() => profile.a, (a, previous) => { if(a && !previous) ui.sheet = 'profile'; });
	watch(() => profile.b, (b, previous) => { if(b && b !== previous) ui.sheet = 'profile'; });
	watch(() => [coverage.publicKey, coverage.point], ([key, point]) => { if(key || point) ui.sheet = 'coverage'; });

	function showCoverage(publicKey) {
		coverage.publicKey = String(publicKey).toLowerCase();
		coverage.point = null;
		coverage.error = '';
		host.closeFilters();
	}
	function showPointCoverage(lat, lon) {
		coverage.publicKey = null;
		coverage.point = { lat, lon };
		coverage.error = '';
		host.closeFilters();
	}

	// --- the settings popover (desktop): closed by Esc or a click outside ---
	document.addEventListener('pointerdown', ev => {
		if(!ui.settingsOpen || ui.phone) return;
		if(ev.target.closest?.('.plan-settings, .plan-chip')) return;
		ui.settingsOpen = false;
	}, true);
	document.addEventListener('keydown', ev => {
		if(ev.key === 'Escape' && ui.settingsOpen) {
			ui.settingsOpen = false;
			root.querySelector('.plan-chip')?.focus();
		}
	});

	// --- texts for the panels ---
	const unit = (value, u) => `${value} ${u}`;
	const summary = computed(() => {
		const s = coverage.settings;
		const parts = [
			unit(num(coverage.radio?.freq ?? s.frequency, 3), 'MHz'),
			unit(num(s.txPower), 'dBm'),
		];
		if(s.antennaType !== 'omni') parts.push(`${t(`cov.antenna.${s.antennaType}`)} ${s.direction}° ${compassPoint(s.direction)}`);
		parts.push(unit(num(s.antennaGain, 1), 'dBi'), unit(num(s.antennaHeight), 'm'), unit(num(s.distanceKm), 'km'));
		return parts;
	});
	const assumptions = computed(() => {
		const s = coverage.settings, radio = coverage.radio;
		if(!radio) return '';
		return t('cov.assumptions', {
			tx: unit(num(s.txPower), 'dBm'), gain: unit(num(s.antennaGain, 1), 'dBi'), height: unit(num(s.antennaHeight), 'm'),
			preset: presetName(radio), sf: radio.sf, bw: unit(num(radio.bw, 1), 'kHz'),
			rxHeight: unit(num(RECEIVER.height), 'm'), rxGain: unit(num(RECEIVER.gain), 'dBi'), margin: unit(num(FADE_MARGIN_DB), 'dB'),
		});
	});
	const legend = computed(() => {
		void ui.dark; // the colours follow the theme
		const rgb = cssRgb(probe, cssVar('--plan-veil') || '#a21caf').join(' ');
		const alphas = cssVar('--plan-veil-alphas').split(/[\s,]+/).map(Number);
		return COVERAGE_STEPS.map((from, i) => ({
			label: i + 1 < COVERAGE_STEPS.length ? `${from}–${COVERAGE_STEPS[i + 1]}` : `≥ ${from}`,
			color: `rgb(${rgb} / ${alphas[i] ?? 0.3})`,
		}));
	});
	const sliders = COVERAGE_SLIDERS;
	const options = COVERAGE_OPTIONS;
	const profileTitle = computed(() => profileEnds.value.map(end => end?.adv_name ?? '…'));
	// the names in the title, a long one cut in the middle ("Test RPT…Noord"), shorter on a phone
	const profileTitleShort = computed(() => profileTitle.value.map(name => middleCut(name, ui.phone ? 14 : 28)));
	const profileNote = computed(() => {
		const view = profileView.value;
		if(!view) return '';
		const s = coverage.settings;
		return t('prof.note', {
			freq: unit(num(view.radio.freq, 3), 'MHz'), sf: view.radio.sf, bw: unit(num(view.radio.bw, 1), 'kHz'),
			tx: unit(num(s.txPower), 'dBm'), gain: unit(num(s.antennaGain, 1), 'dBi'),
			sensitivity: unit(num(view.sensitivity), 'dBm'), margin: unit(num(FADE_MARGIN_DB), 'dB'),
		});
	});
	const fmt = {
		db: (v, sign = false) => unit(`${sign && v >= 0 ? '+' : ''}${num(v, 1, 1)}`, 'dB'),
		km: v => unit(num(v / 1000, 1, 1), 'km'),
		m: v => unit(num(Math.round(v)), 'm'),
		deg: v => `${num(v, 1, 1)}° ${compassPoint(v)}`,
		compass: compassPoint,
	};

	const app = createApp({
		setup() {
			return {
				t, ui, coverage, profile, profileView, profileEnds, profileTitle, profileTitleShort, profileStatus, profileUsesPreset, profileNote,
				profileCanvas, onChartPointer, onChartLeave, summary, assumptions, legend, sliders, options, presets, fmt,
				AUTO_PRESET, buildingsMaxKm: BUILDINGS_MAX_DISTANCE / 1000, settingsOpen,
				coverageOpen: computed(() => Boolean(coverage.publicKey || coverage.point)),
				closeCoverage,
				closeProfile: () => closeProfile(profile),
				swapProfileEnds: () => swapProfileEnds(profile),
				aimAtB: () => { if(profileView.value) coverage.settings.direction = Math.round(profileView.value.result.bearing) % 360; },
				toggleSettings: () => { ui.settingsOpen = !ui.settingsOpen; },
				setSetting: (key, value) => { coverage.settings[key] = value; },
				num, unit,
			};
		},
		render,
	});
	app.component('setting-slider', SettingSlider);
	app.mount(root);

	return {
		showCoverage,
		showPointCoverage,
		profileFrom(end) { setProfileStart(profile, end); host.closeFilters(); },
		profileTo(end) { addProfileEnd(profile, end); host.closeFilters(); },
		applyShared,
		state: { coverage, profile },
	};
}
