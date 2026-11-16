// Adapted from map.meshcore.io (https://github.com/meshcore-dev/map.meshcore.io), MIT License,
// Copyright (c) 2025 Rastislav Vysoky. See LICENSE in this folder.
// Changed here: a render function (the page has Vue's runtime only), the #BEmesh slider look: the
// label, then the slider and a number field for exact values with its unit right after it.
import { h, ref } from '../../lib/vue.runtime.esm-browser.prod.js';

let nextId = 0;

// A slider with its value, which can also be typed in. The value shows while dragging, but is only set
// on release, a key press or Enter: every new value restarts the estimate.
export const SettingSlider = {
	props: {
		modelValue: { type: Number, required: true },
		min: { type: Number, required: true },
		max: { type: Number, required: true },
		step: { type: Number, default: 1 },
		unit: { type: String, default: '' },
		label: { type: String, required: true },
		// the value as shown (decimal comma in nl and fr)
		format: { type: Function, default: value => String(value) },
		// a bearing: its compass point too
		compass: { type: Function, default: null },
	},
	emits: ['update:modelValue'],
	setup(props, { emit }) {
		const draft = ref(null);
		const id = `plan-slider-${++nextId}`;
		function set(value) {
			if(value !== props.modelValue) emit('update:modelValue', value);
		}
		function commitNumber(event) {
			const typed = event.target.valueAsNumber;
			if(Number.isFinite(typed)) {
				const { min, max, step } = props;
				set(Number(Math.min(max, Math.max(min, min + Math.round((typed - min) / step) * step)).toFixed(6)));
			}
			event.target.value = props.modelValue;
		}
		return () => {
			const value = draft.value ?? props.modelValue;
			const shown = `${props.format(value)}${props.unit === '°' ? '°' : ` ${props.unit}`}${props.compass ? ` ${props.compass(value)}` : ''}`;
			const fill = `${((value - props.min) / (props.max - props.min)) * 100}%`;
			const suffix = `${props.unit}${props.compass ? `\u00a0${props.compass(value)}` : ''}`;
			return h('div', { class: 'plan-slider' }, [
				h('div', { class: 'plan-slider__row' }, [
					h('label', { for: id }, props.label),
				]),
				h('div', { class: 'plan-slider__controls' }, [
					h('input', {
						id, type: 'range', min: props.min, max: props.max, step: props.step, value,
						style: { '--fill': fill },
						'aria-valuetext': shown,
						onInput: e => { draft.value = Number(e.target.value); },
						onChange: e => { draft.value = null; set(Number(e.target.value)); },
					}),
					h('input', {
						type: 'number', class: 'plan-number', min: props.min, max: props.max, step: props.step, value,
						inputmode: 'decimal', 'aria-label': `${props.label} (${props.unit})`,
						onChange: commitNumber,
						onKeydown: e => { if(e.key === 'Enter') e.target.blur(); },
					}),
					h('span', { class: ['plan-unit', 'plan-mono', { 'plan-unit--deg': props.unit === '°' }], 'aria-hidden': 'true' }, suffix),
				]),
			]);
		};
	},
};
