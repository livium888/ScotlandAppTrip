// The back button used to leave the app from anywhere: press it meaning
// "out of this section" and the whole thing closed. A confirmation stops the
// accident, but the better half of the fix is that back should have somewhere
// to go first - close what's open, retrace the tabs you came through, and
// only ask about leaving when there is genuinely nothing left.
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
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|open-meteo|photon|tile\./, (r) => r.abort());

const tabNow = () => page.evaluate(() => document.getElementById('view').dataset.activeTab);
const back = async () => { await page.goBack(); await page.waitForTimeout(350); };

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-b', boards: [{ id: 'b-b', name: 'Back test', destination: 'Edinburgh', dated: false, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('board:b-b:picks', JSON.stringify([
    { id: 'custom:Edinburgh Castle', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999 },
  ]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

// --- Back retraces the tabs you came through ---
await page.evaluate(() => document.querySelector('[data-view="itinerary"]').click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('[data-view="budget"]').click());
await page.waitForTimeout(200);
check('a few tabs in', await tabNow() === 'budget');

await back();
check('back goes to the tab you came from, not out of the app', await tabNow() === 'itinerary', await tabNow());
await back();
const rootTab = await tabNow();
check('and keeps stepping back', rootTab !== 'places', rootTab);
check('the app is still on screen throughout', await page.evaluate(() =>
  !!document.getElementById('view').textContent.trim()));

// --- An open thing closes before any tab changes ---
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchTrigger');
await page.click('#pickSearchTrigger');
await page.waitForSelector('#searchOverlay.open');
await back();
check('back closes the search screen first', await page.evaluate(() =>
  !document.getElementById('searchOverlay').classList.contains('open')));
check('and stays on the tab it was opened from', await tabNow() === 'picks', await tabNow());

await page.click('#mapBtn');
await page.waitForSelector('#mapOverlay.open');
await back();
check('back closes the map', await page.evaluate(() =>
  !document.getElementById('mapOverlay').classList.contains('open')));

await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await back();
check('back closes an open sheet', await page.evaluate(() =>
  !document.getElementById('placeModal').classList.contains('open')));

// --- Only with nothing left does it ask ---
// Drain whatever tab history is left, then the next press should ask.
for (let i = 0; i < 12; i++) {
  const openAsk = await page.evaluate(() =>
    document.getElementById('placeModal').classList.contains('open') &&
    /Leave the app/.test(document.getElementById('placeModal').textContent));
  if (openAsk) break;
  await back();
}
const asked = await page.evaluate(() => document.getElementById('placeModal').textContent);
check('with nothing left, it asks before leaving', /Leave the app/.test(asked), asked.slice(0, 160));
check('it says the data is safe, which is the actual worry', /stays on this phone/.test(asked), asked.slice(0, 200));
check('staying is the easier option to hit', await page.evaluate(() => !!document.getElementById('stayInApp')));
check('leaving is still offered', await page.evaluate(() => !!document.getElementById('leaveApp')));

// --- Staying puts you back where you were, with the app intact ---
await page.evaluate(() => document.getElementById('stayInApp').click());
await page.waitForTimeout(300);
check('choosing Stay closes the question', await page.evaluate(() =>
  !document.getElementById('placeModal').classList.contains('open')));
check('and the app is untouched', await page.evaluate(() =>
  !!document.getElementById('view').textContent.trim() && !!document.querySelector('.tab')));

// The question must not stack up if back is pressed repeatedly.
await back();
await back();
await back();
const sheets = await page.evaluate(() =>
  document.querySelectorAll('#placeModal .modal-sheet').length);
check('repeated presses do not stack the question up', sheets <= 1, String(sheets));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
