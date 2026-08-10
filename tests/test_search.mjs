// Search on its own screen. The point of the rewrite was that adding places
// is what this app is for, so it should get the whole display, remember what
// you asked before, and let you add several without going back and forth.
// Deliberately one question rather than a sequence of them - so a search with
// nothing but a name still takes exactly one action.
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

await page.route(/nominatim\.openstreetmap\.org/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { lat: '55.9486', lon: '-3.1999', display_name: 'Camera Obscura, Edinburgh', type: 'attraction',
      namedetails: { name: 'Camera Obscura' }, address: { city: 'Edinburgh' }, extratags: {} },
    { lat: '55.9463', lon: '-3.2010', display_name: 'Lovecrumbs, Edinburgh', type: 'cafe',
      namedetails: { name: 'Lovecrumbs' }, address: { city: 'Edinburgh' }, extratags: {} },
  ]) }));
await page.route(/wikidata|wikipedia|overpass|googleapis|tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchTrigger');

// --- Getting there ---
check('Picks shows a way in, not a live search strip', await page.evaluate(() =>
  !!document.getElementById('pickSearchTrigger') && !document.querySelector('#view #pickSearchInput')));

await page.click('#pickSearchTrigger');
await page.waitForSelector('#searchOverlay.open', { timeout: 3000 });
check('search takes the whole screen', await page.evaluate(() => {
  const el = document.getElementById('searchOverlay');
  return el.classList.contains('open') && el.clientHeight > 600;
}));
check('the field is focused, so the keyboard is already up', await page.evaluate(() =>
  document.activeElement && document.activeElement.id === 'pickSearchInput'));

// --- Before you type: shortcuts, not a form to fill in ---
const suggestions = await page.evaluate(() => Array.from(document.querySelectorAll('[data-recent]')).map((b) => b.textContent.trim()));
check('starting points offered before typing', suggestions.length >= 3, JSON.stringify(suggestions));
check('nothing is asked before the search runs', await page.evaluate(() =>
  document.querySelectorAll('#searchOverlay select, #searchOverlay [data-step]').length === 0));

// --- One action from typing to results ---
await page.fill('#pickSearchInput', 'camera obscura');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForSelector('[data-add-candidate]', { timeout: 6000 });
const resultText = await page.evaluate(() => document.getElementById('searchOverlay').textContent);
check('results appear on the search screen', /Camera Obscura/.test(resultText), resultText.slice(0, 200));
check('results are mapped as well as listed', await page.evaluate(() => !!document.getElementById('pickSearchMap')));

// A mixed result set can be narrowed - after there is something to narrow.
check('a filter appears once results differ in kind', await page.evaluate(() =>
  document.querySelectorAll('[data-search-kind]').length === 3));
await page.evaluate(() => document.querySelector('[data-search-kind="eat"]').click());
await page.waitForTimeout(300);
const eatOnly = await page.evaluate(() => document.querySelector('.search-results').textContent);
check('filtering to food hides the attraction', /Lovecrumbs/.test(eatOnly) && !/Camera Obscura/.test(eatOnly), eatOnly.slice(0, 160));
await page.evaluate(() => document.querySelector('[data-search-kind="all"]').click());
await page.waitForTimeout(300);

// --- Adding several without leaving ---
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
await page.waitForTimeout(700);
check('the search screen stays open after adding', await page.evaluate(() =>
  document.getElementById('searchOverlay').classList.contains('open')));
check('an added place is marked as in', await page.evaluate(() =>
  !!document.querySelector('.search-add.added')));

await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[data-add-candidate]')).find((b) => !b.disabled);
  if (btn) btn.click();
});
await page.waitForTimeout(700);
const savedNames = await page.evaluate(() => JSON.parse(localStorage.getItem('board:' + JSON.parse(localStorage.getItem('boards-v1')).activeId + ':picks') || '[]').map((p) => p.name));
check('two places added in one visit', savedNames.length === 2, JSON.stringify(savedNames));

// --- Searching again from the results ---
await page.fill('#pickSearchInput', 'lovecrumbs');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(900);
check('a second search does not mean going back first', await page.evaluate(() =>
  document.getElementById('searchOverlay').classList.contains('open')));
check('already-saved places show as saved, not addable again', await page.evaluate(() =>
  !!document.querySelector('.search-add.added')));

// --- Leaving, and coming back to what you asked before ---
await page.evaluate(() => document.querySelector('[data-search-close]').click());
await page.waitForTimeout(300);
check('closing returns to the saved list', await page.evaluate(() =>
  !document.getElementById('searchOverlay').classList.contains('open')));
check('the places added are on it', /Camera Obscura/.test(await page.evaluate(() => document.getElementById('view').textContent)));

await page.click('#pickSearchTrigger');
await page.waitForSelector('[data-recent]');
const recents = await page.evaluate(() => Array.from(document.querySelectorAll('[data-recent]')).map((b) => b.textContent.trim()));
check('past searches are remembered', recents.some((r) => /lovecrumbs/i.test(r)), JSON.stringify(recents));

await page.evaluate(() => Array.from(document.querySelectorAll('[data-recent]')).find((b) => /lovecrumbs/i.test(b.textContent)).click());
await page.waitForTimeout(900);
check('tapping a past search runs it', await page.evaluate(() =>
  document.getElementById('pickSearchInput').value.toLowerCase() === 'lovecrumbs'));

// --- Back closes the search, not the app ---
await page.goBack();
await page.waitForTimeout(400);
check('Android back closes the search screen', await page.evaluate(() =>
  !document.getElementById('searchOverlay').classList.contains('open')));
check('and the app is still there behind it', await page.evaluate(() =>
  !!document.getElementById('view').textContent.trim()));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
