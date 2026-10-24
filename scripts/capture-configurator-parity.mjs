// Captures parity fixtures (export JSON + CLI script) from the OLD configurator page.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'web/configurator/tests/fixtures/parity');
const PORT = 8799;
const CHROME = '/home/confi/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';

const locode = JSON.parse(readFileSync(path.join(root, 'data/be-locode.json'), 'utf8'));
const vovCodes = locode.filter((r) => r.province_code === 'be-vov').map((r) => r.city_code);
const whtCodes = new Set(locode.filter((r) => r.province_code === 'be-wht').map((r) => r.city_code));

const scenarios = [
  { name: 'ronse-solar', search: 'Ronse', fields: { 'name-power-emoji': '🌞', 'name-suffix': 'Kluisberg' } },
  { name: 'brussels', search: 'Brussel', fields: { 'name-suffix': 'Atomium' } },
  { name: 'border-deny', search: 'Ronse', borderDeny: true, fields: {} },
  { name: 'neighbour-deny', search: 'Ronse', neighbourDeny: true, fields: {} },
  { name: 'no-location', search: null, fields: { 'name-suffix': 'Test' } },
  {
    name: 'advanced-all',
    search: 'Ronse',
    fields: {
      'setting-txdelay': '0.7',
      'setting-direct-txdelay': '0.4',
      'setting-rxdelay': '2',
      'setting-radio-rxgain': 'off',
      'setting-int-thresh': '10',
      'setting-agc-reset': '8',
      'setting-multi-acks': '1',
      'setting-loop-detect': 'strict',
      'setting-path-hash-mode': '2',
      'setting-flood-max': '32',
      'setting-owner-info': 'Ops team',
      'setting-guest-password': 'guest',
      'setting-radio-txpower': '20',
    },
  },
  { name: 'admin-password', search: 'Ronse', fields: { 'setting-admin-password': 'S3cret' } },
];

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: root, stdio: 'ignore' });
const browser = await chromium.launch({ executablePath: CHROME });
try {
  await new Promise((r) => setTimeout(r, 1000));
  mkdirSync(outDir, { recursive: true });
  for (const sc of scenarios) {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`http://localhost:${PORT}/configurator.html`);
    await page.waitForSelector('#city-search', { state: 'attached' });
    if (sc.search) {
      await page.fill('#city-search', sc.search);
      await page.click('#city-dropdown .search-dropdown-item[data-index="0"]');
      await page.waitForFunction(
        () => /(^|\n)\s*region /.test(document.querySelector('#commands-block')?.textContent ?? '') ||
              /\bregion\b/.test(document.querySelector('#commands-block')?.textContent ?? ''),
        null, { timeout: 30000 });
    }
    if (sc.borderDeny) {
      const id = await page.evaluate((codes) => {
        const denies = [...document.querySelectorAll('.policy-deny')].filter((e) => !e.disabled);
        // Neighbouring Henegouwen cities are disabled in Ronse's tree, so fall back to the province row.
        const el = denies.find((e) => codes.includes(e.dataset.code)) ?? denies.find((e) => e.dataset.code === 'be-wht');
        return el ? el.id : null;
      }, [...whtCodes]);
      if (!id) throw new Error('no enabled be-wht deny checkbox found');
      await page.evaluate((i) => document.getElementById(i).click(), id);
      if (!(await page.isChecked('#' + id))) throw new Error(id + ' did not stay checked');
    }
    if (sc.neighbourDeny) {
      // Neighbour municipality rows only unlock once the home city (beron) is allowed.
      await page.evaluate(() => document.getElementById('pc_beron_a').click());
      const id = await page.evaluate((codes) => {
        const el = [...document.querySelectorAll('.policy-deny')].find(
          (e) => !e.disabled && e.dataset.code !== 'beron' && codes.includes(e.dataset.code));
        return el ? el.id : null;
      }, vovCodes);
      if (!id) throw new Error('no enabled be-vov neighbour deny checkbox found');
      await page.evaluate((i) => document.getElementById(i).click(), id);
      if (!(await page.isChecked('#' + id))) throw new Error(id + ' did not stay checked');
      console.log('neighbour-deny clicked', id);
    }
    await page.evaluate((fields) => {
      for (const [id, v] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (!el) throw new Error('missing #' + id);
        el.value = v;
        if (el.value !== v) throw new Error(`#${id} rejected value ${v}`);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, sc.fields);
    if (await page.isChecked('#cli-show-defaults')) throw new Error('show defaults is on');
    await page.waitForTimeout(500);
    const script = await page.evaluate(() => document.getElementById('commands-block').textContent);
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => document.getElementById('config-export-btn').click()),
    ]);
    await dl.saveAs(path.join(outDir, `${sc.name}.backup.json`));
    writeFileSync(path.join(outDir, `${sc.name}.script.txt`), script);
    console.log(sc.name, 'script bytes', script.length);
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
