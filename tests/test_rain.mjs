// The rain plan, end to end.
//
// A planned day that is likely wet says which of its stops are outdoors and
// offers the way to indoor alternatives nearby. It points and does not
// decide: the plan is untouched, and nothing is asked of the model until you
// tap Search.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (d) => `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = new Date();
const tomorrow = new Date(Date.now() + 864e5);

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.addInitScript(() => { try { localStorage.setItem('onboarded-v1', '1'); } catch { /* nothing */ } });

// Today is wet (80%), tomorrow is dry (10%).
await page.route(/open-meteo/, (route) => {
  const days = Array.from({ length: 16 }, (_, i) => new Date(Date.now() + i * 864e5));
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: {
    time: days.map(iso), weather_code: days.map((_, i) => (i === 0 ? 63 : 1)),
    temperature_2m_max: days.map(() => 14), temperature_2m_min: days.map(() => 8),
    precipitation_probability_max: days.map((_, i) => (i === 0 ? 80 : 10)),
    precipitation_sum: days.map(() => 1), wind_speed_10m_max: days.map(() => 10) } }) });
});
const asked = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models(\?|$)/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  asked.push(JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text);
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '- name: Fareham Library; area: Fareham; why: warm and dry' }] }, groundingMetadata: { webSearchQueries: ['q'] } }] }) });
});
await page.route(/nominatim|overpass|wikidata|wikipedia|photon|tile\.|places\.googleapis/, (r) => r.abort());

const seed = async (mode) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(({ mode, d1, d2 }) => {
    localStorage.clear();
    localStorage.setItem('onboarded-v1', '1');
    localStorage.setItem('boards-v1', JSON.stringify({ activeId: 'b', boards: [{ id: 'b', name: 'Trip', destination: 'Fareham', dated: true, createdAt: 1 }] }));
    localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Fareham', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash', geminiModelPinned: true, mode }));
    localStorage.setItem('people-v1', JSON.stringify(mode === 'kids' ? [{ name: 'A', age: 38 }, { name: 'K', age: 4 }] : [{ name: 'A', age: 38 }]));
    localStorage.setItem('board:b:folders', JSON.stringify(['Fareham']));
    localStorage.setItem('board:b:picks', JSON.stringify([
      { id: 'cafe', name: 'Harbour Cafe', city: 'Fareham', category: 'Cafe', lat: 50.85, lon: -1.18 },
      { id: 'park', name: 'Fareham Park', city: 'Fareham', category: 'Park', lat: 50.84, lon: -1.19 },
      { id: 'beach', name: 'Hill Head Beach', city: 'Fareham', category: 'Beach', lat: 50.82, lon: -1.24 },
      { id: 'mus', name: 'Sail Museum', city: 'Fareham', category: 'Museum', lat: 50.83, lon: -1.2 },
      { id: 'dry', name: 'Dry Day Park', city: 'Fareham', category: 'Park', lat: 50.8, lon: -1.1 },
    ]));
    localStorage.setItem('board:b:plan', JSON.stringify({
      days: [{ id: 'd1', label: `Day 1 · ${d1}` }, { id: 'd2', label: `Day 2 · ${d2}` }],
      items: { d1: [{ pickId: 'beach', time: '14:00' }, { pickId: 'cafe', time: '09:00' }, { pickId: 'park', time: '11:00' }, { pickId: 'mus', time: '16:00' }], d2: [{ pickId: 'dry', time: '10:00' }] } }));
  }, { mode, d1: label(today), d2: label(tomorrow) });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
};
const banners = () => page.evaluate(() => [...document.querySelectorAll('.rain-plan')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));

// ---------- Plan: the wet day only ----------
await seed('kids');
await goTo(page, 'itinerary', 900);
let b = await banners();
check('the wet day says rain is likely, with the chance', b.length >= 1 && /Rain likely \(80%\)/.test(b[0]), JSON.stringify(b));
check('and names its outdoor stops in the order of the day, not the indoor ones', /Outdoors: Fareham Park, Hill Head Beach/.test(b[0]) && !/Cafe|Museum/.test(b[0]), b[0]);
check('the dry day has no banner', b.length === 1);
check('the plan itself is untouched by showing it', await page.evaluate(() => JSON.parse(localStorage.getItem('board:b:plan')).items.d1.length === 4));

// ---------- The button: opens the search, spends nothing ----------
asked.length = 0;
await page.click('[data-rain-search]');
await page.waitForTimeout(600);
const view = await page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
check('it opens Explore, centred on the first outdoor stop', /Fareham Park/.test(view), view.slice(0, 200));
check('with the indoor search for children chosen', /Indoors if it rains/.test(view), view.slice(0, 300));
check('and asks nothing of the model until you tap Search', asked.length === 0);
await page.click('#exploreRunBtn');
await page.waitForFunction(() => /Fareham Library/.test(document.getElementById('view').textContent), null, { timeout: 15000 }).catch(() => {});
check('Search then asks once, about indoors on a wet day', asked.length === 1 && /indoor/i.test(asked[0]) && /wet day/i.test(asked[0]), asked[0] && asked[0].slice(0, 160));

// ---------- Today keeps the one it already had ----------
await goTo(page, 'today', 900);
check('Today does not get a second, duplicate box: it already has its own wet-day button', (await banners()).length === 0 &&
  await page.evaluate(() => document.querySelectorAll('[data-rainy-day]').length === 1));

// ---------- Grown-ups get the general indoor search ----------
await seed('adults');
await goTo(page, 'itinerary', 900);
await page.click('[data-rain-search]');
await page.waitForTimeout(600);
check('without children the search is the general one', /Only if it rains/.test(await page.evaluate(() => document.getElementById('view').textContent)));

// ---------- A dry forecast says nothing ----------
await page.route(/open-meteo/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: {
  time: Array.from({ length: 16 }, (_, i) => iso(new Date(Date.now() + i * 864e5))), weather_code: Array(16).fill(1), temperature_2m_max: Array(16).fill(14), temperature_2m_min: Array(16).fill(8),
  precipitation_probability_max: Array(16).fill(5), precipitation_sum: Array(16).fill(0), wind_speed_10m_max: Array(16).fill(10) } }) }));
await seed('adults');
await page.evaluate(() => localStorage.removeItem('weather-cache-v1'));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await goTo(page, 'itinerary', 900);
check('with no rain forecast there is no banner at all', (await banners()).length === 0);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
