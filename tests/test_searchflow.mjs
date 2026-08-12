// Search, followed from end to end, for the ways it is actually used.
//
// Bounding the search was only half the job, and the half that was done first.
// Every lookup that ran *after* it - the preview map, the save, the background
// enrich - called the geocoder with no bounds at all. So a result could be
// found correctly, shown correctly, and then placed in Oxford the moment you
// opened or saved it. And a coordinate typed into the box that decides where
// to look was being handed to a text search, which answered with whatever it
// could match: the anchor itself, the thing meant to keep results local, could
// be set to the wrong end of the country before a single search ran.
//
// The rule these check is one line: a coordinate outside the area being
// searched is never assigned to anything. Refusing is deliberate. No
// coordinates is a place you can still save, read and put on a day; wrong
// coordinates are a map that lies, a distance that lies, and a folder chosen
// from both.
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

const PITLOCHRY = { lat: 56.7028, lon: -3.7317 };
const OXFORD = { lat: 51.7520, lon: -1.2577 };

let aiResults = () => [];
let aiPrompts = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  let prompt = '';
  try { prompt = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text; } catch (e) { /* not a prompt */ }
  aiPrompts.push(prompt);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(aiResults(prompt)) }] } }] }) });
});

// A geocoder that behaves like the real one. The key line is the last: a name
// it cannot place near you, it places wherever it can - and that is always
// somewhere, never nothing.
let geoCalls = [];
const place = (name, p, type = 'cafe', cls = 'amenity') => ({
  lat: String(p.lat), lon: String(p.lon), display_name: `${name}, ${p === OXFORD ? 'Oxford' : 'Pitlochry'}`,
  type, class: cls, namedetails: { name }, address: { town: p === OXFORD ? 'Oxford' : 'Pitlochry' }, extratags: {},
});
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const url = decodeURIComponent(route.request().url());
  const q = (/[?&]q=([^&]*)/.exec(url) || [])[1] || '';
  const bounded = /bounded=1/.test(url);
  const reverse = /\/reverse/.test(url);
  geoCalls.push({ q, bounded, reverse, url });

  if (reverse) {
    const lat = Number((/lat=([^&]*)/.exec(url) || [])[1]);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      name: lat > 55 ? 'Ben Vrackie' : 'Somewhere else',
      address: { town: lat > 55 ? 'Pitlochry' : 'Oxford' },
      display_name: lat > 55 ? 'Ben Vrackie, Pitlochry' : 'Oxford',
    }) });
  }
  if (/^Pitlochry/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      place('Pitlochry', PITLOCHRY, 'town', 'place')]) });
  }
  // The one the whole file is about: a name with no match near Pitlochry, and
  // a confident match 350 miles away.
  if (/Blue Door/i.test(q)) {
    if (bounded) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([place('The Blue Door', OXFORD)]) });
  }
  if (/Moulin Inn/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([place('Moulin Inn', PITLOCHRY, 'pub')]) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await page.route(/wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis/, (r) => r.abort());

const picks = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-f:picks') || '[]'));
const anchor = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-f:search-anchor') || 'null'));
const anchorBar = () => page.evaluate(() => (document.querySelector('.search-anchor-text') || {}).textContent || '');
const names = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.search-result .place-name')).map((e) => e.textContent.trim()));
const milesFrom = (p, q) => {
  const R = 6371;
  const dLat = ((q.lat - p.lat) * Math.PI) / 180;
  const dLon = ((q.lon - p.lon) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((p.lat * Math.PI) / 180) * Math.cos((q.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a)) * 0.621371;
};

async function seed() {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b-f', boards: [{ id: 'b-f', name: 'Flow', destination: 'Scotland', dated: false, hasGuide: false, createdAt: 1 }],
    }));
    localStorage.setItem('trip-settings-v1', JSON.stringify({
      destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite', travellers: 'family of 3',
    }));
    localStorage.setItem('board:b-f:folders', JSON.stringify(['Pitlochry']));
    localStorage.setItem('board:b-f:picks', JSON.stringify([
      { id: 'custom:Pitlochry', name: 'Pitlochry', city: 'Pitlochry', major: true, category: 'Town',
        lat: 56.7028, lon: -3.7317, addedAt: 1 },
    ]));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
  await page.waitForSelector('#pickSearchTrigger');
}

const openSearch = async () => {
  await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
  await page.waitForSelector('#pickSearchInput');
};
const runQuery = async (text) => {
  await page.fill('#pickSearchInput', text);
  await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
  await page.waitForTimeout(2500);
};
const setAnchorText = async (text) => {
  await page.evaluate(() => document.querySelector('[data-anchor-open]').click());
  await page.waitForSelector('#anchorForm', { timeout: 4000 });
  await page.fill('#anchorInput', text);
  await page.evaluate(() => document.getElementById('anchorForm').requestSubmit());
  await page.waitForTimeout(2500);
};

await page.goto(BASE, { waitUntil: 'load' });
await seed();

// ---------- Scenario: a coordinate as the area to search ----------
// Typed into the box, this used to go to a text search. Nominatim answers a
// text search for "56.7028, -3.7317" with whatever it can match.

await openSearch();
geoCalls = [];
await setAnchorText('56.7028, -3.7317');
const fromPoint = await anchor();
check('a coordinate is read as a coordinate', !!fromPoint && Math.abs(fromPoint.lat - 56.7028) < 0.001,
  JSON.stringify(fromPoint));
check('and never sent to a text search', !geoCalls.some((c) => !c.reverse && /56\.7028/.test(c.q)),
  JSON.stringify(geoCalls.map((c) => c.q).slice(0, 4)));
check('it is named from where it actually is', !!fromPoint && /Ben Vrackie|Pitlochry/.test(fromPoint.name),
  JSON.stringify(fromPoint));
check('and the screen says so', /Ben Vrackie|Pitlochry/.test(await anchorBar()), await anchorBar());

// The same, written the other ways people write coordinates.
for (const [text, label] of [
  ['56.7028 -3.7317', 'a space instead of a comma'],
  ['56.7028N, 3.7317W', 'with compass letters'],
]) {
  await setAnchorText(text);
  const got = await anchor();
  check(`a coordinate written with ${label} works too`,
    !!got && Math.abs(got.lat - 56.7028) < 0.01 && Math.abs(got.lon + 3.7317) < 0.01, JSON.stringify(got));
}

// ---------- Scenario: a coordinate typed as the search itself ----------

await setAnchorText('56.7028, -3.7317');
aiResults = () => [{ name: 'Moulin Inn', area: 'Pitlochry', postcode: '', why: 'Up the hill.' }];
const before = await anchorBar();
await runQuery('51.7520, -1.2577');
// Not saved over the standing one - a one-off search somewhere else should not
// silently repoint every search after it - but it is what this search ran
// against, and the screen has to say so.
check('a coordinate typed as the query moves that search to it',
  (await anchorBar()) !== before && !/Pitlochry|Ben Vrackie/.test(await anchorBar()), await anchorBar());
check('and the standing area is left as it was',
  (await anchor()).lat > 55, JSON.stringify(await anchor()));

// ---------- Scenario: the AI names somewhere OSM cannot place nearby ----------
// The case that produced Oxford. The name has no local match and a confident
// one 350 miles away, and every lookup after the search used to be unbounded.

await seed();
await openSearch();
await setAnchorText('Pitlochry');
aiResults = () => [{ name: 'The Blue Door', area: 'Pitlochry', postcode: '', why: 'A cafe nobody has mapped.' }];
geoCalls = [];
await runQuery('cafe');

const listed = await names();
// The suggestion is kept - it may be a real place nobody has mapped - but it
// is not given the far-away coordinate.
check('the suggestion is still offered', listed.some((n) => /Blue Door/.test(n)), JSON.stringify(listed));
check('and it is not placed 350 miles away',
  !(await page.evaluate(() => /Oxford/.test(document.getElementById('searchOverlay').textContent))),
  await page.evaluate(() => document.getElementById('searchOverlay').textContent.slice(0, 200)));

// Opening it runs its own lookup, which used to be the unbounded one.
await page.evaluate(() => document.querySelector('[data-preview-candidate]').click());
await page.waitForSelector('#placeModal.open', { timeout: 4000 });
await page.waitForTimeout(1800);
check('opening it does not place it there either',
  !(await page.evaluate(() => /Oxford/.test(document.getElementById('placeModal').textContent))),
  await page.evaluate(() => document.getElementById('placeModal').textContent.slice(0, 200)));
check('and it draws no map rather than a wrong one', await page.evaluate(() =>
  !document.getElementById('previewMap')));
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.waitForTimeout(300);

// ---------- Scenario: saving one ----------
// The save re-resolves anything without coordinates. Unbounded, that is how a
// place you saved in Perthshire ended up pinned in Oxfordshire.

aiResults = () => [
  { name: 'Moulin Inn', area: 'Pitlochry', postcode: '', why: 'Up the hill.' },
  { name: 'The Blue Door', area: 'Pitlochry', postcode: '', why: 'Unmapped.' },
];
await runQuery('pub');
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
await page.waitForTimeout(2500);

const saved = await picks();
const placed = saved.filter((p) => p.lat != null && p.id !== 'custom:Pitlochry');
check('anything saved keeps a position inside the area, or none at all',
  placed.every((p) => milesFrom(PITLOCHRY, { lat: p.lat, lon: p.lon }) < 40),
  JSON.stringify(placed.map((p) => ({ n: p.name, mi: Math.round(milesFrom(PITLOCHRY, { lat: p.lat, lon: p.lon })) }))));
check('and none of them landed in Oxford',
  !saved.some((p) => p.lat != null && milesFrom(OXFORD, { lat: p.lat, lon: p.lon }) < 30),
  JSON.stringify(saved.map((p) => p.name)));

// ---------- Scenario: a place saved with no coordinates at all ----------
// The background enrich fills these in later, and used to do it unbounded.

await page.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('board:b-f:picks'));
  list.push({ id: 'custom:The Blue Door', name: 'The Blue Door', city: 'Pitlochry', category: 'Cafe',
    lat: null, lon: null, addedAt: 2 });
  localStorage.setItem('board:b-f:picks', JSON.stringify(list));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(2500);
const enriched = (await picks()).find((p) => p.name === 'The Blue Door');
check('filling in a missing position later cannot move it 350 miles',
  !!enriched && (enriched.lat == null || milesFrom(PITLOCHRY, { lat: enriched.lat, lon: enriched.lon }) < 40),
  JSON.stringify(enriched && { lat: enriched.lat, lon: enriched.lon }));

// ---------- Scenario: no anchor at all ----------
// "Anywhere" has to mean anywhere, or searching for somewhere you are not yet
// would be impossible.

await openSearch();
await page.evaluate(() => document.querySelector('[data-anchor-open]').click());
await page.waitForSelector('#anchorAnywhere', { timeout: 4000 });
await page.evaluate(() => document.getElementById('anchorAnywhere').click());
await page.waitForTimeout(1500);
aiResults = () => [{ name: 'The Blue Door', area: 'Oxford', postcode: '', why: 'Genuinely in Oxford.' }];
await runQuery('cafe');
check('with no area set, a distant result is allowed through',
  await page.evaluate(() => /Blue Door/.test(document.getElementById('searchOverlay').textContent)),
  await page.evaluate(() => document.getElementById('searchOverlay').textContent.slice(0, 200)));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
