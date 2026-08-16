// Phase 0: one location model.
//
// Three fixes to wrong-place results found three real holes and none of them
// found the cause. An audit did: when no search area has been set - the
// default state of every board - derivedAnchor() invented one from the
// centroid of the saved places, with a radius stretched to reach the furthest
// of them, capped at 150 miles. Places across Scotland plus one saved in
// London put that centre in the Midlands inside a circle containing both. Every
// proximity check was then answering correctly about the wrong area.
//
// Two more of the same family are covered here: an area the app guessed used
// to look exactly like one you chose, and a query that derived its own area
// (a postcode, a coordinate pair) set it in one place while everything
// afterwards - opening a result, saving it, enriching it - read another from
// storage.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.addInitScript(() => {
  try { localStorage.setItem('onboarded-v1', '1'); } catch (e) { /* nothing to do */ }
});
await page.route(/generativelanguage|wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis|upload\./, (r) => r.abort());
// Records every bounding box the app asks the geocoder for.
let boxes = [];
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const url = decodeURIComponent(route.request().url());
  const m = /viewbox=([^&]+)/.exec(url);
  if (m) boxes.push(m[1].split(',').map(Number));
  // One result, so the search has something to open - the follow-up lookups
  // are where the two anchors used to diverge, and with an empty list they
  // never ran at all.
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '57.4437', lon: '-6.5906', display_name: 'Dunvegan, Skye', type: 'attraction',
    class: 'tourism', namedetails: { name: 'Dunvegan' }, address: { town: 'Skye' }, extratags: {} }]) });
});

const seed = async (picks) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((list) => {
    localStorage.clear();
    localStorage.setItem('onboarded-v1', '1');
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b-1', boards: [{ id: 'b-1', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
    localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Scotland', geminiKey: '', geminiModel: '' }));
    localStorage.setItem('board:b-1:picks', JSON.stringify(list));
    localStorage.setItem('board:b-1:plan', JSON.stringify({ days: [], items: {} }));
  }, picks);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
  await page.waitForTimeout(300);
};
const anchorBar = () => page.evaluate(() =>
  (document.querySelector('.search-anchor-text') || {}).textContent || '');
const openSearch = async () => {
  await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
  await page.waitForSelector('#pickSearchInput');
  await page.waitForTimeout(300);
};

// ---------- A guess never spans the country ----------
// Edinburgh, Skye and one saved place in London: the centroid is in northern
// England and the old radius reached 150 miles from it.
await seed([
  { id: 'p1', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999, addedAt: 1, photoChecked: true },
  { id: 'p2', name: 'Dunvegan Castle', city: 'Skye', category: 'Castle', lat: 57.4437, lon: -6.5906, addedAt: 2, photoChecked: true },
  { id: 'p3', name: 'The Chelsea Kitchen', city: 'London', category: 'Cafe', lat: 51.4875, lon: -0.1687, addedAt: 3, photoChecked: true },
]);
await openSearch();
const spread = await anchorBar();
check('an area guessed from places scattered across the country is refused',
  /anywhere/i.test(spread), spread);

// ---------- A guess that is reasonable is offered, and admits it is a guess ----------
await seed([
  { id: 'p1', name: 'Stirling Castle', city: 'Stirling', category: 'Castle', lat: 56.1237, lon: -3.9474, addedAt: 1, photoChecked: true },
  { id: 'p2', name: 'Wallace Monument', city: 'Stirling', category: 'Monument', lat: 56.1385, lon: -3.9200, addedAt: 2, photoChecked: true },
]);
await openSearch();
const guessed = await anchorBar();
check('a guess from places in one place is still offered', /miles/.test(guessed), guessed);
check('and it never exceeds the radius you would have chosen yourself',
  /\b25 miles\b/.test(guessed), guessed);
check('and it says out loud that it is a guess', /guessing/i.test(guessed), guessed);
check('offering to set it properly rather than just "change"', await page.evaluate(() =>
  /set it/i.test((document.querySelector('.search-anchor-change') || {}).textContent || '')));

// ---------- One anchor governs a whole search ----------
// A coordinate typed as the query anchors that search to itself. Everything
// that happens to those results afterwards must use the same area.
boxes = [];
await page.fill('#pickSearchInput', '57.4437, -6.5906');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(6000);
const bar = await anchorBar();
check('a coordinate query moves that search to it', !/Stirling/.test(bar), bar);
// Every bounded lookup during and after the search must sit around Skye
// (57.44, -6.59), not the standing Stirling anchor (56.12, -3.95).
const nearSkye = boxes.filter((b) => b.length === 4 && b[0] < -5 && b[2] > -8);
const nearStirling = boxes.filter((b) => b.length === 4 && b[0] > -5);
check('the search itself looks where it says it is looking',
  boxes.length > 0 && nearStirling.length === 0,
  JSON.stringify({ total: boxes.length, skye: nearSkye.length, stirling: nearStirling.length }));

// NOT covered here, and worth naming rather than implying: the third part of
// this change makes loadAnchor() hand back the anchor a search is running
// under, so that opening or saving a result re-geocodes against the same area
// the search used rather than the stored one. Every attempt to catch that from
// the outside passed against the unfixed code too - by the time a result can be
// opened it already has coordinates, so the lookup that used to diverge never
// runs. The change is reasoned from the audit, not demonstrated by this file.


// Leaving the search returns to the standing area rather than keeping the
// one-off - a look somewhere else should not silently repoint everything.
await page.evaluate(() => document.querySelector('[data-search-close]').click());
await page.waitForTimeout(300);
await openSearch();
check('leaving the search puts the standing area back', /Stirling/.test(await anchorBar()), await anchorBar());

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
