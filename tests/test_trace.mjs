// "It came back with zero results - that's impossible, there are so many
// cinemas and theatres around me. Give me a debug button so we stop going
// in circles."
//
// Two things. First, a cause found while building the button: searches were
// remembered for a week even when they found nothing or failed, so asking
// the same thing again replayed "zero" in a second without asking anything.
// Second, the button: after any search, "What happened?" shows, per kind,
// the exact question, the model, the time taken, whether Gemini actually
// searched and what for, its raw answer, and what became of every listing -
// ready to copy or share, and never with the API key in it.
import { chromium } from 'playwright';
import { goTo, openEventForm } from './lib/screens.mjs';
import { angleFromPrompt } from './lib/angles.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await context.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

const KEY = 'AIzaSyFAKEKEY_1234567890abcdefghij';
const inWindow = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
const outside = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
let mode = 'found';
let calls = 0;
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models(\?|$)/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  calls++;
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  const f = (name, date, rating) => ({ name, date, times: ['10:30', '13:00'], venue: 'Vue Omni', area: 'Edinburgh', rating, price: '£' });
  const list = mode === 'found' && angleFromPrompt(p) === 'films'
    ? [f('Paddington in Peru', inWindow, 'PG'), f('Next Month Film', outside, 'U'), f('Alien: Romulus', inWindow, '15')]
    : [];
  const cand = { content: { parts: [{ text: JSON.stringify(list) }] } };
  if (mode !== 'unsearched') cand.groundingMetadata = { webSearchQueries: ['family films edinburgh this weekend'],
    groundingChunks: [{ web: { uri: 'https://cinema.example/listings', title: 'Listings' } }] };
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [cand] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '55.9533', lon: '-3.1883', display_name: 'Edinburgh', type: 'city',
    namedetails: { name: 'Edinburgh' }, address: { city: 'Edinburgh' }, extratags: {} }]) }));
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ elements: [] }) }));
await page.route(/wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon|open-meteo/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate((k) => {
  localStorage.clear();
  localStorage.setItem('onboarded-v1', '1');
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Edinburgh', destination: 'Edinburgh', dated: true, createdAt: 1 }] }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'a:1', name: 'Edinburgh', city: 'Edinburgh', category: 'City', lat: 55.9533, lon: -3.1883, major: true }]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Edinburgh']));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ geminiKey: k, mode: 'kids' }));
}, KEY);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

const search = async () => {
  await goTo(page, 'events', 300);
  await page.evaluate(() => window.__tripTest.setEventKinds(['films']));
  await openEventForm(page);
  await page.evaluate(() => document.getElementById('evSearch').click());
  await page.waitForFunction(() => document.querySelector('#evTrace'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
};
const traceOnScreen = () => page.evaluate(() => document.querySelector('#placeModal .trace-text')?.textContent || '');

// ---------- A search that found things ----------
await search();
check('after a search there is a "What happened?" button', await page.evaluate(() => !!document.getElementById('evTrace')));
await page.click('#evTrace');
await page.waitForTimeout(300);
let t = await traceOnScreen();
check('it shows where and when was asked', /Where: Edinburgh/.test(t) && /When: \d{4}-\d{2}-\d{2} to/.test(t), t.slice(0, 300));
check('the model it went to, and how long it took', /Model: models\/gemini-3\.5-flash/.test(t) && /Took: \d+\.\ds/.test(t), t.slice(0, 500));
check('whether it really searched, and what for', /Searched the web: yes/.test(t) && /family films edinburgh this weekend/.test(t));
check('the exact question sent', /--- question sent ---/.test(t) && /Only films rated U or PG by the BBFC/.test(t));
check('and the raw answer', /--- raw answer/.test(t) && /Next Month Film/.test(t));
check('what became of every listing: shown', /Paddington in Peru @ Vue Omni.*: SHOWN/.test(t), t);
check('dropped for its dates', /Next Month Film.*outside the dates/.test(t));
check('dropped for its rating, with the rating', /Alien: Romulus.*ratedOut \(rated 15\)/.test(t));
check('and never the API key', !t.includes(KEY) && !/AIza/.test(t));
await page.click('#traceCopy');
await page.waitForTimeout(300);
const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
check('Copy puts the whole trace on the clipboard', /Wayfare search trace/.test(copied) && /Paddington/.test(copied) && !copied.includes(KEY),
  copied.slice(0, 100));
check('it survives the app being closed', await page.evaluate(() => /Paddington/.test(localStorage.getItem('search-trace-v1') || '')));
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());

// ---------- A search that found nothing ----------
mode = 'unsearched';
calls = 0;
await page.evaluate(() => localStorage.removeItem('event-cache-v1'));
await search();
check('a search that came back empty still has the button', await page.evaluate(() => !!document.getElementById('evTrace')));
await page.click('#evTrace');
await page.waitForTimeout(300);
t = await traceOnScreen();
check('and the trace says Gemini did not search', /Searched the web: NO/.test(t), t.slice(0, 400));
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());

// ---------- Asking again really asks again ----------
const before = calls;
mode = 'found';
await search();
check('repeating a search that failed asks Gemini again rather than replaying "zero"', calls > before, `${before} -> ${calls}`);
check('and this time finds what is on', await page.evaluate(() =>
  (window.__tripTest.eventResults || []).some((e) => /Paddington/.test(e.name))));

// An empty search remembered by an older build is not replayed either.
await page.evaluate(() => {
  const cache = JSON.parse(localStorage.getItem('event-cache-v1') || '{}');
  Object.keys(cache).forEach((k) => { cache[k].results = []; });
  localStorage.setItem('event-cache-v1', JSON.stringify(cache));
});
const before2 = calls;
await search();
check('an empty search remembered from before is asked again, not replayed', calls > before2, `${before2} -> ${calls}`);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
