// Putting a place on a day used to require the trip to exist first. The day
// chips only appeared once days had been added in the Itinerary tab, and a
// saved place with no plan met "Add days in the Itinerary tab first" - setup
// standing between you and the thing you were trying to do.
//
// A day is only a label with a date in it, and the date is known the moment
// you say "today" or tap one on a calendar. So it is made on the spot, from
// wherever you are: a search result you have not saved yet, or a place you
// saved a week ago.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}${''}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 820 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

const readPlan = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-d:plan') || '{"days":[],"items":{}}'));
const readPicks = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-d:picks') || '[]'));

await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([
      { name: 'Moulin Inn', area: 'Pitlochry', why: 'Old inn up the hill.' },
    ]) }] } }],
  }) });
});
await page.route(/nominatim\.openstreetmap\.org/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '56.7120', lon: '-3.7290', display_name: 'Moulin Inn, Pitlochry', type: 'pub', class: 'amenity',
    namedetails: { name: 'Moulin Inn' }, address: { town: 'Pitlochry' }, extratags: {},
  }]) }));
await page.route(/wikidata|wikipedia|overpass|tile\.|open-meteo|photon/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  // No plan at all: no days, nothing scheduled. The state the app used to
  // treat as a dead end.
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-d', boards: [{ id: 'b-d', name: 'On the fly', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
  }));
  localStorage.setItem('board:b-d:folders', JSON.stringify(['Saved']));
  localStorage.setItem('board:b-d:picks', JSON.stringify([
    { id: 'custom:Castle', name: 'Blair Castle', city: 'Saved', category: 'Castle', lat: 56.7700, lon: -3.8400, addedAt: 1 },
  ]));
  localStorage.setItem('board:b-d:plan', JSON.stringify({ days: [], items: {} }));
});
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(400);

// ---------- A saved place, with no itinerary to speak of ----------

await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open', { timeout: 4000 });
check('a place with no plan is not told to go and build one first', await page.evaluate(() =>
  !/Add days in the Itinerary tab first/.test(document.getElementById('placeModal').textContent)));
check('it offers to put it on a day', await page.evaluate(() => !!document.querySelector('[data-day-sheet]')));

await page.evaluate(() => document.querySelector('[data-day-sheet]').click());
await page.waitForSelector('[data-day-quick]', { timeout: 4000 });
check('today and tomorrow are named, not dated', await page.evaluate(() => {
  const text = document.getElementById('placeModal').textContent;
  return /Today/.test(text) && /Tomorrow/.test(text);
}));
check('and it says the day will be made', await page.evaluate(() =>
  /no days planned yet/.test(document.getElementById('placeModal').textContent)));

await page.evaluate(() => document.querySelector('[data-day-quick]').click());
await page.waitForTimeout(500);

const planned = await readPlan();
check('picking Today makes the day', planned.days.length === 1, JSON.stringify(planned.days));
check('and puts the place on it', Object.values(planned.items).flat().some((it) => it.pickId === 'custom:Castle'),
  JSON.stringify(planned.items));

const todayLabel = planned.days[0] && planned.days[0].label;
const now = new Date();
check('the day is labelled with today\'s date', !!todayLabel && new RegExp(`\\b${now.getDate()}\\b`).test(todayLabel), todayLabel);
check('and numbered like the rest', !!todayLabel && /^Day 1 · /.test(todayLabel), todayLabel);

// Tapping it again takes it off - the same control both ways.
await page.evaluate(() => document.querySelector('[data-day-quick]').click());
await page.waitForTimeout(400);
check('tapping again takes it off that day', Object.values((await readPlan()).items).flat().length === 0,
  JSON.stringify((await readPlan()).items));
await page.evaluate(() => document.querySelector('[data-day-quick]').click());
await page.waitForTimeout(400);

// ---------- Any other date, made in order ----------

const future = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
const iso = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
await page.evaluate((v) => {
  const el = document.getElementById('dayDatePick');
  el.value = v;
  el.dispatchEvent(new Event('change'));
}, iso);
await page.waitForTimeout(600);

const twoDays = await readPlan();
check('a date from the calendar makes its own day', twoDays.days.length === 2, JSON.stringify(twoDays.days.map((d) => d.label)));
check('days stay in date order', /^Day 1 · /.test(twoDays.days[0].label) && /^Day 2 · /.test(twoDays.days[1].label),
  JSON.stringify(twoDays.days.map((d) => d.label)));
check('the place is on both', Object.values(twoDays.items).flat().filter((it) => it.pickId === 'custom:Castle').length === 2,
  JSON.stringify(twoDays.items));

await page.evaluate(() => document.getElementById('daySheetDone').click());
await page.waitForTimeout(500);

// ---------- Straight from a search result, before it is even saved ----------

await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'Moulin Inn');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForSelector('[data-day-candidate]', { timeout: 8000 });
check('a search result offers a day too', await page.evaluate(() =>
  !!document.querySelector('[data-day-candidate]')));

check('and it is not saved yet', !(await readPicks()).some((p) => /Moulin/.test(p.name)),
  JSON.stringify((await readPicks()).map((p) => p.name)));

await page.evaluate(() => document.querySelector('[data-day-candidate]').click());
await page.waitForSelector('[data-day-quick]', { timeout: 5000 });
check('choosing a day saves it on the way', (await readPicks()).some((p) => /Moulin/.test(p.name)),
  JSON.stringify((await readPicks()).map((p) => p.name)));
check('without asking a second question first', await page.evaluate(() =>
  document.querySelectorAll('[data-label-folder]').length === 0));

await page.evaluate(() => document.querySelector('[data-day-quick]').click());
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('daySheetDone').click());
await page.waitForTimeout(600);

const withInn = await readPlan();
const innId = (await readPicks()).find((p) => /Moulin/.test(p.name)).id;
check('and it lands on the day', Object.values(withInn.items).flat().some((it) => it.pickId === innId),
  JSON.stringify(withInn.items));

// ---------- Which is what Today then shows ----------

await page.evaluate(() => document.querySelector('[data-view="today"]').click());
await page.waitForTimeout(700);
const todayText = await page.evaluate(() => document.getElementById('view').textContent);
check('Today shows what was put there, with no itinerary ever built',
  /Moulin Inn/.test(todayText) && /Blair Castle/.test(todayText), todayText.slice(0, 220));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
