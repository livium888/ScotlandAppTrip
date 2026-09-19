// Adding a place is the app's most frequent action, so what it costs matters.
//
// It used to file itself on a 40km guess over three hardcoded cities, which
// was frictionless and often wrong. Then it asked every time, which was always
// right and always an interruption - including on the great majority of saves
// where the answer was never in doubt.
//
// It now asks only when there is a choice: this board has three folders and no
// areas, so there is one. A place that clearly sits inside one saved area
// files itself instead (test_addcity covers that side).
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
// Three folders and no areas, which is the situation this whole suite is
// about: a real choice, so the question is worth asking. It used to get them
// from the bundled guide, which no longer exists - a board's default is now
// one folder, and one folder is not a choice.
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('boards-v1'));
  const id = state.activeId;
  localStorage.setItem(`board:${id}:folders`, JSON.stringify(['Edinburgh', 'Stirling', 'Glasgow']));
  // And one saved area, because the app's guess about where something belongs
  // now comes from the towns you have saved rather than from three hardcoded
  // Scottish anchors. With no areas there is nothing to guess from, and the
  // honest answer is Unsorted - which is a different test from this one.
  //
  // Two of them, close enough together that neither is the obvious answer.
  // One area plainly containing the place is not a choice - the app files it
  // and says where, which is the behaviour the second half of this suite
  // checks. A real rival is what makes the question worth asking.
  localStorage.setItem(`board:${id}:picks`, JSON.stringify([
    { id: 'custom:Edinburgh', name: 'Edinburgh', city: 'Edinburgh', major: true,
      category: 'City', lat: 55.9533, lon: -3.1883, addedAt: 1, photoChecked: true },
    { id: 'custom:Leith', name: 'Leith', city: 'Leith', major: true,
      category: 'Area', lat: 55.9560, lon: -3.1930, addedAt: 2, photoChecked: true }]));
});
await page.reload({ waitUntil: 'load' });
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
  chips: document.querySelectorAll('#placeModal [data-label-folder]').length,
  suggested: (document.querySelector('#placeModal [data-label-folder].active') || {}).textContent || '',
  marked: !!document.querySelector('#placeModal .chip-suggested'),
  unsorted: Array.from(document.querySelectorAll('#placeModal [data-label-folder]'))
    .some((c) => c.textContent.trim().startsWith('Unsorted')),
  kinds: document.querySelectorAll('#placeModal [data-label-kind]').length,
  isWhat: document.querySelectorAll('#placeModal [data-label-major]').length,
}));
check('the folder is asked, not decided', askedFirst.open && askedFirst.chips > 0, JSON.stringify(askedFirst));
check('the app still offers its guess', /Edinburgh/.test(askedFirst.suggested), askedFirst.suggested);
check('and marks it as a suggestion rather than a fact', askedFirst.marked);
check('somewhere to put it when undecided', askedFirst.unsorted, JSON.stringify(askedFirst));
// The three questions about a place used to arrive in three places at three
// moments. One sheet, one moment.
check('what it is, is asked in the same breath', askedFirst.isWhat === 2, JSON.stringify(askedFirst));
check('and which list it belongs in', askedFirst.kinds === 2, JSON.stringify(askedFirst));

// Nothing is saved while the question is still on screen.
const duringAsk = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks') || '[]'));
// Counted by name rather than by length: the board is seeded with two areas
// to make the folder question a real one, so "nothing filed yet" means the
// place being saved is absent, not that storage is empty.
check('nothing is filed before the question is answered',
  !duringAsk.some((p) => p.name === 'Camera Obscura'), JSON.stringify(duringAsk.map((p) => p.name)));

// Accepting what it suggests is one tap on Save.
await page.evaluate(() => document.getElementById('labelDone').click());
await page.waitForTimeout(700);

const picks = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks') || '[]'));
const saved = picks.find((p) => p.name === 'Camera Obscura');
check('the place is saved once answered', !!saved, JSON.stringify(picks.map(p => p.name)));
check('filed where it was told to go', saved && saved.city === 'Edinburgh', saved && saved.city);
check('the question does not linger', await page.evaluate(() =>
  !document.getElementById('placeModal').classList.contains('open')));

const toast = await page.evaluate(() => {
  const el = document.getElementById('toast');
  return el ? { text: el.textContent } : null;
});
check('confirms where it went', toast && /Edinburgh/.test(toast.text), JSON.stringify(toast));

// A place can still be moved afterwards, from its own sheet. Opened by id,
// because the board also holds the two seeded areas and the first row on the
// screen is one of those rather than the place this is about.
const openCamera = () => page.evaluate(() => {
  const btn = document.querySelector('[data-open-pick="custom:Camera Obscura"]');
  if (btn) btn.click();
});
await openCamera();
await page.waitForSelector('#placeModal.open [data-move-pick]', { timeout: 5000 });
await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('[data-move-pick]'));
  const other = chips.find((c) => !c.classList.contains('active'));
  if (other) other.click();
});
await page.waitForTimeout(500);
const cameraCity = () => page.evaluate(() =>
  (JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks'))
    .find((p) => p.name === 'Camera Obscura') || {}).city);
check('and moved later from its own sheet', (await cameraCity()) !== 'Edinburgh', await cameraCity());
await page.evaluate(() => {
  const key = 'board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks';
  const p = JSON.parse(localStorage.getItem(key));
  const c = p.find((x) => x.name === 'Camera Obscura');
  if (c) c.city = 'Edinburgh';
  localStorage.setItem(key, JSON.stringify(p));
  // A day to schedule into. Boards used to start with the bundled trip's
  // seven days already in them; they start empty now.
  const planKey = 'board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':plan';
  localStorage.setItem(planKey, JSON.stringify({ days: [{ id: 'd1', label: 'Day 1' }], items: { d1: [] } }));
});
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(400);

// --- Scheduling from the pick's detail sheet, without leaving the tab ---
await openCamera();
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
