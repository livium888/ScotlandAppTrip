// Typing a place name should offer you places.
//
// Every location field in the app was a plain text box with a Set button:
// type "Bakewell", press Set, and either it worked or you got "Couldn't find
// that". No suggestions, no way to choose between the four Newports, and no
// way to tell a typo from a place the geocoder simply does not know. You had
// to guess the spelling of somewhere you were going precisely because you
// did not know it well.
//
// The constraint worth stating: Nominatim is a free community service whose
// usage policy asks people not to fire a request per keystroke. So this is
// deliberately not live type-ahead - it waits until typing stops, wants
// enough letters to be a real query, and leans on the cache that is already
// there. The request count is what this suite mostly guards, because it is
// the part that is easy to get wrong and invisible when you do.
import { chromium } from 'playwright';
import { goTo, openEventForm, openWhereSheet } from './lib/screens.mjs';
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

// Four places that really do share a name, so choosing between them is the
// point rather than a nicety.
let lookups = [];
let slowNext = false;
await page.route(/photon\.komoot\.io/, async (route) => {
  const url = decodeURIComponent(route.request().url());
  lookups.push(url);
  if (/Bakewell/i.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: [
      { geometry: { coordinates: [-1.6753, 53.2129] },
        properties: { name: 'Bakewell', state: 'Derbyshire', country: 'England', osm_value: 'town' } },
    ] }) });
  }
  // The abandoned query answers late, so it would arrive after the one that
  // replaced it if nothing stopped it.
  if (slowNext) await new Promise((r) => setTimeout(r, 900));
  const feat = (name, state, country, lon, lat) => ({
    geometry: { coordinates: [lon, lat] },
    properties: { name, state, country, osm_value: 'town' },
  });
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: [
    feat('Newport', 'Isle of Wight', 'England', -1.2924, 50.7014),
    feat('Newport', 'Newport', 'Wales', -2.9977, 51.5842),
    feat('Newport', 'Pembrokeshire', 'Wales', -4.8354, 52.0182),
    feat('Newport-on-Tay', 'Fife', 'Scotland', -2.9375, 56.4390),
  ] }) });
});
await page.route(/wikidata|wikipedia|overpass|googleapis|tile\.|generativelanguage|nominatim/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }],
  }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true },
  ]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
await goTo(page, 'events', 400);
// The place field lives on the Where sheet now - where and how far are one
// question, so they are asked together rather than sprinkled over a form.
await openWhereSheet(page);

const countOf = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const txt = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));

const typeInto = async (sel, text) => {
  await page.evaluate((s) => { const el = document.querySelector(s); if (el) { el.value = ''; el.focus(); } }, sel);
  // Character by character, the way a person types, so a per-keystroke
  // request would show up in the count.
  for (const ch of text) {
    await page.type(sel, ch, { delay: 40 });
  }
};

// ---------- Too short to be a question ----------
lookups = [];
await typeInto('#evWhereInput', 'Ba');
await page.waitForTimeout(1200);
check('two letters does not go and ask', lookups.length === 0, JSON.stringify(lookups).slice(0, 120));
check('and nothing is suggested for it', await countOf('[data-suggest]') === 0);

// ---------- Typing a real name ----------
lookups = [];
await typeInto('#evWhereInput', 'Newport');
await page.waitForTimeout(1400);

check('typing a place name suggests places', await countOf('[data-suggest]') >= 3,
  `${await countOf('[data-suggest]')} suggestions`);
check('and it asked once, not once per letter', lookups.length === 1, `${lookups.length} requests`);
// The suggestions are drawn in the sheet, which is where to read them.
check('the suggestions tell the four Newports apart',
  /isle of wight|pembrokeshire|fife/i.test(await page.evaluate(() => document.getElementById('placeModal').textContent)),
  await page.evaluate(() => document.getElementById('placeModal').textContent.slice(0, 300)));

// ---------- Choosing one ----------
// Tolerant: run against the unfixed code there is nothing to click, and the
// checks below should say so rather than the suite throwing and printing
// nothing at all.
await page.evaluate(() => {
  const opts = [...document.querySelectorAll('[data-suggest]')];
  const fife = opts.find((o) => /fife/i.test(o.textContent)) || opts[0];
  if (fife) fife.click();
});
await page.waitForTimeout(400);
check('choosing one sets it as the place to look around', /newport-on-tay|newport/i.test(await txt()),
  (await txt()).slice(0, 200));
check('and the list of suggestions goes away', await countOf('[data-suggest]') === 0);
check('the sheet stays open, as it does for every other choice on it',
  await countOf('#placeModal [data-ev-miles]') >= 3);

// ---------- Changing your mind mid-word ----------
// Type "Newport", think better of it, type "Bakewell". The first answer is
// made deliberately slow so it would arrive last if nothing prevented it.
// What is asserted is the outcome a person sees - the list matches the words
// in the box - rather than which of the several guards produced it.
slowNext = true;
await typeInto('#evWhereInput', 'Newport');
await page.waitForTimeout(400);
slowNext = false;
await typeInto('#evWhereInput', 'Bakewell');
await page.waitForTimeout(1600);
const shown = await page.evaluate(() =>
  [...document.querySelectorAll('[data-suggest]')].map((b) => b.textContent).join(' '));
check('the suggestions match what is in the box, not what used to be',
  /bakewell/i.test(shown) && !/isle of wight|pembrokeshire/i.test(shown), shown.slice(0, 160));

// ---------- The same field in the shared sheet ----------
await goTo(page, 'picks', 400);
await page.evaluate(() => { const t = document.getElementById('pickSearchTrigger'); if (t) t.click(); });
await page.waitForTimeout(400);
const opened = await page.evaluate(() => {
  const b = document.querySelector('[data-anchor-open]');
  if (b) { b.click(); return true; }
  return false;
});
if (opened) {
  await page.waitForTimeout(400);
  lookups = [];
  await typeInto('#anchorInput', 'Newport');
  await page.waitForTimeout(1400);
  check('the sheet offers suggestions too', await page.evaluate(() =>
    document.querySelectorAll('[data-suggest]').length >= 3),
    await page.evaluate(() => document.querySelectorAll('[data-suggest]').length));
} else {
  check('the anchor sheet can be opened to check it too', false, 'no [data-anchor-open]');
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
