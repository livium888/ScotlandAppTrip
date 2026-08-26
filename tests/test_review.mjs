// A read of the whole app turned up ten defects. Every suite in this
// directory passed before they were fixed and passed afterwards, which is the
// uncomfortable part: the tests were not looking. This file is the half that
// was missing - one check per finding, each written so that it fails against
// the code as it was.
//
// They are grouped by finding rather than by screen, so a failure here names
// the bug rather than the tab it happened to show up on.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Anything that reaches this has escaped the escaping.
let executions = [];
await page.exposeFunction('__pwned', (where) => executions.push(where));
page.on('dialog', async (d) => { executions.push('dialog:' + d.message()); await d.dismiss(); });

// The network, under the test's control: what each backend answers, and how
// long it takes to say it. Timing is the whole subject of two of these bugs.
let aiResults = () => [];
let aiDelayMs = () => 0;
let geoQueries = [];
let geoResults = () => [];
let geoDelayMs = () => 0;
let wikiDelayMs = () => 0;

await page.route(/generativelanguage\.googleapis\.com/, async (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  let prompt = '';
  try { prompt = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text; } catch (e) { /* not a prompt we care about */ }
  const wait = aiDelayMs(prompt);
  if (wait) await sleep(wait);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(aiResults(prompt)) }] } }] }) });
});

await page.route(/nominatim\.openstreetmap\.org/, async (route) => {
  const url = decodeURIComponent(route.request().url());
  const q = (/[?&]q=([^&]*)/.exec(url) || [])[1] || '';
  geoQueries.push(q);
  const wait = geoDelayMs(q);
  if (wait) await sleep(wait);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(geoResults(q)) });
});

await page.route(/wikidata\.org/, async (route) => {
  const wait = wikiDelayMs(decodeURIComponent(route.request().url()));
  if (wait) await sleep(wait);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ search: [] }) });
});
await page.route(/wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });

async function seed(id, contents) {
  await page.evaluate(([boardId, extra]) => {
    localStorage.clear();
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: boardId,
      boards: [{ id: boardId, name: 'Review', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }],
    }));
    localStorage.setItem('trip-settings-v1', JSON.stringify({
      destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
      travellers: 'family of 3, 4-year-old who walks',
    }));
    Object.keys(extra || {}).forEach((k) => localStorage.setItem(`board:${boardId}:${k}`, JSON.stringify(extra[k])));
  }, [id, contents || {}]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(350);
}

const readPicks = (id) => page.evaluate((b) => JSON.parse(localStorage.getItem(`board:${b}:picks`) || '[]'), id);
const readPlan = (id) => page.evaluate((b) => JSON.parse(localStorage.getItem(`board:${b}:plan`) || '{"days":[],"items":{}}'), id);
const openTab = async (name) => {
  await goTo(page, name, 0);
  await page.waitForTimeout(400);
};
// Any attribute starting "on" is an event handler, and the app writes none of
// its own - so one appearing means text became markup.
const handlerAttrs = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('*'))
    .flatMap((el) => Array.from(el.attributes).map((a) => a.name))
    .filter((n) => /^on[a-z]/i.test(n)));

// ---------------------------------------------------------------------------
// 1. Escaping stopped at < > &, so a quote closed the attribute it sat in
// ---------------------------------------------------------------------------
// The escaper was built on textContent/innerHTML, which escapes exactly three
// characters. Everything the app renders into an attribute - a note, a folder
// name, a place name in an aria-label - could therefore end the attribute and
// start a new one. The existing security suite fired <img onerror> payloads,
// which that escaper already stopped, so it had nothing to say about this.

const ATTR = `Cafe" onmouseover="window.__pwned('attr')" data-x="`;
await seed('b-esc', {
  folders: ['Home', ATTR],
  picks: [{
    id: 'custom:esc', name: ATTR, city: 'Home', category: ATTR, note: ATTR, address: ATTR,
    description: ATTR, lat: 55.9486, lon: -3.1999, addedAt: 1,
  }],
});
await openTab('picks');
check('a quote in a saved name does not open an attribute in the list', (await handlerAttrs()).length === 0,
  JSON.stringify(await handlerAttrs()));

await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(500);
const escaped = await handlerAttrs();
check('nor in the sheet, where the note is rendered into value=', escaped.length === 0, JSON.stringify(escaped));

await page.evaluate(() => document.querySelectorAll('#placeModal *').forEach((el) => {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
}));
await page.waitForTimeout(300);
check('and nothing runs when you touch it', executions.length === 0, JSON.stringify(executions));
check('the text is still kept exactly as written',
  (await page.evaluate(() => (document.querySelector('[data-pick-note]') || {}).value)) === ATTR);
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());

// ---------------------------------------------------------------------------
// 2-4. A trip across new year, and the label of a day made on the spot
// ---------------------------------------------------------------------------
// Day labels carry a day and a month but no year. Every label was parsed into
// the current year, so 1 Jan sorted ahead of 29 Dec: the days came out
// backwards and were numbered in that order. Separately, a day being created
// was labelled "Day ? · ..." and the renumbering only stripped "Day <digits>",
// so the placeholder survived into "Day 1 · Day ? · Wed 12 Aug".

await seed('b-year', {
  folders: ['Saved'],
  picks: [{ id: 'custom:castle', name: 'Blair Castle', city: 'Saved', category: 'Castle', lat: 56.77, lon: -3.84, addedAt: 1 }],
  plan: {
    days: [
      { id: 'd1', label: 'Day 1 · Sun 29 Dec' },
      { id: 'd2', label: 'Day 2 · Mon 30 Dec' },
      { id: 'd3', label: 'Day 3 · Thu 1 Jan' },
    ],
    items: { d1: [], d2: [], d3: [] },
  },
});
await openTab('picks');
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await page.evaluate(() => document.querySelector('[data-day-sheet]').click());
await page.waitForSelector('#dayDatePick', { timeout: 4000 });

const nextJan2 = `${new Date().getFullYear() + 1}-01-02`;
await page.evaluate((v) => {
  const el = document.getElementById('dayDatePick');
  el.value = v;
  el.dispatchEvent(new Event('change'));
}, nextJan2);
await page.waitForTimeout(700);

const yearPlan = await readPlan('b-year');
const labels = yearPlan.days.map((d) => d.label);
check('a trip running into January keeps December first',
  /29 Dec/.test(labels[0] || '') && /30 Dec/.test(labels[1] || ''), JSON.stringify(labels));
check('with the new year after it, not before',
  /1 Jan/.test(labels[2] || '') && /2 Jan/.test(labels[3] || ''), JSON.stringify(labels));
check('and numbered along the trip, not around the calendar',
  labels.every((l, i) => l.startsWith(`Day ${i + 1} · `)), JSON.stringify(labels));
check('a day made on the spot carries one number and no placeholder',
  labels.length === 4 && labels.every((l) => (l.match(/Day/g) || []).length === 1), JSON.stringify(labels));
await page.evaluate(() => document.getElementById('daySheetDone').click());
await page.waitForTimeout(400);

// ---------------------------------------------------------------------------
// 5. Reordering a day moved the wrong stop
// ---------------------------------------------------------------------------
// The list is drawn in time order; the arrows swapped entries in the stored
// order, which is the order things were added. So ↓ moved a stop you were not
// looking at, and where the two stops had times, the next render sorted them
// straight back anyway - the arrows appeared to do nothing at all.

await seed('b-move', {
  folders: ['Saved'],
  picks: [
    { id: 'custom:a', name: 'Alpha', city: 'Saved', category: 'Castle', lat: 56.1, lon: -3.1, addedAt: 1 },
    { id: 'custom:b', name: 'Bravo', city: 'Saved', category: 'Castle', lat: 56.2, lon: -3.2, addedAt: 2 },
    { id: 'custom:c', name: 'Charlie', city: 'Saved', category: 'Castle', lat: 56.3, lon: -3.3, addedAt: 3 },
  ],
  // Stored in the order they were added; shown in time order. The two differ,
  // which is the entire bug.
  plan: {
    days: [{ id: 'd1', label: 'Day 1 · Wed 19 Aug' }],
    items: { d1: [{ pickId: 'custom:c', time: '14:00' }, { pickId: 'custom:a', time: '10:00' }, { pickId: 'custom:b', time: '12:00' }] },
  },
});
await openTab('itinerary');
const shownOrder = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.plan-item-name')).map((e) => e.textContent.trim().split(' ')[0]));
check('the day is shown in time order', (await shownOrder()).join(',') === 'Alpha,Bravo,Charlie',
  JSON.stringify(await shownOrder()));

await page.evaluate(() => document.querySelector('[data-plan-move="d1|custom:a|1"]').click());
await page.waitForTimeout(500);
check('↓ moves the stop you are looking at, down one', (await shownOrder()).join(',') === 'Bravo,Alpha,Charlie',
  JSON.stringify(await shownOrder()));
await page.evaluate(() => document.querySelector('[data-plan-move="d1|custom:a|-1"]').click());
await page.waitForTimeout(500);
check('and ↑ puts it back', (await shownOrder()).join(',') === 'Alpha,Bravo,Charlie',
  JSON.stringify(await shownOrder()));

// ---------------------------------------------------------------------------
// 6. One toast element, two timers
// ---------------------------------------------------------------------------
// A plain toast and an actionable one share the element but kept separate
// timers. A plain toast a moment earlier hid the element halfway through the
// five seconds "Undo" was supposed to be offered for - so the way back from a
// deletion disappeared while you were still reading it.

await seed('b-toast', {
  folders: ['Home', 'Away'],
  picks: [{ id: 'custom:tea', name: 'Tea Room', city: 'Home', category: 'Cafe', lat: 55.9, lon: -3.1, addedAt: 1 }],
});
await openTab('picks');
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
// A plain toast: "Moved to Away".
await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('[data-move-pick]'));
  (chips.find((c) => c.textContent.trim() === 'Away') || chips[0]).click();
});
await page.waitForTimeout(250);
// ...and an actionable one, well inside the 2.4s the first one is due to run for.
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await page.evaluate(() => document.querySelector('[data-remove-pick]').click());
await page.waitForTimeout(400);
check('deleting a place offers the way back', await page.evaluate(() => {
  const el = document.getElementById('toast');
  return !!el && !!el.querySelector('.toast-action') && /Undo/.test(el.textContent);
}), await page.evaluate(() => (document.getElementById('toast') || {}).textContent || 'no toast'));

await page.waitForTimeout(3000);
const undoState = await page.evaluate(() => {
  const el = document.getElementById('toast');
  return { shown: !!el && el.classList.contains('show'), action: !!el && !!el.querySelector('.toast-action') };
});
check('and it is still there three seconds later, not hidden by the toast before it',
  undoState.shown && undoState.action, JSON.stringify(undoState));
await page.evaluate(() => document.querySelector('.toast-action').click());
await page.waitForTimeout(400);
check('undo puts the place back', (await readPicks('b-toast')).some((p) => p.name === 'Tea Room'));

// ---------------------------------------------------------------------------
// 7. Changing your mind about "a town or area"
// ---------------------------------------------------------------------------
// Marking a place as a town files it under its own name. Tapping back to
// "somewhere to go" left that behind, so the place was saved into a folder
// named after itself - one that was never created and appears nowhere.

await seed('b-label', { folders: ['Perth', 'Edinburgh'] });
aiResults = () => [{ name: 'Moulin Inn', area: 'Pitlochry', why: 'Old inn up the hill.' }];
geoResults = () => [];
await openTab('picks');
await page.click('#pickSearchTrigger');
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'Moulin Inn');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForSelector('[data-add-candidate]', { timeout: 8000 });
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
await page.waitForSelector('#placeModal.open [data-label-major]', { timeout: 5000 });

await page.evaluate(() => document.querySelector('[data-label-major="1"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('[data-label-major="0"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.getElementById('labelDone').click());
await page.waitForTimeout(1200);

const labelled = (await readPicks('b-label')).find((p) => /Moulin/.test(p.name));
check('the place is saved', !!labelled, JSON.stringify((await readPicks('b-label')).map((p) => p.name)));
check('changing your mind does not file it under its own name',
  !!labelled && labelled.city !== 'Moulin Inn', JSON.stringify(labelled && { city: labelled.city, major: labelled.major }));
check('it goes back to a folder that exists',
  !!labelled && ['Perth', 'Edinburgh', 'Unsorted'].includes(labelled.city), labelled && labelled.city);
check('and it is not a town any more', !!labelled && labelled.major === false);
await page.evaluate(() => document.querySelector('[data-search-close]')?.click());
await page.waitForTimeout(300);

// ---------------------------------------------------------------------------
// 8. Two searches in flight, and the slower one wins
// ---------------------------------------------------------------------------
// Search for one thing, change your mind, search for another: the first
// response arrived last and overwrote the second, so the screen showed
// results for a query you had already replaced.

await seed('b-race', { folders: ['Perth'] });
aiResults = (p) => (/castle/i.test(p)
  ? [{ name: 'Slow Castle', area: 'Perth', why: 'The query you gave up on.' }]
  : [{ name: 'Fast Bakery', area: 'Perth', why: 'The query you actually made.' }]);
aiDelayMs = (p) => (/castle/i.test(p) ? 2600 : 0);
geoResults = () => [];
await openTab('picks');
await page.click('#pickSearchTrigger');
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'castle');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(400);
await page.fill('#pickSearchInput', 'bakery');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(4200);

const raced = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.search-result .place-name')).map((e) => e.textContent.trim()));
check('the search you made last is the one on screen', raced.some((n) => /Fast Bakery/.test(n)), JSON.stringify(raced));
check('the one you gave up on cannot overwrite it', !raced.some((n) => /Slow Castle/.test(n)), JSON.stringify(raced));
aiDelayMs = () => 0;
await page.evaluate(() => document.querySelector('[data-search-close]')?.click());
await page.waitForTimeout(300);

// ---------------------------------------------------------------------------
// 9. "Looking up details…", for good
// ---------------------------------------------------------------------------
// Filling in a result's details was guarded by one flag meaning "some preview
// is loading". Open a second result while the first was still going and it was
// never fetched - and, because the flag was still set, it said so forever.

await seed('b-preview', { folders: ['Perth'] });
aiResults = () => [
  { name: 'Alpha Hall', area: 'Perth', why: 'The slow one.' },
  { name: 'Beta Hall', area: 'Perth', why: 'The one you actually open.' },
];
geoResults = () => [];
await openTab('picks');
await page.click('#pickSearchTrigger');
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'hall');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForSelector('[data-preview-candidate]', { timeout: 8000 });

// Only now does Alpha become slow - the search itself should not be held up.
geoDelayMs = (q) => (/Alpha/i.test(q) ? 6000 : 0);
wikiDelayMs = (u) => (/Alpha/i.test(u) ? 6000 : 0);
geoResults = (q) => (/Beta/i.test(q) ? [{
  lat: '56.3960', lon: '-3.4370', display_name: 'Beta Hall, Perth', type: 'attraction', class: 'tourism',
  namedetails: { name: 'Beta Hall' }, address: { town: 'Perth' }, extratags: {},
}] : []);

await page.evaluate(() => document.querySelectorAll('[data-preview-candidate]')[0].click());
await page.waitForSelector('#placeModal.open', { timeout: 4000 });
await page.waitForTimeout(500);
check('a result that is still loading says so', await page.evaluate(() =>
  /Looking up details/.test(document.getElementById('placeModal').textContent)));

await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelectorAll('[data-preview-candidate]')[1].click());
await page.waitForSelector('#placeModal.open', { timeout: 4000 });
await page.waitForTimeout(2000);

const secondPreview = await page.evaluate(() => document.getElementById('placeModal').textContent);
check('the second result you open is the right one', /Beta Hall/.test(secondPreview), secondPreview.slice(0, 120));
check('it is fetched even though the first is still going', /Perth/.test(secondPreview), secondPreview.slice(0, 200));
check('and does not sit on "Looking up details…" because of it',
  !/Looking up details/.test(secondPreview), secondPreview.slice(0, 200));
geoDelayMs = () => 0;
wikiDelayMs = () => 0;
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.evaluate(() => document.querySelector('[data-search-close]')?.click());
await page.waitForTimeout(300);

// ---------------------------------------------------------------------------
// 10. The folder is filing, not geography
// ---------------------------------------------------------------------------
// The geocoder was handed the folder as a location hint. A folder is whatever
// you called it - "Day trips", "Unsorted" - so the lookup was scoped to a
// place that does not exist, and where a folder happened to name a real one it
// pulled the wrong branch of a chain onto the map.

await seed('b-hint', { folders: ['Day trips'] });
aiResults = () => [{ name: 'Riverside Cafe', why: 'No area given, so nothing is known about where it is.' }];
geoResults = () => [];
geoQueries = [];
await openTab('picks');
await page.click('#pickSearchTrigger');
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'cafe');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForSelector('[data-add-candidate]', { timeout: 8000 });
geoQueries = [];
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
await page.waitForTimeout(2200);

const filed = (await readPicks('b-hint')).find((p) => /Riverside/.test(p.name));
check('one folder and nowhere else is not a question', !!filed && filed.city === 'Day trips',
  JSON.stringify(filed && { city: filed.city }));
check('the place is looked up', geoQueries.some((q) => /Riverside/i.test(q)), JSON.stringify(geoQueries).slice(0, 200));
check('but never with the folder name as its location',
  !geoQueries.some((q) => /Day trips|Unsorted/i.test(q)), JSON.stringify(geoQueries).slice(0, 240));
await page.evaluate(() => document.querySelector('[data-search-close]')?.click());
await page.waitForTimeout(300);

// ---------------------------------------------------------------------------
// 11. The first day you ever make, and the tab that should follow it
// ---------------------------------------------------------------------------
// Today is a tab only once the trip has a day in it, and that is recomputed
// when a view is shown. Putting a search result on a day redraws the search
// list instead, so the very first day left Today hidden until you happened to
// switch tabs - the one moment the tab had just become worth having.

await seed('b-tab', { folders: ['Saved'], plan: { days: [], items: {} } });
aiResults = () => [{ name: 'Moulin Inn', area: 'Pitlochry', why: 'Old inn up the hill.' }];
geoResults = () => [{
  lat: '56.7120', lon: '-3.7290', display_name: 'Moulin Inn, Pitlochry', type: 'pub', class: 'amenity',
  namedetails: { name: 'Moulin Inn' }, address: { town: 'Pitlochry' }, extratags: {},
}];
await openTab('picks');
check('with no days, Today is not a tab', await page.evaluate(() =>
  document.querySelector('.tab[data-view="today"]').hidden === true));

await page.click('#pickSearchTrigger');
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'Moulin Inn');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForSelector('[data-day-candidate]', { timeout: 8000 });
await page.evaluate(() => document.querySelector('[data-day-candidate]').click());
await page.waitForSelector('[data-day-quick]', { timeout: 5000 });
await page.evaluate(() => document.querySelector('[data-day-quick]').click());
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('daySheetDone').click());
await page.waitForTimeout(700);

check('the first day is made', (await readPlan('b-tab')).days.length === 1,
  JSON.stringify((await readPlan('b-tab')).days));
check('and Today appears there and then, without switching tabs first', await page.evaluate(() =>
  document.querySelector('.tab[data-view="today"]').hidden === false));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
