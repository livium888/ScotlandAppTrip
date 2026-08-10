// Adding a place is the app's most frequent action. It used to file itself and
// offer a correction on a toast, which was frictionless right up until the
// guess was wrong - and a wrong guess that nobody is asked about is invisible
// until you go looking for something and it isn't there. Where a place goes is
// now always answered by hand, with the guess offered as a suggestion.
// These check that flow: one question, the guess pre-selected, and no silent
// filing anywhere in the path.
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
// Open the search screen if we aren't already on it - a second search from
// the results doesn't mean going back to Picks first.
if (!(await page.evaluate(() => document.getElementById('searchOverlay').classList.contains('open')))) {
  await page.waitForSelector('#pickSearchTrigger');
  await page.click('#pickSearchTrigger');
}
await page.waitForSelector('#pickSearchInput');

// --- Saving asks where, once, with the guess offered ---
await page.fill('#pickSearchInput', 'camera obscura');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForSelector('[data-add-candidate]', { timeout: 5000 });
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
await page.waitForTimeout(700);

const askedFirst = await page.evaluate(() => ({
  open: document.getElementById('placeModal').classList.contains('open'),
  chips: document.querySelectorAll('#placeModal [data-pick-folder]').length,
  suggested: (document.querySelector('#placeModal [data-pick-folder].active') || {}).textContent || '',
  marked: !!document.querySelector('#placeModal .chip-suggested'),
  unsorted: Array.from(document.querySelectorAll('#placeModal [data-pick-folder]'))
    .some((c) => c.textContent.trim().startsWith('Unsorted')),
}));
check('the folder is asked, not decided', askedFirst.open && askedFirst.chips > 0, JSON.stringify(askedFirst));
check('the app still offers its guess', /Edinburgh/.test(askedFirst.suggested), askedFirst.suggested);
check('and marks it as a suggestion rather than a fact', askedFirst.marked);
check('somewhere to put it when undecided', askedFirst.unsorted, JSON.stringify(askedFirst));

// Nothing is saved while the question is still on screen.
const duringAsk = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks') || '[]'));
check('nothing is filed before the question is answered', duringAsk.length === 0, JSON.stringify(duringAsk));

// Accepting the suggestion is one tap.
await page.evaluate(() => document.querySelector('#placeModal [data-pick-folder].active').click());
await page.waitForTimeout(700);

const picks = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks') || '[]'));
check('the place is saved once answered', picks.length === 1 && picks[0].name === 'Camera Obscura', JSON.stringify(picks.map(p => p.name)));
check('filed where it was told to go', picks[0] && picks[0].city === 'Edinburgh', picks[0] && picks[0].city);
check('the question does not linger', await page.evaluate(() =>
  !document.getElementById('placeModal').classList.contains('open')));

const toast = await page.evaluate(() => {
  const el = document.getElementById('toast');
  return el ? { text: el.textContent } : null;
});
check('confirms where it went', toast && /Edinburgh/.test(toast.text), JSON.stringify(toast));

// A place can still be moved afterwards, from its own sheet.
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open [data-move-pick]', { timeout: 5000 });
await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('[data-move-pick]'));
  const other = chips.find((c) => !c.classList.contains('active'));
  if (other) other.click();
});
await page.waitForTimeout(500);
const moved = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks'))[0].city);
check('and moved later from its own sheet', moved !== 'Edinburgh', moved);
await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks')); p[0].city = 'Edinburgh'; localStorage.setItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks', JSON.stringify(p)); });
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(300);

// --- Scheduling from the pick's detail sheet, without leaving the tab ---
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open [data-assign-day]', { timeout: 5000 });
const dayChips = await page.evaluate(() => document.querySelectorAll('[data-assign-day]').length);
check('day chips appear on the pick card', dayChips > 0, String(dayChips));

await page.evaluate(() => document.querySelector('[data-assign-day]').click());
await page.waitForTimeout(400);
const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':plan') || '{}'));
const scheduled = Object.values(plan.items || {}).flat();
check('scheduled to a day without leaving Picks', scheduled.length === 1, JSON.stringify(plan.items));

const chipOn = await page.evaluate(() => !!document.querySelector('[data-assign-day].on'));
check('the chip shows it is scheduled', chipOn);

// Tapping again unschedules - the same control both ways.
await page.evaluate(() => document.querySelector('[data-assign-day].on').click());
await page.waitForTimeout(400);
const plan2 = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':plan') || '{}'));
check('tapping again removes it', Object.values(plan2.items || {}).flat().length === 0, JSON.stringify(plan2.items));

// --- Planner uses tappable chips, not a native select ---
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.waitForTimeout(200);
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
  Object.values(JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':plan')).items).flat().length === 1));

// --- Quick times avoid the keyboard ---
const quick = await page.evaluate(() => document.querySelectorAll('[data-plan-quicktime]').length);
check('quick time chips offered when no time set', quick >= 4, String(quick));
await page.evaluate(() => document.querySelector('[data-plan-quicktime]').click());
await page.waitForTimeout(400);
const time = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':plan')).items).flat()[0].time);
check('time set without typing', !!time, time);

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
