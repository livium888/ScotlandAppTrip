// Kids mode and adults mode.
//
// "It's great, but there are so many options, it's ridiculous... everything
// is everywhere." Measured, the kid-specific material reaches 77 places in
// the app, and none of it adapted: the Kids screen, the "For children"
// search, playgrounds and soft play, nap and bedtime warnings all showed on
// an adults-only trip. Some of it was worse than irrelevant - walking times
// were fixed at a 4-year-old's pace for everybody, and "Rainy day with a
// 4-year-old" was a suggestion offered to every user.
//
// A manual switch, by explicit choice: the app does not guess from who is
// travelling. An install that has never chosen shows everything, exactly as
// before, until somebody picks.
//
// The switch changes what is shown and searched for, never what is stored.
// The travellers list keeps its children in adults mode; they are simply
// not on this outing.
import { chromium } from 'playwright';
import { goTo, openEventForm, openWhatSheet, closeAskSheet } from './lib/screens.mjs';
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

const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
let prompts = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  prompts.push(p);
  const angle = angleFromPrompt(p);
  // One adults-only event, one aimed at children, so both modes have
  // something to hide.
  const list = angle === 'arts'
    ? [
        { name: 'Late Comedy Night', date: day, time: '21:00', venue: 'The Castle Inn', area: 'Bakewell',
          what: 'Stand-up.', price: '£', childFocus: 'adults' },
        { name: 'Puppet Show', date: day, time: '11:00', venue: 'Town Hall', area: 'Bakewell',
          what: 'Puppets.', price: 'free', childFocus: 'aimed', minAge: 3, maxAge: 7 },
      ]
    : [];
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(list) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://bakewell.example/on', title: 'On' } }] } }] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ elements: [] }) }));
await page.route(/wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon/, (r) => r.abort());

const PEOPLE = [{ name: 'Liviu', age: 38 }, { name: 'Ella', age: 5 }];
const seed = async (mode) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(([m, people]) => {
    localStorage.clear();
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }],
    }));
    localStorage.setItem('board:b:picks', JSON.stringify([
      { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true },
      { id: 'c:1', name: 'Chatsworth House', city: 'Bakewell', category: 'Attraction', lat: 53.2276, lon: -1.6104 },
    ]));
    localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
    localStorage.setItem('people-v1', JSON.stringify(people));
    const s = { geminiKey: 'k' };
    if (m) s.mode = m;
    localStorage.setItem('trip-settings-v1', JSON.stringify(s));
  }, [mode, PEOPLE]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
};

const countOf = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const bodyText = () => page.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
const moreHasKids = async () => {
  await goTo(page, 'more', 300);
  return page.evaluate(() => !!document.querySelector('[data-more="kids"]'));
};
const categories = () => page.evaluate(() => {
  window.__tripTest.openCategoryPicker();
  const keys = [...document.querySelectorAll('[data-choose-cat]')].map((b) => b.getAttribute('data-choose-cat'));
  const m = document.getElementById('placeModal');
  m.classList.remove('open'); m.innerHTML = '';
  return keys;
});
const whatKinds = async () => {
  await openWhatSheet(page);
  const keys = await page.evaluate(() =>
    [...document.querySelectorAll('#placeModal [data-ev-kind]')].map((b) => b.getAttribute('data-ev-kind')));
  await closeAskSheet(page);
  return keys;
};
const search = async () => {
  prompts = [];
  await goTo(page, 'events', 400);
  await openEventForm(page);
  await page.evaluate(() => document.getElementById('evSearch').click());
  await page.waitForFunction(() => (window.__tripTest.eventResults || []).length > 0, { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => !window.__tripTest.eventsBusy || !window.__tripTest.eventsBusy(),
    { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  return page.evaluate(() => (window.__tripTest.eventResults || []).map((e) => e.name));
};

// ---------- Never chosen: everything, as before, and a question ----------
await seed(null);
check('an install that has never chosen still shows the kids screen', await moreHasKids());
let cats = await categories();
check('and every category', cats.includes('playground') && cats.includes('pub'), cats.join(','));
// The invitation is the switch itself rather than a sheet that pops up on
// launch - a launch-time interruption is the kind of clutter this is for.
check('there is a switch in the top bar', await countOf('#modeToggle') === 1);
check('and before anyone has chosen, it asks', /kids or adults/i.test(
  await page.evaluate(() => document.getElementById('modeToggle').textContent)));
await page.evaluate(() => document.getElementById('modeToggle').click());
await page.waitForTimeout(400);
check('tapping it offers both', await countOf('[data-choose-mode]') === 2,
  String(await countOf('[data-choose-mode]')));
await page.evaluate(() => document.querySelector('[data-choose-mode="adults"]').click());
await page.waitForTimeout(500);
check('and choosing one sticks', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('trip-settings-v1')).mode === 'adults'));

// ---------- Adults ----------
await seed('adults');
check('adults mode drops the kids screen', !(await moreHasKids()));
check('and does not ask again', !/kids or adults/i.test(
  await page.evaluate(() => document.getElementById('modeToggle').textContent)));
cats = await categories();
check('and the child categories', !cats.some((k) => ['playground', 'softplay', 'kidfriendly', 'rainy'].includes(k)),
  cats.join(','));
check('but keeps the pub', cats.includes('pub'), cats.join(','));
let kinds = await whatKinds();
check('the "for children" search is not offered', !kinds.includes('family'), kinds.join(','));
check('and "music and nightlife" is', kinds.includes('music'), kinds.join(','));

let found = await search();
check('no request is spent looking for children\'s events',
  !prompts.some((p) => angleFromPrompt(p) === 'family'), `${prompts.length} prompts`);
check('the model is not told a child is coming', prompts.length > 0 && !prompts.some((p) => /child|aged 5|aged 4/i.test(
  (p.match(/Who is travelling[^\n]*/i) || p.match(/Travellers?:[^\n]*/i) || [''])[0])), (prompts[0] || '').slice(0, 200));
check('the adult event is there, with no "adults only" warning against it',
  found.includes('Late Comedy Night') && !/adults only/i.test(await bodyText()), JSON.stringify(found));
check('walking is at an adult pace', await page.evaluate(() => window.__tripTest.walkKmh() >= 4.5),
  await page.evaluate(() => String(window.__tripTest.walkKmh())));
check('no bedtime is worked out for anyone', await page.evaluate(() => !window.__tripTest.earliestBedtime()));

// ---------- Kids ----------
await seed('kids');
check('kids mode has the kids screen', await moreHasKids());
cats = await categories();
check('and the child categories', cats.includes('playground') && cats.includes('softplay'), cats.join(','));
check('but not the pub', !cats.includes('pub'), cats.join(','));
kinds = await whatKinds();
check('"for children" is offered', kinds.includes('family'), kinds.join(','));
check('"music and nightlife" is not', !kinds.includes('music'), kinds.join(','));

found = await search();
check('no request is spent on nightlife', !prompts.some((p) => angleFromPrompt(p) === 'music'),
  `${prompts.length} prompts`);
check('the children\'s event is there', found.includes('Puppet Show'), JSON.stringify(found));
check('and the adults-only one is not, rather than being shown with a warning',
  !found.includes('Late Comedy Night') && !/Late Comedy Night/.test(await bodyText()), JSON.stringify(found));
check('walking is at a child\'s pace', await page.evaluate(() => window.__tripTest.walkKmh() < 4.5));

// ---------- The switch ----------
await page.evaluate(() => document.getElementById('modeToggle').click());
await page.waitForTimeout(500);
check('the top-bar switch flips it', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('trip-settings-v1')).mode === 'adults'));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
check('and it survives closing the app', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('trip-settings-v1')).mode === 'adults'));
check('nobody was removed from the travellers list', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('people-v1')).length === 2));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
