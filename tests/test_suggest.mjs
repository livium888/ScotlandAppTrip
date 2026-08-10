// Type "Bibu", get "Bibury, Gloucestershire". Beyond saving typing, this
// settles which place you meant up front - the ambiguity that once filed
// Manchester under Glasgow.
//
// The things that break type-ahead: re-rendering the view on each keystroke
// (which takes the keyboard down and loses the caret), firing a request per
// letter, and results arriving out of order so an early query overwrites a
// later one. All three are checked here.
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

let photonCalls = [];
let photonDown = false;
let photonShapeBroken = false;
let photonDelayMs = 0;

const feature = (name, city, state, country, lat, lon, kind) => ({
  properties: { name, city, state, country, osm_value: kind },
  geometry: { coordinates: [lon, lat] },
});

await page.route(/photon\.komoot\.io/, async (route) => {
  const url = decodeURIComponent(route.request().url());
  photonCalls.push(url);
  if (photonDown) return route.abort();
  if (photonShapeBroken) {
    // 200 OK, but not the shape the app parses.
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  }
  if (photonDelayMs) await new Promise((r) => setTimeout(r, photonDelayMs));

  let features = [];
  if (/q=bibu/i.test(url)) {
    features = [
      feature('Bibury', null, 'Gloucestershire', 'England', 51.7594, -1.8318, 'village'),
      feature('Bibury Trout Farm', 'Bibury', 'Gloucestershire', 'England', 51.7588, -1.8302, 'attraction'),
    ];
  } else if (/q=edin/i.test(url)) {
    features = [feature('Edinburgh', null, 'Scotland', 'United Kingdom', 55.9533, -3.1883, 'city')];
  } else if (/q=zzzz/i.test(url)) {
    features = [];
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features }) });
});
// Nominatim is the fallback, so it's mocked rather than blocked - and
// counted, to prove the normal path never reaches it.
let nominatimCalls = [];
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  nominatimCalls.push(decodeURIComponent(route.request().url()));
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '51.7594', lon: '-1.8318', display_name: 'Bibury, Gloucestershire, England',
    type: 'village', namedetails: { name: 'Bibury' },
    address: { county: 'Gloucestershire', country: 'England' } }]) });
});
await page.route(/wikidata|wikipedia|overpass|googleapis|open-meteo|tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-s', boards: [{ id: 'b-s', name: 'Suggest', destination: '', dated: false, hasGuide: false, createdAt: 1 }],
  }));
});
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#exploreToggle');
await page.click('#exploreToggle');
await page.waitForSelector('#exploreSearchInput');

// --- Too few letters isn't worth a request ---
await page.click('#exploreSearchInput');
await page.type('#exploreSearchInput', 'Bi', { delay: 40 });
await page.waitForTimeout(600);
check('two letters asks nothing', photonCalls.length === 0, JSON.stringify(photonCalls));

// --- The example that prompted this ---
await page.type('#exploreSearchInput', 'bu', { delay: 60 });
await page.waitForSelector('[data-suggest]', { timeout: 5000 });
const shown = await page.evaluate(() => document.getElementById('exploreSuggestList').textContent);
check('typing "Bibu" suggests Bibury', /Bibury/.test(shown), shown.slice(0, 200));
check('and says which Bibury', /Gloucestershire|England/.test(shown), shown.slice(0, 200));
check('more than one match is offered', await page.evaluate(() =>
  document.querySelectorAll('[data-suggest]').length >= 2));

// --- Typing four letters must not mean four requests ---
check('one request, not one per letter', photonCalls.length === 1, JSON.stringify(photonCalls));

// --- The keyboard must survive typing ---
check('the field keeps focus while suggesting', await page.evaluate(() =>
  document.activeElement && document.activeElement.id === 'exploreSearchInput'));
check('and keeps what was typed', await page.evaluate(() =>
  document.getElementById('exploreSearchInput').value === 'Bibu'));

// --- Choosing one sets the place, with no second lookup to get wrong ---
// Cleared here so this measures the act of choosing, not the destination
// lookup the weather does on load.
nominatimCalls = [];
await page.evaluate(() => document.querySelector('[data-suggest]').click());
await page.waitForTimeout(500);
const centre = await page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
check('choosing a suggestion sets where to search', /Around\s*Bibury/.test(centre), centre.slice(0, 200));
check('the county is kept, so it is the right Bibury', /Gloucestershire/.test(centre), centre.slice(0, 200));
check('the list closes once chosen', await page.evaluate(() => {
  const l = document.getElementById('exploreSuggestList');
  return !l || l.hidden;
}));
check('choosing a suggestion needs no further lookup - the coordinates came with it',
  nominatimCalls.length === 0, JSON.stringify(nominatimCalls));

// --- A late reply must not overwrite a newer one ---
photonCalls = [];
// Explore is still open - the toggle would collapse it, not reopen it.
await page.waitForSelector('#exploreSearchInput');
photonDelayMs = 900;
await page.click('#exploreSearchInput');
await page.type('#exploreSearchInput', 'bibu', { delay: 30 });
await page.waitForTimeout(400);
photonDelayMs = 0;
await page.fill('#exploreSearchInput', '');
await page.type('#exploreSearchInput', 'edin', { delay: 30 });
await page.waitForSelector('[data-suggest]', { timeout: 5000 });
await page.waitForTimeout(1200); // long enough for the slow first reply to land
const after = await page.evaluate(() => document.getElementById('exploreSuggestList').textContent);
check('a slow earlier reply does not replace a newer one', /Edinburgh/.test(after) && !/Bibury/.test(after), after.slice(0, 200));

// --- Nothing found says so ---
await page.fill('#exploreSearchInput', '');
await page.type('#exploreSearchInput', 'zzzz', { delay: 30 });
await page.waitForTimeout(900);
check('no matches is stated, not left blank', /No places matching/.test(
  await page.evaluate(() => document.getElementById('exploreSuggestList').textContent)));

// --- If the suggestion service fails or changes shape, fall back ---
// This one matters more than it looks: the live API could not be reached
// from the build sandbox, so a shape mismatch is a real possibility. It must
// degrade to a second source, not to a silent "no such place".
photonDown = true;
nominatimCalls = [];
await page.fill('#exploreSearchInput', '');
await page.type('#exploreSearchInput', 'bibu', { delay: 30 });
await page.waitForTimeout(1200);
check('a failed suggestion service falls back to another', /Bibury/.test(
  await page.evaluate(() => document.getElementById('exploreSuggestList').textContent)));
check('and the fallback is the one that actually got asked', nominatimCalls.length >= 1, String(nominatimCalls.length));

// A response of the wrong shape must be treated as a failure, not as "no
// such place" - those look identical to the user and one of them is a lie.
photonDown = false;
photonShapeBroken = true;
nominatimCalls = [];
await page.fill('#exploreSearchInput', '');
await page.type('#exploreSearchInput', 'edin', { delay: 30 });
await page.waitForTimeout(1200);
check('an unexpected response shape falls back too', nominatimCalls.length >= 1, String(nominatimCalls.length));
check('and does not claim the place does not exist', !/No places matching/.test(
  await page.evaluate(() => document.getElementById('exploreSuggestList').textContent)));

// --- Only when everything is down does it say so ---
photonDown = true;
await page.unroute(/nominatim\.openstreetmap\.org/);
await page.route(/nominatim\.openstreetmap\.org/, (r) => r.abort());
await page.fill('#exploreSearchInput', '');
await page.type('#exploreSearchInput', 'bibu', { delay: 30 });
await page.waitForTimeout(1400);
const downMsg = await page.evaluate(() => document.getElementById('exploreSuggestList').textContent);
check('with both down it explains itself and points at the search button', /Suggestions unavailable/.test(downMsg), downMsg.slice(0, 160));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
