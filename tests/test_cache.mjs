// Four asks, one commit.
//
// "Cache results from past searches for like 7 days so I don't have to keep
// querying AI." Nine grounded calls is the most expensive thing this app does,
// and going back to a screen you were on ten minutes ago bought all nine
// again.
//
// "Don't cap the list - if you find 50 results give me 50." There was a
// slice(0, 40) per angle. Everything downstream already filters hard; a cap on
// top of that only ever threw away real answers to keep a list tidy.
//
// "I need a search for today, search tomorrow, as easy to search keys." They
// meant opening the date pickers and choosing the same day twice.
//
// "It's so hard to know what I selected or not, make use of colours." The
// .search-chip.on class was being written into the markup and styled in
// exactly one place in the whole stylesheet - the welcome flow. Everywhere
// else, including every chip on this screen, "selected" looked identical to
// "not selected".
import { chromium } from 'playwright';
import { angleFromPrompt, ANGLE_KEYS } from './lib/angles.mjs';
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
await page.addInitScript(() => { localStorage.setItem('onboarded-v1', '1'); });
await page.route(/wikidata|wikipedia|overpass|tile\.|photon|places\.googleapis|open-meteo/, (r) => r.abort());

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = iso(new Date());
const tomorrow = iso(new Date(Date.now() + 86400000));

// Fifty from one angle. The old code kept forty of them.
const MANY = 50;
let calls = 0;
let prompts = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  calls++;
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  prompts.push(p);
  const angle = angleFromPrompt(p);
  let list = [];
  if (angle === 'market') {
    list = Array.from({ length: MANY }, (_, i) => ({
      name: `Market Stall ${i + 1}`, date: today, time: `${String(8 + (i % 12)).padStart(2, '0')}:00`,
      venue: `Pitch ${i + 1}`, area: 'Bakewell', what: 'One of many.', price: 'free', setting: 'outdoor' }));
  } else if (angle) {
    list = [{ name: `${angle} thing`, date: today, time: '12:00', venue: 'The Hall',
      area: 'Bakewell', what: 'Something.', price: 'free', setting: 'indoor' }];
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(list) }] },
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/on', title: 'On' } }] } }] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-c', boards: [{ id: 'b-c', name: 'Trip', destination: 'Peak District', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Peak District', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-c:picks', JSON.stringify([]));
  localStorage.setItem('board:b-c:plan', JSON.stringify({ days: [], items: {} }));
  localStorage.setItem('board:b-c:search-anchor', JSON.stringify({ name: 'Bakewell', lat: 53.2129, lon: -1.6753, miles: 15 }));
  localStorage.removeItem('event-cache-v1');
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

const settle = () => page.waitForFunction(() => !window.__tripTest.eventsBusy(), null, { timeout: 60000 });
const rows = () => page.evaluate(() => document.querySelectorAll('.ev-row').length);
const screen = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
const openForm = async () => {
  await page.evaluate(() => document.querySelector('[data-view="events"]').click());
  await page.waitForTimeout(250);
  await page.evaluate(() => { const e = document.getElementById('evEdit'); if (e) e.click(); });
  await page.waitForTimeout(200);
};
const searchWindow = async (key) => {
  await openForm();
  await page.evaluate((k) => {
    const b = document.querySelector(`[data-ev-when="${k}"]`);
    if (b) b.click();
  }, key);
  await page.waitForTimeout(200);
  calls = 0; prompts = [];
  await page.evaluate(() => document.getElementById('evSearch').click());
  await settle();
};

// ---------- Easy keys for today and tomorrow ----------

await openForm();
check('there is a one-tap search for today', await page.evaluate(() =>
  !!document.querySelector('[data-ev-when="today"]')));
check('and for tomorrow', await page.evaluate(() =>
  !!document.querySelector('[data-ev-when="tomorrow"]')));
// They are the question actually asked on a trip, so they come first.
check('and they are the first two, not buried after the long ranges',
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[data-ev-when]')).map((b) => b.getAttribute('data-ev-when'));
    return all[0] === 'today' && all[1] === 'tomorrow';
  }),
  await page.evaluate(() => Array.from(document.querySelectorAll('[data-ev-when]')).map((b) => b.getAttribute('data-ev-when')).join(',')));

// ---------- A chosen chip looks chosen ----------

// Tolerant of the chip not existing: clicking null throws inside the page and
// kills the run, which prints no FAIL lines - a suite that is genuinely
// failing then looks like one that never ran.
const chipLook = await page.evaluate(() => {
  const on = document.querySelector('[data-ev-when="today"]') || document.querySelector('[data-ev-when="week"]');
  const off = document.querySelector('[data-ev-when="trip"]');
  if (!on || !off) return { marked: false, onBg: 'x', offBg: 'x', onWeight: '1', offWeight: '1' };
  on.click();
  const onNow = document.querySelector(`[data-ev-when="${on.getAttribute('data-ev-when')}"]`);
  const a = getComputedStyle(onNow);
  const b = getComputedStyle(document.querySelector('[data-ev-when="trip"]'));
  return { onBg: a.backgroundColor, offBg: b.backgroundColor, onWeight: a.fontWeight, offWeight: b.fontWeight,
    marked: onNow.classList.contains('on') };
});
check('the chosen one is marked in the markup', chipLook.marked);
// The class was there all along and styled nowhere but the welcome screen, so
// "selected" and "not selected" rendered identically.
check('and it actually looks different from the others',
  chipLook.onBg !== chipLook.offBg, JSON.stringify(chipLook));
// Colour alone is not a signal everybody can read.
check('and does not rely on colour alone to say so',
  chipLook.onWeight !== chipLook.offWeight, JSON.stringify(chipLook));

const kindLook = await page.evaluate(() => {
  const chip = document.querySelector('[data-ev-kind="market"]');
  if (!chip) return { on: 'x', off: 'x' };
  chip.click();
  const now = document.querySelector('[data-ev-kind="market"]');
  const other = document.querySelector('[data-ev-kind="music"]');
  return { on: getComputedStyle(now).backgroundColor, off: getComputedStyle(other).backgroundColor };
});
check('the same is true of the kinds you pick', kindLook.on !== kindLook.off, JSON.stringify(kindLook));
check('and the screen says how many you have picked',
  /1 of 9 picked/.test(await screen()), (await screen()).slice(0, 600));
check('with a way back to all of them', await page.evaluate(() => !!document.getElementById('evAllKinds')));
check('which puts them all back', await page.evaluate(() => {
  const all = document.getElementById('evAllKinds');
  if (all) all.click();
  return document.querySelectorAll('[data-ev-kind].on').length === 0;
}));

// ---------- Fifty found is fifty shown ----------

await searchWindow('today');
const found = await rows();
check('a search that finds fifty shows fifty, not forty',
  found >= MANY, `${found} rows from ${MANY} + ${ANGLE_KEYS.length - 1} others`);

// ---------- Not paying twice for the same question ----------

const callsFresh = calls;
check('the first search actually asked', callsFresh >= ANGLE_KEYS.length, String(callsFresh));

await searchWindow('today');
check('asking the same thing again costs nothing', calls === 0, `${calls} calls`);
check('and the answers are still there', (await rows()) === found, `${found} -> ${await rows()}`);
check('and it says they were remembered rather than found',
  /Remembered from/.test(await screen()), (await screen()).slice(0, 700));
check('with a way to go and look again', await page.evaluate(() => !!document.getElementById('evFresh')));

// A different day is a different question.
await searchWindow('tomorrow');
check('a different day is asked properly', calls >= ANGLE_KEYS.length, `${calls} calls`);

// And the remembered copy is per-question, so going back is free again.
await searchWindow('today');
check('and going back to the first one is free again', calls === 0, `${calls} calls`);

await page.evaluate(() => { const b = document.getElementById('evFresh'); if (b) b.click(); });
await settle();
check('"look again" does go and ask', calls >= ANGLE_KEYS.length, `${calls} calls`);
check('and stops calling the results remembered', !/Remembered from/.test(await screen()));

// ---------- What is remembered, and for how long ----------

const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('event-cache-v1') || '{}'));
check('the answers are stored', Object.keys(cache).length >= 1, JSON.stringify(Object.keys(cache)));
// Keyed on the dates, not the word: "today" means something else tomorrow.
check('keyed on the actual dates rather than the name of the window',
  Object.keys(cache).some((k) => k.includes(today)), JSON.stringify(Object.keys(cache)));

const aged = await page.evaluate((day) => {
  const c = JSON.parse(localStorage.getItem('event-cache-v1') || '{}');
  const key = Object.keys(c).find((k) => k.includes(day));
  if (!key) return null;
  // Eight days old: past its week.
  c[key].at = Date.now() - 8 * 24 * 60 * 60 * 1000;
  localStorage.setItem('event-cache-v1', JSON.stringify(c));
  return key;
}, today);
check('an entry can be aged for the test', !!aged);
await searchWindow('today');
check('anything older than a week is asked again rather than served stale',
  calls >= ANGLE_KEYS.length, `${calls} calls`);

// A remembered answer must never show something that has since finished.
const stale = await page.evaluate((day) => {
  const c = JSON.parse(localStorage.getItem('event-cache-v1') || '{}');
  const key = Object.keys(c).find((k) => k.includes(day));
  if (!key) return false;
  c[key].results.push({
    id: 'gone', name: 'Last Month Fair', kind: 'event',
    startsAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    lat: 53.21, lon: -1.67, area: 'Bakewell' });
  localStorage.setItem('event-cache-v1', JSON.stringify(c));
  return true;
}, today);
check('a past event can be planted in the remembered copy', stale);
await searchWindow('today');
check('and it is not shown, because the diary is filtered on the way out',
  !/Last Month Fair/.test(await screen()));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
