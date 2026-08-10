// The Places tab had two kinds of entry side by side: saved places as rows
// that opened a sheet, and bundled guide entries as tall cards where only a
// small ♥ responded to a tap. Same screen, two behaviours, nothing to tell
// them apart - eleven of the cards did nothing at all when tapped. There was
// also no way to order any of it.
//
// These checks drive the real controls rather than reading the DOM, because
// "the handler is attached" and "tapping it does something" turned out to be
// different questions.
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
await page.route(/nominatim\.openstreetmap\.org/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '55.9486', lon: '-3.1999', display_name: 'Edinburgh Castle, Edinburgh', type: 'castle',
    namedetails: { name: 'Edinburgh Castle' }, address: { city: 'Edinburgh' }, extratags: {} }]) }));
await page.route(/wikidata|wikipedia|overpass|googleapis|open-meteo|photon|tile\./, (r) => r.abort());

const names = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.pick-row .pick-row-name')).map((e) => e.textContent.trim()));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  // The bundled guide is on, which is the board the problem showed up on.
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-p', boards: [{ id: 'b-p', name: 'Trip', destination: 'Edinburgh', dated: true, hasGuide: true, createdAt: 1 }],
  }));
  localStorage.setItem('board:b-p:folders', JSON.stringify(['Edinburgh', 'Stirling']));
  localStorage.setItem('board:b-p:picks', JSON.stringify([
    { id: 'custom:Zoo', name: 'Edinburgh Zoo', city: 'Edinburgh', category: 'Zoo', lat: 55.9426, lon: -3.2686, addedAt: 100 },
    { id: 'custom:Castle', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999, addedAt: 200 },
    { id: 'custom:Arthur', name: "Arthur's Seat", city: 'Edinburgh', category: 'Hill', lat: 55.9444, lon: -3.1618, addedAt: 300 },
    { id: 'custom:Wallace', name: 'Wallace Monument', city: 'Stirling', category: 'Monument', lat: 56.1385, lon: -3.92, addedAt: 400 },
  ]));
  localStorage.setItem('board:b-p:plan', JSON.stringify({
    days: [{ id: 'd1', label: 'Day 1 · Wed 19 Aug' }],
    items: { d1: [{ pickId: 'custom:Castle', time: '10:00' }] },
  }));
});
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="places"]').click());
await page.waitForTimeout(500);

// --- Every entry on the screen responds to a tap ---
const dead = await page.evaluate(() => {
  // Anything that looks like an entry but has no way to open it.
  const rows = Array.from(document.querySelectorAll('.pick-row, .guide-row'));
  return rows.filter((r) => !r.matches('[data-open-pick]') && !r.querySelector('[data-open-pick], [data-preview-guide]')).length;
});
check('no entry on the screen is dead to a tap', dead === 0, `${dead} dead rows`);

// A real click on a saved row, the way a finger does it.
const firstRowName = (await names())[0];
await page.click('.pick-row');
await page.waitForSelector('#placeModal.open', { timeout: 3000 });
check('a saved place opens the place you tapped', await page.evaluate((n) =>
  document.querySelector('.modal-title').textContent.trim() === n, firstRowName), firstRowName);
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.waitForTimeout(300);

// And on a bundled guide entry, which previously did nothing at all.
await page.evaluate(() => document.querySelector('.guide-row-main').scrollIntoView());
await page.click('.guide-row-main');
await page.waitForSelector('#placeModal.open', { timeout: 3000 });
const guideSheet = await page.evaluate(() => document.getElementById('placeModal').textContent);
check('a guide entry opens too, instead of ignoring the tap', /Save this place|Already saved/.test(guideSheet), guideSheet.slice(0, 200));

// Saving from that sheet must agree with the ♥ - not create a second copy.
const beforeSave = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('board:b-p:picks')).length);
const savedName = await page.evaluate(() => document.querySelector('.modal-title').textContent.trim());
await page.evaluate(() => document.getElementById('previewAdd').click());
await page.waitForTimeout(700);
const afterSave = await page.evaluate(() => JSON.parse(localStorage.getItem('board:b-p:picks')));
check('saving from the sheet saves once', afterSave.length === beforeSave + 1, `${beforeSave} -> ${afterSave.length}`);
check('and under the guide\'s own identity, not a duplicate', afterSave.some((p) => p.id === `places:${savedName}`),
  JSON.stringify(afterSave.map((p) => p.id)));

// The ♥ now shows it as saved, because both controls mean the same thing.
await page.waitForTimeout(300);
const heartAgrees = await page.evaluate((n) => {
  const btn = document.querySelector(`[data-toggle-pick="places"][data-name="${n}"]`);
  return btn ? btn.classList.contains('picked') : null;
}, savedName);
check('the ♥ and the sheet agree on what is saved', heartAgrees === true, String(heartAgrees));

// --- Sorting ---
const sorts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-sort]')).map((b) => b.textContent.trim()));
check('the list can be ordered', sorts.length >= 3, JSON.stringify(sorts));

await page.evaluate(() => document.querySelector('[data-sort="name"]').click());
await page.waitForTimeout(300);
const alpha = (await names()).slice(0, 4);
check('A–Z actually sorts alphabetically', JSON.stringify(alpha) === JSON.stringify([...alpha].sort((a, b) => a.localeCompare(b, 'en-GB'))), JSON.stringify(alpha));

await page.evaluate(() => document.querySelector('[data-sort="near"]').click());
await page.waitForTimeout(400);
const near = await names();
check('Nearest puts the closest first', near[0] === 'Edinburgh Castle', JSON.stringify(near.slice(0, 3)));
check('and Stirling last', near[near.length - 1] === 'Wallace Monument', JSON.stringify(near));
check('distances are shown when sorting by them, in miles', /\d+(\.\d+)?\s*(mi|yd)/.test(
  await page.evaluate(() => document.getElementById('view').textContent)));

await page.evaluate(() => document.querySelector('[data-sort="day"]').click());
await page.waitForTimeout(300);
check('By day puts the scheduled place first', (await names())[0] === 'Edinburgh Castle', JSON.stringify(await names()));

// The choice sticks, rather than resetting every time you come back.
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="places"]').click());
await page.waitForTimeout(500);
check('the chosen order is remembered', await page.evaluate(() =>
  !!document.querySelector('[data-sort="day"].on')));

// --- Filtering still works alongside it ---
await page.evaluate(() => document.querySelector('[data-city="Stirling"]').click());
await page.waitForTimeout(300);
const filtered = await names();
check('filtering to a folder still narrows the list', filtered.length === 1 && /Wallace/.test(filtered[0]), JSON.stringify(filtered));

// --- Eats gets the same treatment ---
await page.evaluate(() => document.querySelector('[data-view="eats"]').click());
await page.waitForTimeout(400);
check('Eats guide entries are tappable too', await page.evaluate(() =>
  document.querySelectorAll('.guide-row-main[data-preview-guide^="eats"]').length > 0));
await page.click('.guide-row-main');
await page.waitForSelector('#placeModal.open', { timeout: 3000 });
check('and open their own sheet', await page.evaluate(() => !!document.getElementById('previewAdd')));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
