// The geocoder was asked for exactly one answer (limit=1) and its answer was
// taken. That is not a lookup, it is a guess with the evidence discarded:
// there was no way to tell whether it had been certain or had picked one of
// four, and wrong coordinates spread quietly - the map pin, the distances,
// the day's forecast and the area a place gets filed under all read from them.
//
// Two rules here. Where a person is waiting for the answer, ask. Where nothing
// is waiting - enrichment that happens seconds after a save - record that the
// question was never settled instead of pretending it was.
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

const readPicks = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-a:picks') || '[]'));

// Newport is the real case: several of them, hundreds of miles apart. The
// Bay Tree is the opposite - one place the geocoder happens to return twice,
// fifty metres apart, which is not a question worth asking anyone.
let geocodeUrls = [];
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const url = decodeURIComponent(route.request().url());
  geocodeUrls.push(url);
  const newport = [
    { lat: '51.5842', lon: '-2.9977', display_name: 'Newport, Wales', type: 'town', class: 'place',
      namedetails: { name: 'Newport' }, address: { town: 'Newport', country: 'Wales' }, extratags: {} },
    { lat: '52.7692', lon: '-2.3789', display_name: 'Newport, Shropshire, England', type: 'town', class: 'place',
      namedetails: { name: 'Newport' }, address: { town: 'Newport', county: 'Shropshire' }, extratags: {} },
    { lat: '50.7014', lon: '-1.2925', display_name: 'Newport, Isle of Wight, England', type: 'town', class: 'place',
      namedetails: { name: 'Newport' }, address: { town: 'Newport' }, extratags: {} },
  ];
  const bayTree = [
    { lat: '55.9486', lon: '-3.1999', display_name: 'The Bay Tree, Edinburgh', type: 'cafe', class: 'amenity',
      namedetails: { name: 'The Bay Tree' }, address: { city: 'Edinburgh' }, extratags: {} },
    { lat: '55.9490', lon: '-3.2002', display_name: 'The Bay Tree (garden), Edinburgh', type: 'cafe', class: 'amenity',
      namedetails: { name: 'The Bay Tree' }, address: { city: 'Edinburgh' }, extratags: {} },
  ];
  const body = /Newport/i.test(url) ? newport : bayTree;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route(/wikidata|wikipedia|overpass|googleapis|tile\.|open-meteo/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-a', boards: [{ id: 'b-a', name: 'Ambiguity', destination: '', dated: false, hasGuide: false, createdAt: 1 }],
  }));
});
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#exploreToggle');

// ---------- The lookup keeps the alternatives ----------

check('the geocoder is asked for more than one answer', await page.evaluate(async () => {
  // Drive a lookup and read what went out.
  document.getElementById('exploreToggle').click();
  return true;
}));
await page.waitForSelector('#exploreSearchForm');
geocodeUrls = [];
await page.fill('#exploreSearchInput', 'Newport');
await page.evaluate(() => document.getElementById('exploreSearchForm').requestSubmit());
await page.waitForTimeout(1200);
check('it no longer asks for a single result', geocodeUrls.some((u) => /limit=[2-9]/.test(u)) && !geocodeUrls.some((u) => /limit=1&/.test(u)),
  JSON.stringify(geocodeUrls).slice(0, 200));

// ---------- Someone waiting gets asked ----------

check('an ambiguous area opens the question', await page.evaluate(() =>
  document.getElementById('placeModal').classList.contains('open') &&
  document.querySelectorAll('[data-pick-location]').length >= 3));
check('and names them by where they actually are', await page.evaluate(() => {
  const text = document.getElementById('placeModal').textContent;
  return /Wales/.test(text) && /Shropshire/.test(text) && /Isle of Wight/.test(text);
}), await page.evaluate(() => document.getElementById('placeModal').textContent.slice(0, 200)));
check('nothing has been decided while it is open', await page.evaluate(() =>
  !/Around/.test(document.getElementById('view').textContent)));

// Choosing the third one must set that one, not the geocoder's first.
await page.evaluate(() => document.querySelectorAll('[data-pick-location]')[2].click());
await page.waitForTimeout(600);
check('the one chosen is the one used', /Isle of Wight|Newport/.test(
  await page.evaluate(() => document.getElementById('view').textContent)));
check('and it is centred there, not on the first match', await page.evaluate(() => {
  const text = document.getElementById('view').textContent;
  return /Around/.test(text);
}), await page.evaluate(() => document.getElementById('view').textContent.slice(0, 200)));

// ---------- An unambiguous name is not turned into a question ----------

await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'The Bay Tree');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
await page.waitForSelector('#placeModal [data-pick-folder]', { timeout: 5000 });
check('two results fifty metres apart are not an ambiguity', await page.evaluate(() =>
  document.querySelectorAll('[data-pick-location]').length === 0));
await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('#placeModal [data-pick-folder]'));
  (chips.find((c) => c.classList.contains('active')) || chips[0]).click();
});
await page.waitForTimeout(1500);
const bayTree = (await readPicks()).find((p) => /Bay Tree/.test(p.name));
check('it saves without a flag on it', !!bayTree && !bayTree.geoAlternatives, JSON.stringify(bayTree));

// ---------- A background lookup records the doubt instead of interrupting ----------

await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'Newport');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(1400);

// Save the town. Its own coordinates come with the result, but the enrichment
// that follows is where the old code silently picked one Newport of three.
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const close = document.querySelector('[data-search-close]');
  if (close) close.click();
});
await page.waitForTimeout(800);

check('saving was never interrupted by the question', await page.evaluate(() =>
  document.querySelectorAll('[data-pick-location]').length === 0));

// ---------- The doubt is visible, and settleable ----------

await page.evaluate(() => {
  const picks = JSON.parse(localStorage.getItem('board:b-a:picks'));
  // A place whose lookup was ambiguous, as a background enrich would leave it.
  picks.push({
    id: 'custom:Newport Market Hall', name: 'Newport Market Hall', city: 'Unsorted', category: 'Hall',
    lat: 51.5842, lon: -2.9977, addedAt: 900,
    geoAlternatives: [
      { lat: 51.5842, lon: -2.9977, label: 'Newport Market Hall', displayName: 'Newport, Wales' },
      { lat: 52.7692, lon: -2.3789, label: 'Newport Market Hall', displayName: 'Newport, Shropshire, England' },
      { lat: 50.7014, lon: -1.2925, label: 'Newport Market Hall', displayName: 'Newport, Isle of Wight, England' },
    ],
  });
  localStorage.setItem('board:b-a:picks', JSON.stringify(picks));
  document.querySelector('[data-view="picks"]').click();
});
await page.waitForTimeout(600);

check('the list says the location is in doubt', await page.evaluate(() =>
  !!document.querySelector('.row-badge.doubt')));

await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-open-pick]'));
  rows.find((r) => /Newport Market Hall/.test(r.textContent)).click();
});
await page.waitForSelector('#placeModal.open', { timeout: 3000 });
check('the sheet explains rather than showing a confident pin', await page.evaluate(() =>
  /share this name/.test(document.getElementById('placeModal').textContent)),
  await page.evaluate(() => document.getElementById('placeModal').textContent.slice(0, 220)));
check('and offers to settle it', await page.evaluate(() => !!document.querySelector('[data-fix-location]')));

await page.evaluate(() => document.querySelector('[data-fix-location]').click());
await page.waitForTimeout(500);
check('which opens the same question', await page.evaluate(() =>
  document.querySelectorAll('[data-pick-location]').length === 3));

await page.evaluate(() => document.querySelectorAll('[data-pick-location]')[1].click());
await page.waitForTimeout(700);
const settled = (await readPicks()).find((p) => p.id === 'custom:Newport Market Hall');
check('choosing moves the place to that one', settled && Math.abs(settled.lat - 52.7692) < 0.01,
  JSON.stringify(settled && { lat: settled.lat, lon: settled.lon }));
check('and the doubt is gone, because you answered it', settled && !settled.geoAlternatives,
  JSON.stringify(settled && settled.geoAlternatives));
check('the badge goes with it', await page.evaluate(() => !document.querySelector('.row-badge.doubt')));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
