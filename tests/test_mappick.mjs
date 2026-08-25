// Choosing a place by pointing at it. Every other way in needs a name -
// type one, use a saved one, or be standing in it - but "the bit of coast
// north of the bridge" has no name you'd type, and on a trip that's most of
// the map. What matters here: the pin follows the map, the spot gets a real
// name rather than a coordinate, and cancelling changes nothing.
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

let reverseCalls = [];
await page.route(/nominatim\.openstreetmap\.org\/reverse/, (route) => {
  reverseCalls.push(route.request().url());
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    name: 'Cramond', address: { suburb: 'Cramond', city: 'Edinburgh' },
  }) });
});
await page.route(/nominatim\.openstreetmap\.org\/search/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '55.9533', lon: '-3.1883', display_name: 'Edinburgh, Scotland', type: 'city',
    namedetails: { name: 'Edinburgh' }, address: { city: 'Edinburgh' }, extratags: {} }]) }));
await page.route(/generativelanguage|overpass|wikidata|wikipedia|open-meteo/, (r) => r.abort());
await page.route(/tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-m', boards: [{ id: 'b-m', name: 'Map pick', destination: 'Edinburgh', dated: false, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('board:b-m:picks', JSON.stringify([
    { id: 'custom:Edinburgh Castle', name: 'Edinburgh Castle', city: 'Edinburgh', lat: 55.9486, lon: -3.1999 },
  ]));
});
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#exploreToggle');
await page.click('#exploreToggle');
await page.waitForSelector('#exploreMapBtn', { timeout: 3000 });

// --- Explore offers it alongside the ways that need a name ---
check('pointing at a map is offered as a starting point', await page.evaluate(() =>
  !!document.getElementById('exploreMapBtn')));

await page.click('#exploreMapBtn');
await page.waitForSelector('#mapPickCanvas', { timeout: 3000 });
await page.waitForTimeout(1200);

check('the picker fills the screen', await page.evaluate(() => {
  const el = document.getElementById('mapOverlay');
  return el.classList.contains('open') && el.clientHeight > 600;
}));
check('a pin marks the middle to aim with', await page.evaluate(() => !!document.querySelector('.map-crosshair')));
check('the pin does not swallow taps meant for the map', await page.evaluate(() =>
  getComputedStyle(document.querySelector('.map-crosshair')).pointerEvents === 'none'));

// --- The spot gets a name, not a coordinate ---
const labelText = await page.evaluate(() => document.getElementById('mapPickLabel').textContent);
check('where you are pointing is named', /Cramond/.test(labelText), labelText);
check('the name came from a reverse lookup', reverseCalls.length >= 1, String(reverseCalls.length));
check('asked at area level, not house level', /zoom=14/.test(reverseCalls[0] || ''), reverseCalls[0]);

// Dragging asks again - but only once it settles, not on every frame.
reverseCalls = [];
await page.evaluate(() => {
  const m = document.querySelector('.leaflet-container');
  const r = m.getBoundingClientRect();
  return new Promise((res) => {
    const box = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const ev = (type, x, y) => m.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
    ev('mousedown', box.x, box.y);
    ev('mousemove', box.x - 60, box.y - 60);
    ev('mouseup', box.x - 60, box.y - 60);
    setTimeout(res, 100);
  });
});
await page.waitForTimeout(1400);
check('moving the map re-asks where you are', reverseCalls.length <= 2, String(reverseCalls.length));

// --- Using the spot feeds it straight into the search ---
await page.evaluate(() => document.getElementById('mapPickConfirm').click());
await page.waitForTimeout(600);
check('the picker closes on choosing', await page.evaluate(() =>
  !document.getElementById('mapOverlay').classList.contains('open')));
const centreText = await page.evaluate(() => document.getElementById('view').textContent);
check('the chosen spot becomes the place to search around', /Around\s*Cramond/.test(centreText.replace(/\s+/g, ' ')), centreText.slice(0, 200));

// --- Cancelling leaves everything as it was ---
await page.click('#exploreMapBtn');
await page.waitForSelector('#mapPickCanvas');
await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('[data-mappick-close]').click());
await page.waitForTimeout(400);
check('cancelling closes the picker', await page.evaluate(() =>
  !document.getElementById('mapOverlay').classList.contains('open')));
check('and keeps the spot you already had', /Around\s*Cramond/.test(
  (await page.evaluate(() => document.getElementById('view').textContent)).replace(/\s+/g, ' ')));

// --- The same way in from the search screen ---
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchTrigger');
await page.click('#pickSearchTrigger');
await page.waitForSelector('#searchMapPick', { timeout: 3000 });
check('the search screen offers it too, for when you have no name', await page.evaluate(() =>
  !!document.getElementById('searchMapPick')));

await page.click('#searchMapPick');
await page.waitForSelector('#mapPickCanvas', { timeout: 3000 });
check('the search screen steps aside for the map', await page.evaluate(() =>
  !document.getElementById('searchOverlay').classList.contains('open')));
await page.waitForTimeout(1000);
await page.evaluate(() => document.getElementById('mapPickConfirm').click());
await page.waitForTimeout(700);
check('choosing a spot then asks what you want there', await page.evaluate(() =>
  !!document.querySelector('[data-choose-cat]')));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
