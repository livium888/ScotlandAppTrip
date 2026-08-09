// Adding a place is the app's most frequent action, so it's the one most
// worth keeping frictionless. These check the flow rather than the styling:
// how many interactions it takes, and whether a wrong guess is correctable.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 780 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

await page.route(/nominatim\.openstreetmap\.org/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '55.9486', lon: '-3.1999', display_name: 'Camera Obscura, Edinburgh', type: 'attraction',
    namedetails: { name: 'Camera Obscura' }, address: { city: 'Edinburgh' }, extratags: {},
  }]) }));
await page.route(/wikidata|wikipedia|overpass|googleapis/, (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ search: [] }) }));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchInput');

// --- Searching then adding must not require answering a folder question ---
await page.fill('#pickSearchInput', 'camera obscura');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForSelector('[data-add-candidate]', { timeout: 5000 });
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
await page.waitForTimeout(700);

const modalOpen = await page.evaluate(() => document.getElementById('placeModal').classList.contains('open'));
check('no folder modal interrupts the add', modalOpen === false);

const picks = await page.evaluate(() => JSON.parse(localStorage.getItem('scotland-trip-picks-v1') || '[]'));
check('place saved in one tap', picks.length === 1 && picks[0].name === 'Camera Obscura', JSON.stringify(picks.map(p => p.name)));
check('auto-filed to a sensible folder', picks[0] && picks[0].city === 'Edinburgh', picks[0] && picks[0].city);

const toast = await page.evaluate(() => {
  const el = document.getElementById('toast');
  return el ? { text: el.textContent, hasAction: !!el.querySelector('.toast-action') } : null;
});
check('confirms what happened', toast && /Added/.test(toast.text) && /Edinburgh/.test(toast.text), JSON.stringify(toast));
check('offers a correction instead of asking upfront', toast && toast.hasAction === true, JSON.stringify(toast));

// The correction path must still work.
await page.evaluate(() => document.querySelector('.toast-action').click());
await page.waitForSelector('#placeModal.open', { timeout: 3000 });
check('Change opens the folder picker', true);
await page.evaluate(() => {
  const chips = document.querySelectorAll('#placeModal [data-pick-folder]');
  const other = Array.from(chips).find((c) => c.textContent.trim() !== 'Edinburgh');
  if (other) other.click();
});
await page.waitForTimeout(400);
const moved = await page.evaluate(() => JSON.parse(localStorage.getItem('scotland-trip-picks-v1'))[0].city);
check('folder actually changes via the correction', moved !== 'Edinburgh', moved);

// --- Scheduling from the pick card, without leaving the tab ---
const dayChips = await page.evaluate(() => document.querySelectorAll('[data-assign-day]').length);
check('day chips appear on the pick card', dayChips > 0, String(dayChips));

await page.evaluate(() => document.querySelector('[data-assign-day]').click());
await page.waitForTimeout(400);
const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-plan-v1') || '{}'));
const scheduled = Object.values(plan.items || {}).flat();
check('scheduled to a day without leaving Picks', scheduled.length === 1, JSON.stringify(plan.items));

const chipOn = await page.evaluate(() => !!document.querySelector('[data-assign-day].on'));
check('the chip shows it is scheduled', chipOn);

// Tapping again unschedules - the same control both ways.
await page.evaluate(() => document.querySelector('[data-assign-day].on').click());
await page.waitForTimeout(400);
const plan2 = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-plan-v1') || '{}'));
check('tapping again removes it', Object.values(plan2.items || {}).flat().length === 0, JSON.stringify(plan2.items));

// --- Planner uses tappable chips, not a native select ---
await page.evaluate(() => document.querySelector('[data-view="itinerary"]').click());
await page.waitForTimeout(150);
await page.evaluate(() => document.querySelector('[data-plan-mode="mine"]').click());
await page.waitForTimeout(300);

const selects = await page.evaluate(() => document.querySelectorAll('select[data-plan-add]').length);
check('no native select pickers left in the planner', selects === 0, String(selects));
const addChips = await page.evaluate(() => document.querySelectorAll('button[data-plan-add]').length);
check('add chips present instead', addChips > 0, String(addChips));

await page.evaluate(() => document.querySelector('button[data-plan-add]').click());
await page.waitForTimeout(400);
check('chip adds to the day in one tap', await page.evaluate(() =>
  Object.values(JSON.parse(localStorage.getItem('trip-plan-v1')).items).flat().length === 1));

// --- Quick times avoid the keyboard ---
const quick = await page.evaluate(() => document.querySelectorAll('[data-plan-quicktime]').length);
check('quick time chips offered when no time set', quick >= 4, String(quick));
await page.evaluate(() => document.querySelector('[data-plan-quicktime]').click());
await page.waitForTimeout(400);
const time = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('trip-plan-v1')).items).flat()[0].time);
check('time set without typing', !!time, time);

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
