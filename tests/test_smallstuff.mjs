// "Make sure the prompt is exceptionally tailored to find the most minuscule
// thing ever... Loads of stuff is on Facebook, loads of stuff is on Instagram,
// and probably not on mainstream websites. I really want to make sure we don't
// lose anything that is actually fun and nice to do."
//
// Three concrete weaknesses in what was being sent.
//
// It asked about a RADIUS. "Within 15 miles of Bakewell" is close to
// meaningless to a model - it cannot draw a circle and read what is inside it.
// A parish hall event is written down under the name of its village and
// nowhere else, so the villages have to be named. That costs nothing: Overpass
// already answers "every settlement near here" for free, no key, no AI quota.
//
// "Be thorough, small and local counts" was a HINT. It named no source and no
// vocabulary, and a model that is not told where to look reaches for the
// tourist board.
//
// And "Local & one-off" was one search doing the work of four - the one
// covering the smallest events, which is what this screen is for.
//
// The honest limit, stated on screen rather than hidden: closed Facebook
// groups and Instagram are not indexed by anything, and no prompt reaches them.
import { chromium } from 'playwright';
import { ANGLE_MARKERS, ANGLE_KEYS, angleFromPrompt } from './lib/angles.mjs';
import { openEventForm, openAnglePencils } from './lib/screens.mjs';
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
await page.route(/wikidata|wikipedia|tile\.|photon|places\.googleapis|open-meteo/, (r) => r.abort());

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = iso(new Date(Date.now() + 3 * 86400000));

// The villages Overpass knows about. Real Peak District ones, so the intent is
// legible when this fails.
const VILLAGES = [
  ['Bakewell', 'town'], ['Ashford-in-the-Water', 'village'], ['Great Longstone', 'village'],
  ['Baslow', 'village'], ['Hassop', 'hamlet'], ['Youlgreave', 'village'], ['Monyash', 'village'],
];
let overpassCalls = 0;
let overpassDown = false;
await page.route(/overpass/, (route) => {
  overpassCalls++;
  if (overpassDown) return route.fulfill({ status: 504, body: 'gateway timeout' });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    elements: VILLAGES.map(([name, place], i) => ({
      type: 'node', id: i, lat: 53.21 + i * 0.01, lon: -1.67 - i * 0.01,
      tags: { name, place } })) }) });
});

let prompts = [];
let callTimes = [];
const started = () => Date.now();
let t0 = 0;
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  prompts.push(p);
  callTimes.push(Date.now() - t0);
  const angle = angleFromPrompt(p);
  const list = angle
    ? [{ name: `${angle} thing`, date: day, time: '11:00', venue: 'The Hall', area: 'Bakewell',
        what: 'Something small.', price: 'free', setting: 'indoor' }]
    : [];
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(list) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/on', title: 'On' } }] } }] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-sm', boards: [{ id: 'b-sm', name: 'Trip', destination: 'Peak District', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Peak District', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-sm:picks', JSON.stringify([]));
  localStorage.setItem('board:b-sm:plan', JSON.stringify({ days: [], items: {} }));
  localStorage.setItem('board:b-sm:search-anchor', JSON.stringify({ name: 'Bakewell', lat: 53.2129, lon: -1.6753, miles: 15 }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

const settle = () => page.waitForFunction(() => !window.__tripTest.eventsBusy(), null, { timeout: 40000 });
const screen = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
const search = async () => {
  prompts = []; callTimes = []; t0 = started();
  await page.evaluate(() => document.querySelector('[data-view="events"]').click());
  await page.waitForTimeout(250);
  await openEventForm(page);
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('[data-ev-when="week"]').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => localStorage.removeItem('event-cache-v1'));
  await page.evaluate(() => document.getElementById('evSearch').click());
  await settle();
};

await search();

// ---------- Nine searches, not one general one ----------

check('the catch-all is split into the places small things actually live',
  ANGLE_KEYS.length === 9, `${ANGLE_KEYS.length} angles`);
const asked = new Set(prompts.map(angleFromPrompt).filter(Boolean));
check('and every one of them is asked', asked.size === 9, `${asked.size}: ${[...asked].join(',')}`);
check('including the village hall, the clubs and the fetes',
  ['hall', 'clubs', 'fetes'].every((k) => asked.has(k)), [...asked].join(','));

// ---------- The villages, by name ----------

check('the villages are looked up rather than guessed at', overpassCalls >= 1, String(overpassCalls));
check('and named in the prompt, not left as a radius',
  prompts.every((p) => /Ashford-in-the-Water/.test(p) && /Great Longstone/.test(p)),
  (prompts[0] || '').slice(0, 400));
check('the radius is still there, because it is what bounds the answer',
  prompts.every((p) => /\b15 miles\b/.test(p)), (prompts[0] || '').slice(0, 300));
// Naming the town twice reads as a mistake.
check('the centre is not repeated in the list of what the area covers',
  prompts.every((p) => !/covers Bakewell/.test(p)), (prompts[0] || '').slice(0, 300));
check('and it is told to go through them rather than only the biggest',
  prompts.every((p) => /go through them, not just the biggest one/.test(p)));

const callsBefore = overpassCalls;
await search();
check('a second search of the same area does not ask again',
  overpassCalls === callsBefore, `${callsBefore} -> ${overpassCalls}`);

// ---------- Where to look, and permission to be tiny ----------

check('it names where small things are actually written down',
  prompts.every((p) => /parish magazines and community newsletters/.test(p) &&
    /village hall and community centre pages/.test(p)), (prompts[0] || '').slice(0, 900));
check('including the ticketing sites tiny organisers really use',
  prompts.every((p) => /TicketSource/.test(p) && /Ticket Tailor/.test(p)));
check('and council minutes, which is where a lot of it first appears',
  prompts.every((p) => /council minutes and agendas/.test(p)));
// The old wording was a hint. This is an instruction.
check('it says plainly that six people at a coffee morning is the point',
  prompts.every((p) => /six people at it is exactly what is wanted/.test(p)));
check('and that something with no website at all still counts',
  prompts.every((p) => /no website at all, mentioned/.test(p)));
check('and that most of what is on is aimed at residents, not visitors',
  prompts.every((p) => /aimed at the people who live there/.test(p)));
// Still refusing to invent, which breadth must not cost.
check('while still refusing to make things up', prompts.every((p) => /[Dd]o not invent/.test(p)));

// ---------- Staggered, so nine calls do not all land at once ----------

check('the searches are staggered rather than fired simultaneously',
  Math.max(...callTimes) - Math.min(...callTimes) > 400,
  JSON.stringify(callTimes.slice().sort((a, b) => a - b)));

// ---------- Overpass being down is not a failed search ----------

overpassDown = true;
await page.evaluate(() => localStorage.removeItem('board:b-sm:picks'));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await search();
check('a village lookup that fails falls back to the radius',
  prompts.length > 0 && prompts.every((p) => /within about 15 miles of Bakewell/.test(p)),
  (prompts[0] || '').slice(0, 200));
check('and the search still returns things', await page.evaluate(() =>
  document.querySelectorAll('.ev-row').length > 0));
overpassDown = false;

// ---------- Saying what cannot be reached ----------

const text = await screen();
check('it says closed groups and Instagram cannot be searched by anything',
  /Closed Facebook groups and Instagram can't be searched/.test(text), text.slice(-500));
check('and says what it did search instead', /parish newsletters/.test(text), text.slice(-500));
check('and offers the thing to do about it', await page.evaluate(() =>
  !!document.getElementById('evAddByHand')));

// ---------- Tuning a search, the way a category already can be ----------

await openAnglePencils(page);
check('each search can be changed', await page.evaluate(() =>
  document.querySelectorAll('[data-ev-tune]').length === 9),
  await page.evaluate(() => document.querySelectorAll('[data-ev-tune]').length));

await openAnglePencils(page);
await page.evaluate(() => document.querySelector('[data-ev-tune="hall"]').click());
await page.waitForSelector('#anglePromptBox');
const shown = await page.evaluate(() => document.getElementById('anglePromptBox').value);
check('it opens on what that search currently asks for', /beetle drives/.test(shown), shown.slice(0, 160));
// The scaffolding is the app's job, not something to be edited or broken.
check('the JSON rules are not exposed for editing', !/JSON/i.test(shown), shown.slice(0, 200));

await page.evaluate(() => {
  const box = document.getElementById('anglePromptBox');
  box.value = 'anything in the Bakewell Bugle parish newsletter';
  document.getElementById('anglePromptSave').click();
});
await page.waitForTimeout(400);
await search();
check('the reworded question is what gets asked',
  prompts.some((p) => /Bakewell Bugle parish newsletter/.test(p)), (prompts[0] || '').slice(0, 300));
check('the old wording is gone', !prompts.some((p) => /beetle drives/.test(p)));
check('but the app still adds where to look',
  prompts.some((p) => /parish magazines and community newsletters/.test(p) &&
    /Bakewell Bugle/.test(p)));
check('and the formatting rules survive the edit',
  prompts.every((p) => /ONLY a JSON array/.test(p)));
check('and the villages do too', prompts.some((p) => /Ashford-in-the-Water/.test(p)));
await openEventForm(page);
check('an edited search is marked in the list', await page.evaluate(() =>
  !!document.querySelector('[data-ev-kind="hall"].tuned')));
check('and an untouched one is not', await page.evaluate(() =>
  !document.querySelector('[data-ev-kind="clubs"].tuned')));

await openAnglePencils(page);
await page.evaluate(() => document.querySelector('[data-ev-tune="hall"]').click());
await page.waitForSelector('#anglePromptReset');
await page.evaluate(() => document.getElementById('anglePromptReset').click());
await page.waitForTimeout(300);
await search();
check('reset restores the default question',
  prompts.some((p) => /beetle drives/.test(p)), (prompts[0] || '').slice(0, 300));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
