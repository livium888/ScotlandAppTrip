// One map with every saved place on it. The things worth pinning down here
// are the ones that have broken maps in this app before: a pick with no
// coordinates must not take the screen down, the overlay must be sized after
// it's visible, and the Google Maps hand-off has to build a route Google will
// actually accept (one origin, one destination, at most nine waypoints).
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 800 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

// No network at all: the map must still draw its pins with only the tiles
// missing, which is the state a phone in a Highland car park is actually in.
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|tile\./, (r) => r.abort());

const SEED = {
  picks: [
    { id: 'custom:Edinburgh Castle', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999, booked: true },
    { id: 'custom:Camera Obscura', name: 'Camera Obscura', city: 'Edinburgh', category: 'Attraction', lat: 55.9489, lon: -3.1953 },
    { id: 'custom:Kelvingrove', name: 'Kelvingrove', city: 'Glasgow', category: 'Museum', lat: 55.8687, lon: -4.2907 },
    { id: 'custom:No Coords Cafe', name: 'No Coords Cafe', city: 'Edinburgh', category: 'Cafe' },
  ],
  folders: ['Edinburgh', 'Glasgow'],
  plan: {
    days: [{ id: 'd0', label: 'Day 1 · Wed 19 Aug' }, { id: 'd1', label: 'Day 2 · Thu 20 Aug' }],
    items: {
      d0: [{ pickId: 'custom:Edinburgh Castle', time: '10:00' }, { pickId: 'custom:Camera Obscura', time: '13:00' }],
      d1: [],
    },
  },
};

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate((seed) => {
  localStorage.clear();
  localStorage.setItem('scotland-trip-picks-v1', JSON.stringify(seed.picks));
  localStorage.setItem('scotland-trip-folders-v1', JSON.stringify(seed.folders));
  localStorage.setItem('trip-plan-v1', JSON.stringify(seed.plan));
}, SEED);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);

// --- The map is reachable from anywhere, not buried in one tab ---
check('map button lives in the top bar', await page.evaluate(() => !!document.getElementById('mapBtn')));

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(200);
await page.click('#mapBtn');
await page.waitForSelector('#mapOverlay.open', { timeout: 3000 });
await page.waitForTimeout(600);

// --- Everything mappable is on it, and the unmappable one is accounted for ---
const pins = await page.evaluate(() => document.querySelectorAll('.map-pin').length);
check('every place with coordinates gets a pin', pins === 3, String(pins));
const headText = await page.evaluate(() => document.querySelector('.map-head').textContent);
check('counts what is shown', /3 on the map/.test(headText), headText);
check('says the one without a location is missing', /1 still without a location/.test(headText), headText);

// A null coordinate reaching Leaflet used to blank the whole screen.
check('the coordinate-less pick did not break the render', await page.evaluate(() =>
  document.querySelectorAll('#allMapCanvas .leaflet-container, #allMapCanvas.leaflet-container').length > 0
  || !!document.querySelector('#allMapCanvas .leaflet-pane')));

// The overlay is laid out only once visible - a stale size shows one tile in
// the corner and nothing else.
const sized = await page.evaluate(() => {
  const el = document.getElementById('allMapCanvas');
  return { w: el.clientWidth, h: el.clientHeight };
});
check('map canvas fills the screen', sized.w > 300 && sized.h > 300, JSON.stringify(sized));

// --- Filters: days and folders ---
const chips = await page.evaluate(() => Array.from(document.querySelectorAll('#mapOverlay .map-chip')).map((c) => c.textContent.trim()));
check('All, the planned day and each folder are offered', chips[0] === 'All' && chips.includes('Wed 19') && chips.includes('Edinburgh') && chips.includes('Glasgow'), JSON.stringify(chips));
check('an empty day is not offered as a filter', !chips.includes('Thu 20'), JSON.stringify(chips));

await page.evaluate(() => document.querySelector('[data-map-filter="folder:Glasgow"]').click());
await page.waitForTimeout(500);
check('filtering to a folder narrows the pins', await page.evaluate(() => document.querySelectorAll('.map-pin').length) === 1);

await page.evaluate(() => document.querySelector('[data-map-filter="day:d0"]').click());
await page.waitForTimeout(500);
const dayPins = await page.evaluate(() => Array.from(document.querySelectorAll('.map-pin')).map((p) => p.textContent.trim()));
check('a day\'s pins are numbered in plan order', JSON.stringify(dayPins) === '["1","2"]', JSON.stringify(dayPins));

// --- Google Maps hand-off ---
let opened = null;
await page.evaluate(() => { window.open = (url) => { window.__opened = url; return null; }; });
await page.evaluate(() => document.getElementById('allMapGoogle').click());
await page.waitForTimeout(200);
opened = await page.evaluate(() => window.__opened);
check('opens a real Google Maps route', /google\.com\/maps\/dir\/\?api=1/.test(opened || ''), String(opened));
check('route runs between the day\'s two places', /origin=55\.9486,-3\.1999/.test(opened) && /destination=55\.9489,-3\.1953/.test(opened), String(opened));
check('walking, because that is how this trip moves', /travelmode=walking/.test(opened), String(opened));

// --- A pin leads to the place itself ---
await page.evaluate(() => document.querySelector('.map-pin-wrap').click());
await page.waitForSelector('.map-pop-name', { timeout: 3000 });
const pop = await page.evaluate(() => document.querySelector('.map-pop').textContent);
check('the pin popup names the place and its time', /Edinburgh Castle/.test(pop) && /10:00/.test(pop), pop);

await page.evaluate(() => document.querySelector('[data-map-detail]').click());
await page.waitForSelector('#placeModal.open', { timeout: 3000 });
check('Details opens that place\'s sheet', /Edinburgh Castle/.test(await page.evaluate(() => document.querySelector('.modal-title').textContent)));
check('the map gets out of the way when it does', await page.evaluate(() => !document.getElementById('mapOverlay').classList.contains('open')));

// --- Back closes the map rather than the app ---
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.click('#mapBtn');
await page.waitForSelector('#mapOverlay.open');
await page.goBack();
await page.waitForTimeout(400);
check('Android back closes the map', await page.evaluate(() => !document.getElementById('mapOverlay').classList.contains('open')));
check('and leaves the app where it was', await page.evaluate(() => !!document.getElementById('view').textContent.trim()));

// --- Opening from Today starts on today, not on all forty saved places ---
await page.evaluate(() => document.querySelector('[data-view="today"]').click());
await page.waitForTimeout(300);
await page.click('#mapBtn');
await page.waitForSelector('#mapOverlay.open');
await page.waitForTimeout(500);
const activeChip = await page.evaluate(() => document.querySelector('#mapOverlay .map-chip.on').textContent.trim());
check('map opened from Today starts on that day', activeChip === 'Wed 19', activeChip);

// --- An empty board says so instead of showing a blank grey rectangle ---
await page.evaluate(() => document.querySelector('[data-map-close]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.topbar-text').click());
await page.waitForSelector('#newBoardName');
await page.fill('#newBoardName', 'Weekend list');
await page.evaluate(() => { document.getElementById('newBoardDated').checked = false; });
await page.click('#createBoardBtn');
await page.waitForTimeout(600);
await page.click('#mapBtn');
await page.waitForSelector('#mapOverlay.open');
await page.waitForTimeout(300);
const emptyText = await page.evaluate(() => document.getElementById('mapOverlay').textContent);
check('an empty board explains itself', /Nothing saved here yet/.test(emptyText), emptyText.slice(0, 160));
check('and does not show the other board\'s places', await page.evaluate(() => document.querySelectorAll('.map-pin').length) === 0);

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
