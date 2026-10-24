// Refreshes web/configurator/src/core/radio-presets.json from the official MeshCore API.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const URL = 'https://api.meshcore.nz/api/v1/config';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'web/configurator/src/core/radio-presets.json');

const res = await fetch(URL);
if (!res.ok) throw new Error(`${URL} answered ${res.status}`);
const config = await res.json();
const entries = config?.config?.suggested_radio_settings?.entries;
if (!Array.isArray(entries) || entries.length === 0) throw new Error('no suggested_radio_settings entries');

const presets = entries.map((e) => ({
  title: String(e.title),
  freq: Number(e.frequency),
  sf: Number(e.spreading_factor),
  bw: Number(e.bandwidth),
  cr: Number(e.coding_rate),
}));
for (const p of presets) {
  if (![p.freq, p.sf, p.bw, p.cr].every(Number.isFinite)) throw new Error(`bad preset ${p.title}`);
}
writeFileSync(out, JSON.stringify(presets, null, 2) + '\n');
console.log(`wrote ${presets.length} presets to ${out}`);
