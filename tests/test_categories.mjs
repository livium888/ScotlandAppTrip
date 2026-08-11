// Finding "somewhere healthy" or "soft play" is a different question from
// "amenity=restaurant", and the old sideways-scrolling chip row hid most of
// the answers off the edge of the screen. These check that the whole list is
// reachable in one gesture, that a category asks the question it claims to,
// and that anything not on the list can still be described.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

// The panel's own search field is gone: there is one search, at the top of the
// screen, and its results carry "🧭 around here". This is that route.
const centreOn = async (query) => {
  await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
  await page.waitForTimeout(250);
  await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
  await page.waitForSelector('#pickSearchInput');
  await page.fill('#pickSearchInput', query);
  await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
  await page.waitForSelector('[data-around-candidate]', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('[data-around-candidate]').click());
  await page.waitForSelector('#exploreRunBtn', { timeout: 8000 });
  await page.waitForTimeout(300);
};

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 800 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

let promptSeen = '';
let nominatimQueries = [];

await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  promptSeen = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([
      { name: 'Green Bowl', area: 'Old Town', why: 'Salads and grain bowls, quick service.' },
    ]) }] } }],
  }) });
});

await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const url = decodeURIComponent(route.request().url());
  nominatimQueries.push(url);
  const body = /Green Bowl/.test(url)
    ? [{ lat: '55.9490', lon: '-3.1930', display_name: 'Green Bowl, Old Town, Edinburgh', type: 'restaurant',
        namedetails: { name: 'Green Bowl' }, address: { city: 'Edinburgh' }, extratags: {} }]
    : [{ lat: '55.9486', lon: '-3.1999', display_name: 'Edinburgh Castle, Edinburgh', type: 'castle',
        namedetails: { name: 'Edinburgh Castle' }, address: { city: 'Edinburgh' }, extratags: {} }];
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route(/wikidata|wikipedia|overpass|tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
    travellers: 'family of 3, 4-year-old who walks',
  }));
});
await page.reload({ waitUntil: 'load' });

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#exploreToggle');
await page.click('#exploreToggle');
await centreOn('Edinburgh Castle');
// Setting the centre now goes through the place search, which is an AI call in
// its own right - so the "did choosing a category search?" check below has to
// start from a clean slate.
promptSeen = '';
await page.waitForTimeout(800);

// --- One control, not a row that scrolls off the screen ---
check('one button stands in for the whole list', await page.evaluate(() => !!document.getElementById('exploreCatBtn')));
check('it says what it is for before anything is chosen', /What are you looking for/.test(
  await page.evaluate(() => document.getElementById('exploreCatBtn').textContent)));
check('no sideways-scrolling chip row left behind', await page.evaluate(() =>
  document.querySelectorAll('[data-explore-cat]').length === 0));

await page.click('#exploreCatBtn');
await page.waitForSelector('[data-choose-cat]', { timeout: 3000 });

const keys = await page.evaluate(() => Array.from(document.querySelectorAll('[data-choose-cat]')).map((b) => b.getAttribute('data-choose-cat')));
check('the things a family actually looks for are there', ['healthy', 'softplay', 'playground', 'rainy', 'icecream', 'animals', 'swim'].every((k) => keys.includes(k)), JSON.stringify(keys));
check('the old categories survived', ['restaurant', 'cafe', 'museum', 'parking', 'toilets'].every((k) => keys.includes(k)), JSON.stringify(keys));
check('more to choose from than before', keys.length >= 24, String(keys.length));

const groups = await page.evaluate(() => Array.from(document.querySelectorAll('.cat-group-label')).map((g) => g.textContent.trim()));
check('grouped rather than one long run', groups.length >= 4, JSON.stringify(groups));
check('a group for travelling with a child', groups.some((g) => /child/i.test(g)), JSON.stringify(groups));

// Everything must be reachable by scrolling the sheet down - never sideways.
const overflows = await page.evaluate(() => {
  const grid = document.querySelector('.cat-grid');
  return grid ? grid.scrollWidth > grid.clientWidth + 2 : true;
});
check('no horizontal scrolling in the picker', overflows === false);

// --- A category asks the question it claims to ---
await page.evaluate(() => document.querySelector('[data-choose-cat="healthy"]').click());
// Choosing a category no longer searches - it sets the question, and Search
// asks it. That is the whole point of the button existing.
check('choosing a category does not search on its own', promptSeen === '', promptSeen.slice(0, 80));
await page.waitForSelector('#exploreRunBtn:not([disabled])', { timeout: 3000 });
await page.click('#exploreRunBtn');
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 20000 });
await page.waitForTimeout(300);

check('the picker closes once you choose', await page.evaluate(() =>
  !document.getElementById('placeModal').classList.contains('open')));
check('"healthy" asks for more than the nearest restaurant', /salad|grain bowls|vegetable/i.test(promptSeen), promptSeen.slice(0, 160));
check('who is travelling still reaches the model', /4-year-old/.test(promptSeen));
check('the chosen category is named on the button', /Healthy food/.test(
  await page.evaluate(() => document.getElementById('exploreCatBtn').textContent)));
check('results come back', /Green Bowl/.test(await page.evaluate(() => document.getElementById('view').textContent)));

// Soft play has no OpenStreetMap tag at all - the whole point of asking a
// model instead of a database.
await page.click('#exploreCatBtn');
await page.waitForSelector('[data-choose-cat="softplay"]');
await page.evaluate(() => document.querySelector('[data-choose-cat="softplay"]').click());
await page.waitForSelector('#exploreRunBtn:not([disabled])', { timeout: 3000 });
await page.click('#exploreRunBtn');
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 20000 });
check('"soft play" asks for indoor play, not a playground', /soft play|indoor play/i.test(promptSeen), promptSeen.slice(0, 160));

// --- Anything not on the list can be described ---
await page.click('#exploreCatBtn');
await page.waitForSelector('#catCustomForm');
await page.fill('#catCustomInput', 'vegan lunch with a garden');
await page.evaluate(() => document.getElementById('catCustomForm').requestSubmit());
await page.waitForSelector('#exploreRunBtn:not([disabled])', { timeout: 3000 });
await page.click('#exploreRunBtn');
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 20000 });
await page.waitForTimeout(200);

check('a described search reaches the model as written', /vegan lunch with a garden/.test(promptSeen), promptSeen.slice(0, 160));
check('the description shows on the button', /vegan lunch with a garden/.test(
  await page.evaluate(() => document.getElementById('exploreCatBtn').textContent)));

// --- Without an AI key, a described search still does something ---
nominatimQueries = [];
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('trip-settings-v1'));
  s.geminiKey = '';
  localStorage.setItem('trip-settings-v1', JSON.stringify(s));
});
await page.click('#exploreCatBtn');
await page.waitForSelector('#catCustomForm');
await page.fill('#catCustomInput', 'bookshop');
await page.evaluate(() => document.getElementById('catCustomForm').requestSubmit());
await page.waitForSelector('#exploreRunBtn:not([disabled])', { timeout: 3000 });
await page.click('#exploreRunBtn');
await page.waitForTimeout(1200);
check('falls back to a bounded map search, not nothing', nominatimQueries.some((u) => /bounded=1/.test(u) && /bookshop/.test(u)), JSON.stringify(nominatimQueries).slice(0, 200));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
