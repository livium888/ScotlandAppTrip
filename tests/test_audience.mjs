// Kids mode is for kids, adults mode is for adults, all the way down.
//
// "If I select kid, everything needs to be kid directed. If I select adult,
// everything is adult directed... and by adult I don't mean 18-plus stuff. I
// mean things a parent would do without a kid, or that anyone would do
// without a kid."
//
// The mode only ever changed which menus showed. Nothing told the model: a
// kids-mode search with no travellers list asked for "village hall events -
// coffee mornings, jumble sales, beetle drives", told the model to prefer
// exactly those, and to leave nothing out because "we will decide" - and then
// the app dropped only adults-only listings, so a lecture that merely allowed
// children came through. Adults mode got puppet shows. A saved preference
// for "somewhere a young child is welcome" went into every adults prompt.
import { chromium } from 'playwright';
import { goTo, openEventForm } from './lib/screens.mjs';
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

const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
let prompts = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models(\?|$)/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  prompts.push(p);
  // One of each kind of listing the model sends back, from one search so the
  // filter is the only thing deciding.
  const ev = (name, time, childFocus, what, extra) => Object.assign(
    { name, date: day, time, venue: 'Town Hall', area: 'Bakewell', what, price: '£', childFocus }, extra || {});
  const list = angleFromPrompt(p) === 'arts'
    ? [
        ev('Puppet Show', '11:00', 'aimed', 'Puppets.', { minAge: 3, maxAge: 7 }),
        ev('Lecture on Lead Mining', '14:00', 'allowed', 'A talk.'),
        ev('Late Comedy Night', '21:00', 'adults', 'Stand-up.'),
        ev("Teddy Bears' Picnic", '12:00', '', 'Bring a bear.'),
        ev('Gin Tasting', '19:00', '', 'Six gins.'),
        ev('Toddler Stay and Play', '10:00', '', 'Toys and songs.'),
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
await page.route(/wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon|open-meteo/, (r) => r.abort());

// No travellers list, which is how most people will have it: the mode has to
// carry the whole message on its own.
const seed = async (mode) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((m) => {
    localStorage.clear();
    localStorage.setItem('onboarded-v1', '1');
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }] }));
    localStorage.setItem('board:b:picks', JSON.stringify([
      { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true }]));
    localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
    const s = { geminiKey: 'k', preferences: 'Somewhere a young child is welcome\nIndependent places, not chains' };
    if (m) s.mode = m;
    localStorage.setItem('trip-settings-v1', JSON.stringify(s));
  }, mode);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
};
const search = async () => {
  prompts = [];
  await goTo(page, 'events', 400);
  await openEventForm(page);
  await page.evaluate(() => document.getElementById('evSearch').click());
  await page.waitForFunction(() => (window.__tripTest.eventResults || []).length > 0, { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => !window.__tripTest.eventsBusy || !window.__tripTest.eventsBusy(),
    { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  return page.evaluate(() => (window.__tripTest.eventResults || []).map((e) => e.name).sort());
};
const t = (fn, ...a) => page.evaluate(([f, args]) => window.__tripTest[f](...args), [fn, a]);
const view = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));

// Every search, in every mode, is still recognisable - the wordings differ.
for (const mode of [null, 'kids', 'adults']) {
  await seed(mode);
  const wrong = [];
  for (const k of ANGLE_KEYS) {
    const p = `${await t('anglePrompt', k)}\n${await t('aiContextBlock')}`;
    let got;
    try { got = angleFromPrompt(p); } catch (e) { got = e.message; }
    if (got !== k) wrong.push(`${k}->${got}`);
  }
  check(`every search can be told apart in ${mode || 'no'} mode`, !wrong.length, wrong.join(', '));
}

// ---------- Kids ----------
await seed('kids');
let found = await search();
const kidsArts = prompts.find((p) => angleFromPrompt(p) === 'arts') || '';
check('every kids-mode request says it is for children', prompts.length > 0 &&
  prompts.every((p) => /WITH CHILDREN/.test(p)), `${prompts.length} prompts`);
check('and asks to leave out what is not', prompts.every((p) => /Leave out anything that does not suit/.test(p)) &&
  !prompts.some((p) => /we will decide/.test(p)));
check('it no longer asks for coffee mornings and beetle drives', !prompts.some((p) => /beetle drive|coffee morning|jumble sale/i.test(p)),
  (prompts.find((p) => /beetle drive|coffee morning|jumble sale/i.test(p)) || '').slice(0, 160));
check('"arts" means children\'s theatre, not comedy nights', /puppet shows/.test(kidsArts) && !/comedy nights/.test(kidsArts),
  kidsArts.slice(0, 200));
check('the puppet show is there', found.includes('Puppet Show'), JSON.stringify(found));
check('and a listing that did not say, but is plainly for children', found.includes("Teddy Bears' Picnic"), JSON.stringify(found));
check('a lecture that merely allows children is not', !found.includes('Lecture on Lead Mining'), JSON.stringify(found));
check('nor the comedy night, nor the gin tasting',
  !found.includes('Late Comedy Night') && !found.includes('Gin Tasting'), JSON.stringify(found));
check('and the screen says what it left out, and why', /weren't for children/.test(await view()), (await view()).slice(-300));

// ---------- Adults ----------
await seed('adults');
found = await search();
const adultsArts = prompts.find((p) => angleFromPrompt(p) === 'arts') || '';
check('every adults-mode request says it is for grown-ups without children', prompts.length > 0 &&
  prompts.every((p) => /WITHOUT children/.test(p)), `${prompts.length} prompts`);
check('and that grown-up does not mean explicit', prompts.every((p) => /not adult content/.test(p) && /nothing sexual or explicit/.test(p)));
check('the child-shaped preference is not sent', !prompts.some((p) => /young child is welcome/.test(p)) &&
  prompts.some((p) => /Independent places, not chains/.test(p)));
check('"arts" means comedy and theatre, not puppets', /comedy nights/.test(adultsArts) && !/puppet/i.test(adultsArts),
  adultsArts.slice(0, 200));
check('the comedy night, the lecture and the gin tasting are there',
  ['Late Comedy Night', 'Lecture on Lead Mining', 'Gin Tasting'].every((n) => found.includes(n)), JSON.stringify(found));
check('the puppet show is not', !found.includes('Puppet Show'), JSON.stringify(found));
check('nor the stay and play that did not say, but plainly is for toddlers', !found.includes('Toddler Stay and Play'),
  JSON.stringify(found));
check('and the screen says so', /were for children/.test(await view()), (await view()).slice(-300));

// ---------- Places, the same ----------
check('a kids-mode walk is one a young child could manage', await (async () => {
  await seed('kids');
  return /young child/.test(await t('categoryPrompt', 'walk'));
})());
check('an adults-mode walk is a proper one', await (async () => {
  await seed('adults');
  const w = await t('categoryPrompt', 'walk');
  return /proper few miles/.test(w) && !/child/.test(w);
})());
check('the pub is a proper pub, not one that "allows children"',
  !/allow children/.test(await t('categoryPrompt', 'pub')), await t('categoryPrompt', 'pub'));
check('and every place search is told who it is for', /WITHOUT children/.test(await t('aiContextBlock')));

// ---------- No mode chosen: as it was ----------
await seed(null);
check('with no mode chosen nothing is said about who it is for', !(await t('audienceLine')));
check('and nothing is filtered but adults-only things', await page.evaluate(() =>
  ['aimed', 'allowed', ''].every((f) => window.__tripTest.eventFitsMode({ name: 'X', childFocus: f }) === '')));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
