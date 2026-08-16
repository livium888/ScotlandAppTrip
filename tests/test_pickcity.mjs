// Typing a town, watching the autocomplete find it, tapping it - and getting
// a screen of bars and restaurants with the town nowhere on it.
//
// Two causes, compounding.
//
// The suggestion already knew what it was: Photon returns osm_value "town"
// with coordinates. Tapping one threw that away and re-searched by name as a
// string, so whether the town appeared in its own results depended on a second
// lookup agreeing.
//
// And that second lookup was handed a name that had already been qualified -
// "Pitlochry, Perth and Kinross, Scotland" - onto which the board's
// destination was appended again, giving "..., Scotland, Scotland". The
// geocoder answers that with nothing. So the town vanished and the AI's cafés
// were all that was left.
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

const readPicks = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-p:picks') || '[]'));

// The autocomplete knows it is a town.
await page.route(/photon\.komoot\.io/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    features: [{
      geometry: { coordinates: [-3.7317, 56.7028] },
      properties: { name: 'Pitlochry', state: 'Perth and Kinross', country: 'Scotland', osm_value: 'town', osm_key: 'place' },
    }],
  }) }));

// The AI answers the way it really does - with businesses.
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([
      { name: 'Moulin Inn', area: 'Pitlochry', why: 'Old inn up the hill.' },
      { name: 'Victoria’s Restaurant', area: 'Pitlochry', why: 'High street standby.' },
    ]) }] } }],
  }) });
});

// The geocoder, behaving as it does with an over-qualified string: nothing at
// all for the doubled one, the town for a sensible one. If the app double
// scopes, it gets nothing - which is exactly what went wrong.
let geocodeQueries = [];
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const url = decodeURIComponent(route.request().url());
  const q = (/[?&]q=([^&]*)/.exec(url) || [])[1] || '';
  geocodeQueries.push(q);
  if (/Scotland,\s*Scotland/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  }
  const inn = [{
    lat: '56.7120', lon: '-3.7290', display_name: 'Moulin Inn, Pitlochry', type: 'pub', class: 'amenity',
    namedetails: { name: 'Moulin Inn' }, address: { town: 'Pitlochry' }, extratags: {},
  }];
  const town = [{
    lat: '56.7028', lon: '-3.7317', display_name: 'Pitlochry, Perth and Kinross, Scotland', type: 'town',
    class: 'place', namedetails: { name: 'Pitlochry' }, address: { town: 'Pitlochry' }, extratags: {},
  }];
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(/Moulin|Victoria/i.test(q) ? inn : town) });
});
await page.route(/wikidata|wikipedia|overpass|tile\.|open-meteo/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-p', boards: [{ id: 'b-p', name: 'Scotland', destination: 'Scotland', dated: false, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
    travellers: 'family of 3, 4-year-old who walks',
  }));
});
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchTrigger');

// ---------- Type, and take what the autocomplete offers ----------

await page.click('#pickSearchTrigger');
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'Pitloch');
await page.waitForSelector('[data-suggest]', { timeout: 8000 });
check('the autocomplete finds the town', await page.evaluate(() =>
  /Pitlochry/.test(document.getElementById('pickSuggestList').textContent)));
check('and shows it as a place, not a business', await page.evaluate(() =>
  /🏘️/.test(document.getElementById('pickSuggestList').textContent)),
  await page.evaluate(() => document.getElementById('pickSuggestList').textContent));

geocodeQueries = [];
await page.evaluate(() => document.querySelector('[data-suggest]').click());
await page.waitForTimeout(2500);

// ---------- The town is the first thing on the screen ----------

const names = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.search-result .place-name')).map((e) => e.textContent.trim()));
check('the town you tapped is in the results', names.some((n) => /^Pitlochry/.test(n)), JSON.stringify(names));
check('and it is first, ahead of the bars', /^Pitlochry/.test(names[0] || ''), JSON.stringify(names));
check('marked as a town', await page.evaluate(() =>
  !!document.querySelector('.search-result-area .area-badge')));
check('the AI results are still there, below it', names.some((n) => /Moulin/.test(n)), JSON.stringify(names));

// The reason it used to fail: the destination appended to a name that already
// ended in it.
check('the lookup is not handed "Scotland, Scotland"',
  !geocodeQueries.some((q) => /Scotland,\s*Scotland/i.test(q)),
  JSON.stringify(geocodeQueries).slice(0, 240));

// ---------- Saving it as a city takes one tap ----------

await page.evaluate(() => document.querySelector('.search-result-area [data-add-candidate]').click());
await page.waitForTimeout(1800);

const town = (await readPicks()).find((p) => p.name === 'Pitlochry');
check('it saves', !!town, JSON.stringify((await readPicks()).map((p) => p.name)));
check('as an area, not as something to do', !!town && town.major === true, JSON.stringify(town));
check('under its own name', !!town && town.city === 'Pitlochry', JSON.stringify(town));
check('with its real coordinates, from the suggestion', !!town && Math.abs(town.lat - 56.7028) < 0.01,
  JSON.stringify(town && { lat: town.lat, lon: town.lon }));

await page.evaluate(() => document.querySelector('[data-search-close]').click());
await page.waitForTimeout(700);
check('and it heads its own section in the list', await page.evaluate(() =>
  !!document.querySelector('.area-head-name') &&
  /Pitlochry/.test(document.querySelector('.area-head-name').textContent)));

// ---------- Even when the follow-up lookup finds nothing at all ----------
// The suggestion carried coordinates and a kind, so the town does not depend
// on a second opinion.

await page.route(/nominatim\.openstreetmap\.org/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'Pitloch');
await page.waitForSelector('[data-suggest]', { timeout: 8000 });
await page.evaluate(() => document.querySelector('[data-suggest]').click());
await page.waitForTimeout(2500);

check('the town survives a geocoder that answers nothing', await page.evaluate(() =>
  /Pitlochry/.test((document.querySelector('.search-result .place-name') || {}).textContent || '')),
  await page.evaluate(() => document.getElementById('searchOverlay').textContent.slice(0, 160)));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
