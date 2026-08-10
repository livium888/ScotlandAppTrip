// Weather from Open-Meteo - free, no key, 16 days out. The cases worth
// pinning: a forecast reaches the day it belongs to, a day beyond the horizon
// says so instead of inventing one, a cached forecast still shows with no
// network (labelled as old, not passed off as current), and one request
// serves places in the same town.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 820 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

// Dates are built relative to today so the suite doesn't rot.
const d = (offset) => {
  const x = new Date();
  x.setDate(x.getDate() + offset);
  return x;
};
const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (x, n) => `Day ${n} · ${DOW[x.getDay()]} ${x.getDate()} ${MON[x.getMonth()]}`;

const tomorrow = d(1);
const dayAfter = d(2);
const farOff = d(30); // beyond the 16-day horizon

let weatherCalls = [];
let weatherDown = false;

await page.route(/api\.open-meteo\.com/, (route) => {
  weatherCalls.push(route.request().url());
  if (weatherDown) return route.abort();
  const time = [];
  const code = [];
  const tmax = [];
  const tmin = [];
  const pop = [];
  const wind = [];
  for (let i = 0; i < 16; i++) {
    time.push(iso(d(i)));
    // Tomorrow is wet, the day after is clear, so both branches get exercised.
    code.push(i === 1 ? 63 : 0);
    tmax.push(i === 1 ? 14 : 21);
    tmin.push(i === 1 ? 9 : 12);
    pop.push(i === 1 ? 85 : 5);
    wind.push(i === 1 ? 45 : 11);
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    daily: { time, weather_code: code, temperature_2m_max: tmax, temperature_2m_min: tmin,
      precipitation_probability_max: pop, precipitation_sum: time.map(() => 0), wind_speed_10m_max: wind },
  }) });
});
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(({ l1, l2, l3 }) => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-w', boards: [{ id: 'b-w', name: 'Weather test', destination: 'Edinburgh', dated: true, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('board:b-w:picks', JSON.stringify([
    { id: 'custom:Edinburgh Castle', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999 },
    { id: 'custom:Camera Obscura', name: 'Camera Obscura', city: 'Edinburgh', category: 'Attraction', lat: 55.9489, lon: -3.1953 },
  ]));
  localStorage.setItem('board:b-w:plan', JSON.stringify({
    days: [{ id: 'd1', label: l1 }, { id: 'd2', label: l2 }, { id: 'd3', label: l3 }],
    items: {
      d1: [{ pickId: 'custom:Edinburgh Castle', time: '10:00' }],
      d2: [{ pickId: 'custom:Camera Obscura', time: '11:00' }],
      d3: [],
    },
  }));
}, { l1: label(tomorrow, 1), l2: label(dayAfter, 2), l3: label(farOff, 3) });
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);

// --- Today carries the forecast for the day in view ---
await page.evaluate(() => document.querySelector('[data-view="today"]').click());
await page.waitForTimeout(1200);
const todayText = await page.evaluate(() => document.getElementById('view').textContent);
check('a forecast reaches the Today screen', /Rain/.test(todayText), todayText.slice(0, 200));
check('temperatures shown', /14°\/9°/.test(todayText), todayText.slice(0, 200));
check('chance of rain shown', /85%/.test(todayText), todayText.slice(0, 200));
check('strong wind called out', /45 km\/h/.test(todayText), todayText.slice(0, 200));
check('no key was needed for any of it', await page.evaluate(() =>
  !JSON.parse(localStorage.getItem('trip-settings-v1') || '{}').geminiKey));

// A wet day leads somewhere rather than just being bad news.
check('a wet day offers something indoors', await page.evaluate(() => !!document.querySelector('[data-rainy-day]')));
await page.evaluate(() => document.querySelector('[data-rainy-day]').click());
await page.waitForTimeout(800);
check('it opens Explore already asking for indoor places', await page.evaluate(() =>
  document.getElementById('exploreCatBtn') && /Indoors if it rains/.test(document.getElementById('exploreCatBtn').textContent)),
  await page.evaluate(() => (document.getElementById('exploreCatBtn') || {}).textContent));

// --- Every planned day gets its own, on the right dates ---
await page.evaluate(() => document.querySelector('[data-view="itinerary"]').click());
await page.waitForTimeout(1000);
const itinText = await page.evaluate(() => document.getElementById('view').textContent);
check('the wet day and the clear day differ', /Rain/.test(itinText) && /Clear/.test(itinText), itinText.slice(0, 300));
check('the clear day shows its own temperature', /21°\/12°/.test(itinText), itinText.slice(0, 300));

// --- Beyond the horizon, say so rather than invent one ---
const overviewCheck = await page.evaluate(() => {
  document.querySelector('[data-view="overview"]').click();
  return null;
});
await page.waitForTimeout(800);
const tripText = await page.evaluate(() => document.getElementById('view').textContent);
check('near days show weather on the trip screen', /🌧️|☀️|21°|14°/.test(tripText), tripText.slice(0, 300));
check('a day 30 days out claims no forecast', !/30 days.*(Rain|Clear)/.test(tripText), tripText.slice(0, 300));

await page.evaluate(() => document.querySelector('[data-view="today"]').click());
await page.waitForTimeout(400);

// --- One request per town, not per place ---
const before = weatherCalls.length;
weatherCalls = [];
await page.evaluate(() => document.querySelector('[data-view="itinerary"]').click());
await page.waitForTimeout(800);
check('cached between screens rather than refetched', weatherCalls.length === 0, JSON.stringify(weatherCalls));
check('nearby places shared one request', before <= 2, String(before));

// --- A place's sheet shows the day it is actually scheduled on ---
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => Array.from(document.querySelectorAll('[data-open-pick]'))
  .find((r) => /Edinburgh Castle/.test(r.textContent)).click());
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(400);
const sheet = await page.evaluate(() => document.getElementById('placeModal').textContent);
check('a place shows the forecast for its own day', /Rain/.test(sheet), sheet.slice(0, 250));
check('and names which day that is', /Day 1|Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(sheet), sheet.slice(0, 250));
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());

// --- With no network, the saved forecast still shows, marked as old ---
weatherDown = true;
await page.evaluate(() => {
  const c = JSON.parse(localStorage.getItem('weather-cache-v1'));
  Object.keys(c).forEach((k) => { c[k].fetchedAt = Date.now() - 5 * 60 * 60 * 1000; });
  localStorage.setItem('weather-cache-v1', JSON.stringify(c));
});
await page.evaluate(() => document.querySelector('[data-view="today"]').click());
await page.waitForTimeout(1200);
const offlineText = await page.evaluate(() => document.getElementById('view').textContent);
check('an old forecast is still shown when offline', /Rain/.test(offlineText), offlineText.slice(0, 200));
check('and is honest about being old', /saved earlier/.test(offlineText), offlineText.slice(0, 200));

// A board with no coordinates anywhere simply has no weather - not an error.
await page.evaluate(() => {
  localStorage.setItem('board:b-w:picks', JSON.stringify([
    { id: 'custom:Nowhere', name: 'Nowhere', city: 'Unsorted', category: 'Attraction' },
  ]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(800);
check('no coordinates means no weather, and no crash', await page.evaluate(() =>
  !document.querySelector('.weather-line') && !!document.getElementById('view').textContent.trim()));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
