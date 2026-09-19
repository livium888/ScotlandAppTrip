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

// The app now meets a first-time user with three questions before anything
// else. This suite is about a trip already under way, so it answers the door
// on the way in - re-applied on every navigation, since these tests clear
// storage and reload.
await page.addInitScript(() => {
  try { localStorage.setItem('onboarded-v1', '1'); } catch (e) { /* nothing to do */ }
});
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
// The type-ahead lives on the one search field now, so this opens the search
// screen rather than the Explore panel.
await page.waitForSelector('#pickSearchTrigger');
await page.click('#pickSearchTrigger');
await page.waitForSelector('#pickSearchInput');

// --- Too few letters isn't worth a request ---
await page.click('#pickSearchInput');
await page.type('#pickSearchInput', 'Bi', { delay: 40 });
await page.waitForTimeout(600);
check('two letters asks nothing', photonCalls.length === 0, JSON.stringify(photonCalls));

// --- The example that prompted this ---
await page.type('#pickSearchInput', 'bu', { delay: 60 });
await page.waitForSelector('[data-suggest]', { timeout: 5000 });
const shown = await page.evaluate(() => document.getElementById('pickSuggestList').textContent);
check('typing "Bibu" suggests Bibury', /Bibury/.test(shown), shown.slice(0, 200));
check('and says which Bibury', /Gloucestershire|England/.test(shown), shown.slice(0, 200));
check('more than one match is offered', await page.evaluate(() =>
  document.querySelectorAll('[data-suggest]').length >= 2));

// --- Typing four letters must not mean four requests ---
check('one request, not one per letter', photonCalls.length === 1, JSON.stringify(photonCalls));

// --- The keyboard must survive typing ---
check('the field keeps focus while suggesting', await page.evaluate(() =>
  document.activeElement && document.activeElement.id === 'pickSearchInput'));
check('and keeps what was typed', await page.evaluate(() =>
  document.getElementById('pickSearchInput').value === 'Bibu'));

// --- Choosing one searches for it, keeping what made it unambiguous ---
// The suggestion used to set the Explore centre directly. There is one search
// now, so choosing runs it - and the point that survives is that the county
// goes with the name: "Bibury" alone could resolve anywhere.
nominatimCalls = [];
await page.evaluate(() => document.querySelector('[data-suggest]').click());
await page.waitForTimeout(900);
check('choosing a suggestion fills the field with the full name', await page.evaluate(() =>
  /Bibury/.test(document.getElementById('pickSearchInput').value) &&
  /Gloucestershire/.test(document.getElementById('pickSearchInput').value)),
  await page.evaluate(() => document.getElementById('pickSearchInput').value));
check('and searches for it', await page.evaluate(() =>
  document.getElementById('searchOverlay').classList.contains('open')));
check('the county is carried into the lookup, so it is the right Bibury',
  nominatimCalls.some((u) => /Gloucestershire/.test(decodeURIComponent(u))),
  JSON.stringify(nominatimCalls).slice(0, 200));
check('the list closes once chosen', await page.evaluate(() => {
  const l = document.getElementById('pickSuggestList');
  return !l || l.hidden;
}));

// --- A late reply must not overwrite a newer one ---
photonCalls = [];
// The search screen is still open.
await page.waitForSelector('#pickSearchInput');
photonDelayMs = 900;
await page.click('#pickSearchInput');
await page.type('#pickSearchInput', 'bibu', { delay: 30 });
await page.waitForTimeout(400);
photonDelayMs = 0;
await page.fill('#pickSearchInput', '');
await page.type('#pickSearchInput', 'edin', { delay: 30 });
await page.waitForSelector('[data-suggest]', { timeout: 5000 });
await page.waitForTimeout(1200); // long enough for the slow first reply to land
const after = await page.evaluate(() => document.getElementById('pickSuggestList').textContent);
check('a slow earlier reply does not replace a newer one', /Edinburgh/.test(after) && !/Bibury/.test(after), after.slice(0, 200));

// --- Nothing found says so ---
await page.fill('#pickSearchInput', '');
await page.type('#pickSearchInput', 'zzzz', { delay: 30 });
await page.waitForTimeout(900);
check('no matches is stated, not left blank', /No places matching/.test(
  await page.evaluate(() => document.getElementById('pickSuggestList').textContent)));

// --- If the suggestion service fails or changes shape, fall back ---
// This one matters more than it looks: the live API could not be reached
// from the build sandbox, so a shape mismatch is a real possibility. It must
// degrade to a second source, not to a silent "no such place".
photonDown = true;
nominatimCalls = [];
await page.fill('#pickSearchInput', '');
await page.type('#pickSearchInput', 'bibu', { delay: 30 });
await page.waitForTimeout(1200);
check('a failed suggestion service falls back to another', /Bibury/.test(
  await page.evaluate(() => document.getElementById('pickSuggestList').textContent)));
check('and the fallback is the one that actually got asked', nominatimCalls.length >= 1, String(nominatimCalls.length));

// A response of the wrong shape must be treated as a failure, not as "no
// such place" - those look identical to the user and one of them is a lie.
photonDown = false;
photonShapeBroken = true;
nominatimCalls = [];
await page.fill('#pickSearchInput', '');
await page.type('#pickSearchInput', 'edin', { delay: 30 });
await page.waitForTimeout(1200);
check('an unexpected response shape falls back too', nominatimCalls.length >= 1, String(nominatimCalls.length));
check('and does not claim the place does not exist', !/No places matching/.test(
  await page.evaluate(() => document.getElementById('pickSuggestList').textContent)));

// --- Only when everything is down does it say so ---
photonDown = true;
await page.unroute(/nominatim\.openstreetmap\.org/);
await page.route(/nominatim\.openstreetmap\.org/, (r) => r.abort());
await page.fill('#pickSearchInput', '');
await page.type('#pickSearchInput', 'bibu', { delay: 30 });
await page.waitForTimeout(1400);
const downMsg = await page.evaluate(() => document.getElementById('pickSuggestList').textContent);
check('with both down it explains itself and points at the search button', /Suggestions unavailable/.test(downMsg), downMsg.slice(0, 160));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
