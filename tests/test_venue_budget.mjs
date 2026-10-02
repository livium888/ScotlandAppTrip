// "Nothing at all" for a minute and a half.
//
// A troubleshooting report from a phone showed the search waiting on the
// cinema lookup before it sent anything to the AI - three map servers tried
// one after another, thirty seconds each, so up to ninety seconds of nothing.
// The names of nearby cinemas are an improvement to the question, not a
// requirement, so: the servers are asked together (a slow one cannot hold up
// a fast one), and the search waits a few seconds at most before going
// ahead without the names.
import { chromium } from 'playwright';
import { openEventForm } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
await page.addInitScript(() => { try { localStorage.setItem('onboarded-v1', '1'); } catch { /* nothing */ } });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

let overpass = 'one-hangs';
const asked = [];
let t0 = 0;
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models(\?|$)/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const body = JSON.parse(route.request().postData() || '{}');
  asked.push({ at: Date.now() - t0, prompt: body.contents[0].parts[0].text });
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{
    content: { parts: [{ text: '' }] }, groundingMetadata: { webSearchQueries: ['q'] } }] }) });
});
await page.route(/overpass/, (route) => {
  const url = route.request().url();
  if (overpass === 'all-hang') return; // never answers
  if (overpass === 'all-refuse') return route.abort(); // refuses at once
  if (/overpass-api\.de/.test(url)) return; // the first mirror never answers
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [
    { type: 'node', id: 1, lat: 50.86, lon: -1.23, tags: { name: 'Cineworld Test', amenity: 'cinema', 'addr:city': 'Whiteley' } }] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
  lat: '50.86', lon: '-1.23', display_name: 'Fareham', type: 'town', namedetails: { name: 'Fareham' }, address: { town: 'Fareham' }, extratags: {} }]) }));
await page.route(/wikidata|wikipedia|photon|tile\.|open-meteo|places\.googleapis/, (r) => r.abort());

const run = async (label) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('onboarded-v1', '1');
    localStorage.setItem('boards-v1', JSON.stringify({ activeId: 'b', boards: [{ id: 'b', name: 'Trip', destination: 'Fareham', dated: true, createdAt: 1 }] }));
    localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Fareham', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash', geminiModelPinned: true }));
    localStorage.setItem('board:b:folders', JSON.stringify(['Fareham']));
    localStorage.setItem('board:b:picks', JSON.stringify([]));
    localStorage.setItem('board:b:search-anchor', JSON.stringify({ name: 'Fareham', lat: 50.86, lon: -1.23, miles: 25 }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  asked.length = 0;
  await page.evaluate(() => document.querySelector('.tabbar [data-view="events"]').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__tripTest.setEventKinds(['films']));
  await openEventForm(page);
  t0 = Date.now();
  await page.evaluate(() => document.getElementById('evSearch').click());
  await page.waitForFunction(() => true);
  const deadline = Date.now() + 25000;
  while (!asked.length && Date.now() < deadline) await page.waitForTimeout(200);
  console.log(`  (${label}: the question went out after ${asked.length ? (asked[0].at / 1000).toFixed(1) + 's' : 'never'})`);
};

// ---------- One mirror is hopeless, another is fine ----------
overpass = 'one-hangs';
await run('first mirror hangs');
check('a hung mirror does not hold up a working one: the question goes out within a few seconds', asked.length > 0 && asked[0].at < 9000, asked.length ? `${asked[0].at}ms` : 'never');
check('and the cinema that was found is in the question', asked.length > 0 && /Cineworld Test \(Whiteley\)/.test(asked[0].prompt));

// ---------- Every mirror is hopeless ----------
overpass = 'all-hang';
await run('every mirror hangs');
check('with every map server silent, the search still goes ahead after a few seconds, not ninety', asked.length > 0 && asked[0].at < 14000, asked.length ? `${asked[0].at}ms` : 'never');
check('without names it asks about cinemas in general rather than not at all', asked.length > 0 && /Find films/.test(asked[0].prompt) && !/Cineworld Test/.test(asked[0].prompt));
await page.waitForTimeout(800);
const trace = await page.evaluate(() => JSON.parse(localStorage.getItem('search-trace-v1') || '{}'));
check('and the trace says the lookup was given up on, so the report explains the wait', /still looking|gave up|went ahead without/i.test(trace.lookups || ''), trace.lookups);

// ---------- Every mirror refuses at once ----------
overpass = 'all-refuse';
await run('every mirror refuses');
check('servers that refuse at once cost no waiting at all', asked.length > 0 && asked[0].at < 4000, asked.length ? `${asked[0].at}ms` : 'never');

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
