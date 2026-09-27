// Children's sessions, each its own search.
//
// Workshops, storytime, swimming sessions, active sessions, animal
// encounters, holiday clubs, music and dance: things with sessions at set
// times, which one broad "For children" search could only skim. Kids mode
// only; searched only when tapped; grouped under "For the kids" on Find; and
// the ages respected both ways - a class for eight-and-up is no use to a
// five-year-old, and a toddler splash is no use to a nine-year-old.
import { chromium } from 'playwright';
import { goTo, openEventForm, closeAskSheet, openWhatSheet } from './lib/screens.mjs';
import { angleFromPrompt } from './lib/angles.mjs';
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

const KIDS = ['workshops', 'storytime', 'swim', 'active', 'animals', 'holiday', 'kidsmusic'];
const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
let prompts = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  prompts.push(p);
  const s = (name, times, extra) => Object.assign({
    name, date: day, time: times[0], times, venue: 'Royal Commonwealth Pool', area: 'Edinburgh', what: 'A session.', price: '£' }, extra || {});
  const list = angleFromPrompt(p) === 'swim'
    ? [
        s('Family Swim', ['10:00', '14:00'], { childFocus: 'aimed', minAge: 0, maxAge: 16 }),
        // Unlabelled, but it came back from a search for children's sessions.
        s('Inflatable Fun Session', ['11:30', '15:30']),
        s('Toddler Splash', ['09:30'], { childFocus: 'aimed', minAge: 0, maxAge: 3 }),
        s('Junior Swim Squad Taster', ['17:00'], { childFocus: 'aimed', minAge: 8, maxAge: 14 }),
        s('Adult Lane Swim', ['07:00'], { childFocus: 'adults' }),
      ]
    : [];
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(list) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://pools.example', title: 'Timetable' } }] } }] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '55.9533', lon: '-3.1883', display_name: 'Edinburgh', type: 'city',
    namedetails: { name: 'Edinburgh' }, address: { city: 'Edinburgh' }, extratags: {} }]) }));
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ elements: [] }) }));
await page.route(/wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon|open-meteo/, (r) => r.abort());

const seed = async (mode) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((m) => {
    localStorage.clear();
    localStorage.setItem('onboarded-v1', '1');
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b', boards: [{ id: 'b', name: 'Edinburgh', destination: 'Edinburgh', dated: true, createdAt: 1 }] }));
    localStorage.setItem('board:b:picks', JSON.stringify([
      { id: 'a:1', name: 'Edinburgh', city: 'Edinburgh', category: 'City', lat: 55.9533, lon: -3.1883, major: true }]));
    localStorage.setItem('board:b:folders', JSON.stringify(['Edinburgh']));
    localStorage.setItem('people-v1', JSON.stringify([{ name: 'Liviu', age: 38 }, { name: 'Ella', age: 5 }]));
    localStorage.setItem('trip-settings-v1', JSON.stringify({ geminiKey: 'k', mode: m }));
  }, mode);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
};
const rows = async () => {
  if (!(await page.evaluate(() => !!document.querySelector('[data-find="kids"]')))) return [];
  await page.click('[data-find="kids"]');
  await page.waitForTimeout(300);
  const keys = await page.evaluate(() => [...document.querySelectorAll('#placeModal [data-find-kind]')].map((b) => b.getAttribute('data-find-kind')));
  await closeAskSheet(page);
  return keys;
};
const view = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));

// ---------- Where they are ----------
await seed('kids');
await goTo(page, 'events', 400);
check('kids mode has one "For the kids" row on Find, not seven', /For the kids/.test(await view()) &&
  await page.evaluate(() => document.querySelectorAll('#view [data-find-kind]').length === 0));
check('behind it, all seven, each its own row', JSON.stringify(await rows()) === JSON.stringify(KIDS), JSON.stringify(await rows()));
check('none of them is part of an ordinary search', await page.evaluate((k) =>
  !window.__tripTest.defaultAngles().some((a) => k.includes(a.key)), KIDS));
await openWhatSheet(page);
check('on the What sheet they sit with the other searched-when-picked kinds',
  /Searched only when picked/.test(await page.evaluate(() => document.getElementById('placeModal').textContent)) &&
  (await page.evaluate(() => [...document.querySelectorAll('#placeModal [data-ev-kind]')].map((b) => b.getAttribute('data-ev-kind'))))
    .filter((k) => KIDS.includes(k)).length === 7);
await closeAskSheet(page);

await seed('adults');
await goTo(page, 'events', 400);
check('adults mode has none of them', (await rows()).length === 0 && !/For the kids/.test(await view()));
await openWhatSheet(page);
check('not even on the What sheet', !(await page.evaluate((k) =>
  [...document.querySelectorAll('#placeModal [data-ev-kind]')].some((b) => k.includes(b.getAttribute('data-ev-kind'))), KIDS)));
await closeAskSheet(page);

// ---------- One of them, as a person would use it ----------
await seed('kids');
await goTo(page, 'events', 400);
await page.click('[data-find="kids"]');
await page.waitForTimeout(300);
await page.click('#placeModal [data-find-kind="swim"]');
await page.waitForTimeout(400);
check('tapping a row opens the sheet with that one picked', await page.evaluate(() =>
  document.querySelector('#placeModal [data-ev-kind="swim"]')?.classList.contains('on')));
await closeAskSheet(page);
prompts = [];
await openEventForm(page);
await page.evaluate(() => document.getElementById('evSearch').click());
await page.waitForFunction(() => (window.__tripTest.eventResults || []).length > 0, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);
const found = await page.evaluate(() => (window.__tripTest.eventResults || []).map((e) => e.name).sort());
check('one request, for swimming sessions', prompts.length === 1 && angleFromPrompt(prompts[0]) === 'swim', `${prompts.length}`);
check('asking for session times and the ages each is for', /session times/.test(prompts[0] || '') &&
  /"minAge" and "maxAge"/.test(prompts[0] || ''));
check('for a five-year-old: the family swim, and the unlabelled fun session it was asked for',
  JSON.stringify(found) === JSON.stringify(['Family Swim', 'Inflatable Fun Session']), JSON.stringify(found));
check('not the squad taster for eights and up, the toddler splash, or the adult lanes',
  !found.some((n) => /Squad|Toddler|Adult/.test(n)), JSON.stringify(found));
check('and it says why, both ways', /for older children/.test(await view()) && /for younger children/.test(await view()),
  (await view()).slice(0, 400));
check('with each session time listed', await page.evaluate(() =>
  /10:00.*14:00/.test([...document.querySelectorAll('.ev-showtimes')].map((x) => x.textContent).join('|'))));
check('and a note about checking with the venue', /venue listings/.test(await view()));

// A nine-year-old is past a toddler class, and old enough for the taster.
await page.evaluate(() => localStorage.setItem('people-v1', JSON.stringify([{ name: 'Liviu', age: 38 }, { name: 'Sam', age: 9 }])));
check('a toddler class is out for a nine-year-old; the taster for eights and up is in', await page.evaluate(() => {
  const fit = window.__tripTest.eventFitsMode;
  return fit({ name: 'Toddler Splash', showing: true, kidsSession: true, minAge: 0, maxAge: 3 }) === 'tooYoung' &&
    fit({ name: 'Junior Swim Squad Taster', showing: true, kidsSession: true, minAge: 8, maxAge: 14 }) === '';
}));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
