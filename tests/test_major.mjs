// Two changes that go together, because both are about the app doing less on
// its own initiative.
//
// The first: Explore used to search the moment you touched any control -
// choosing a category, moving the centre, changing the radius - so a
// half-finished question was asked (and an AI call spent) on the way to the
// one you meant. Now nothing searches until Search is pressed.
//
// The second: a town saved among the cafés was always the wrong shape. A town
// can now be promoted to an area, which heads its own section and collects
// what you save near it.
import { chromium } from 'playwright';
import { openExplore, openPickSearch } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

// One search now, at the top of the screen; its results carry "🧭 around here".
const centreOn = async (query) => {
  await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
  await page.waitForTimeout(250);
  await openPickSearch(page);
  await page.waitForSelector('#pickSearchInput');
  await page.fill('#pickSearchInput', query);
  await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
  await page.waitForSelector('[data-around-candidate]', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('[data-around-candidate]').click());
  await page.waitForSelector('#exploreRunBtn', { timeout: 8000 });
  await page.waitForTimeout(300);
};

// Picks live under the active board's key ("board:<id>:picks"); the legacy
// single-trip key is only ever read once, at migration.
const readPicks = () => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => /:picks$/.test(k));
  return JSON.parse((key && localStorage.getItem(key)) || '[]');
});

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();

// The app now meets a first-time user with three questions before anything
// else. This suite is about a trip already under way, so it answers the door
// on the way in - re-applied on every navigation, since these tests clear
// storage and reload.
await page.addInitScript(() => {
  try { localStorage.setItem('onboarded-v1', '1'); } catch (e) { /* nothing to do */ }
});
await page.setViewportSize({ width: 390, height: 800 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

// Every outbound request is counted, so "did it search?" is answered by what
// went over the wire rather than by what the screen happens to say.
let aiCalls = 0;
let overpassCalls = 0;

// Pitlochry deliberately: it is NOT one of the three bundled city anchors, and
// it is far enough from all of them that nearestCity() returns nothing. So
// anything filed under it was filed there by the major-place logic and by
// nothing else - which is the whole point of the feature.
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  aiCalls++;
  const prompt = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  // The model answers the question it was actually asked, so a search for a
  // town comes back as the town rather than as a café in it.
  const named = /Request:\s*(.+)/.exec(prompt);
  const asked = named ? named[1].trim() : '';
  const item = /^Pitlochry$/i.test(asked)
    ? { name: 'Pitlochry', area: 'Perthshire', why: 'Victorian tourist town on the Tummel.' }
    : /Distillery/i.test(asked)
    ? { name: 'Blair Athol Distillery', area: 'Pitlochry', why: 'Tours with a shop at the end.' }
    : { name: 'Hettie\u2019s Tearoom', area: 'Pitlochry', why: 'Cakes, and room for a buggy.' };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([item]) }] } }],
  }) });
});

await page.route(/overpass/, (route) => {
  overpassCalls++;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [] }) });
});

await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const url = decodeURIComponent(route.request().url());
  const town = [{
    lat: '56.7028', lon: '-3.7317', display_name: 'Pitlochry, Perth and Kinross, Scotland', type: 'town',
    class: 'place', namedetails: { name: 'Pitlochry' }, address: { town: 'Pitlochry' }, extratags: {},
  }];
  const distillery = [{
    lat: '56.6960', lon: '-3.7280', display_name: 'Blair Athol Distillery, Pitlochry', type: 'distillery',
    class: 'man_made', namedetails: { name: 'Blair Athol Distillery' }, address: { town: 'Pitlochry' }, extratags: {},
  }];
  const tearoom = [{
    lat: '56.7035', lon: '-3.7300', display_name: 'Hettie\u2019s Tearoom, Pitlochry', type: 'cafe',
    class: 'amenity', namedetails: { name: 'Hettie\u2019s Tearoom' }, address: { town: 'Pitlochry' }, extratags: {},
  }];
  const body = /Distillery/i.test(url) ? distillery : /Tearoom|Hettie/i.test(url) ? tearoom : town;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route(/wikidata|wikipedia|tile\.|open-meteo/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
    travellers: 'family of 3, 4-year-old who walks',
  }));
});
await page.reload({ waitUntil: 'load' });

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await openExplore(page);
await page.waitForTimeout(300);

// ---------- Nothing runs until Search is pressed ----------

check('no Search button before there is anywhere to search around', await page.evaluate(() =>
  !document.getElementById('exploreRunBtn')));

await centreOn('Pitlochry');
// The place search itself is an AI call, so the count starts from here: what
// is being checked is that the Explore panel does not search on its own.
aiCalls = 0;
overpassCalls = 0;

check('setting the centre searches for nothing', aiCalls === 0 && overpassCalls === 0,
  `ai=${aiCalls} overpass=${overpassCalls}`);
check('a Search button appears once there is a centre', await page.evaluate(() =>
  !!document.getElementById('exploreRunBtn')));
check('it is disabled until there is something to look for', await page.evaluate(() =>
  document.getElementById('exploreRunBtn').disabled));
check('and it says what is missing', /Pick what you.re looking for/.test(
  await page.evaluate(() => document.getElementById('view').textContent)));

await page.click('#exploreCatBtn');
await page.waitForSelector('[data-choose-cat="cafe"]', { timeout: 3000 });
await page.evaluate(() => document.querySelector('[data-choose-cat="cafe"]').click());
await page.waitForTimeout(700);

check('choosing a category still searches for nothing', aiCalls === 0 && overpassCalls === 0,
  `ai=${aiCalls} overpass=${overpassCalls}`);
check('now Search can be pressed', await page.evaluate(() =>
  !document.getElementById('exploreRunBtn').disabled));

// The radius is the control that used to be worst: every step of the range
// fired its own search on the way to the distance you wanted.
await page.selectOption('#exploreRadius', { label: '5 miles' });
await page.waitForTimeout(400);
await page.selectOption('#exploreRadius', { label: '10 miles' });
await page.waitForTimeout(400);
check('changing the radius twice searches for nothing', aiCalls === 0 && overpassCalls === 0,
  `ai=${aiCalls} overpass=${overpassCalls}`);

await page.click('#exploreRunBtn');
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 20000 });
await page.waitForTimeout(300);

check('pressing Search searches, once', aiCalls === 1, `ai=${aiCalls}`);
check('and the results arrive', /Hettie’s Tearoom/.test(
  await page.evaluate(() => document.getElementById('view').textContent)));
check('the button now offers to search again', /Search again/.test(
  await page.evaluate(() => document.getElementById('exploreRunBtn').textContent)));

// Results already on screen are still the answer to the question that was
// asked - they stay, but they are labelled as no longer matching the controls.
await page.selectOption('#exploreRadius', { label: '25 miles' });
await page.waitForTimeout(400);
check('changing criteria after a search still searches for nothing', aiCalls === 1, `ai=${aiCalls}`);
check('the old results are marked as out of date', /Criteria changed/.test(
  await page.evaluate(() => document.getElementById('view').textContent)));
check('but they are still on screen', /Hettie’s Tearoom/.test(
  await page.evaluate(() => document.getElementById('view').textContent)));

// ---------- A town is offered as an area, not filed as one ----------

await openPickSearch(page);
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'Pitlochry');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(1200);

await page.evaluate(() => document.querySelector('[data-preview-candidate]').click());
await page.waitForTimeout(1200);

check('a town offers to be saved as an area', await page.evaluate(() =>
  !!document.getElementById('previewAddMajor')));
check('saving it as an ordinary place is still the first option', await page.evaluate(() =>
  !!document.getElementById('previewAdd')));

await page.evaluate(() => document.getElementById('previewAddMajor').click());
await page.waitForTimeout(1500);
check('saving something as an area asks no folder question', await page.evaluate(() =>
  document.querySelectorAll('#placeModal [data-pick-folder]').length === 0));
await page.evaluate(() => document.querySelector('[data-search-close]').click());
await page.waitForTimeout(600);

const savedTown = (await readPicks()).find((p) => p.name === 'Pitlochry');
check('the town is saved as a major place', !!(savedTown && savedTown.major), JSON.stringify(savedTown));

check('it heads its own section rather than sitting in the list', await page.evaluate(() =>
  !!document.querySelector('.area-head') &&
  /Pitlochry/.test(document.querySelector('.area-head-name').textContent)));
check('it is not also a row underneath itself', await page.evaluate(() =>
  Array.from(document.querySelectorAll('.pick-row-name')).every((n) => n.textContent.trim() !== 'Pitlochry')));
check('the area offers what is nearby without searching for it', await page.evaluate(() =>
  !!document.querySelector('.area-head-explore')));

// ---------- Places saved near an area are filed under it ----------

await openPickSearch(page);
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'Blair Athol Distillery');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
// The folder is asked for now, and the area is the suggestion - so accepting
// the suggested chip is what files it under Pitlochry.
await page.waitForTimeout(1800);
// Inside an area with no rival, so it files itself rather than asking.
check('a place inside the area is filed without a question', await page.evaluate(() =>
  document.querySelectorAll('#placeModal [data-label-folder]').length === 0));
check('and the toast says which area', await page.evaluate(() => {
  const el = document.getElementById('toast');
  return !!el && /Pitlochry/.test(el.textContent);
}), await page.evaluate(() => (document.getElementById('toast') || {}).textContent || 'no toast'));
await page.evaluate(() => document.querySelector('[data-search-close]') && document.querySelector('[data-search-close]').click());
await page.waitForTimeout(600);

const savedDistillery = (await readPicks()).find((p) => /Blair Athol Distillery/.test(p.name));
check('a place saved near the area is filed under it', !!(savedDistillery && savedDistillery.city === 'Pitlochry'),
  JSON.stringify(savedDistillery));

check('the area heading counts what is under it', /1 place saved here/.test(
  await page.evaluate(() => (document.querySelector('.area-head') || {}).textContent || '')),
  await page.evaluate(() => (document.querySelector('.area-head') || {}).textContent || ''));

// A town is not a thing to do in the town.
await page.waitForTimeout(300);
const placeRows = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.pick-row-name')).map((n) => n.textContent.trim()));
check('the town is not listed among the things to do', !placeRows.includes('Pitlochry'), JSON.stringify(placeRows));
check('but the distillery in it is', placeRows.includes('Blair Athol Distillery'), JSON.stringify(placeRows));

// ---------- Promotion and demotion by hand ----------

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('.area-head-main').click());
await page.waitForSelector('[data-pick-major]', { timeout: 3000 });

check('the detail sheet says what the place is', await page.evaluate(() =>
  document.querySelectorAll('[data-pick-major]').length === 2));
check('and shows it as an area', await page.evaluate(() =>
  document.querySelector('[data-pick-major$="|1"]').classList.contains('active')));
check('an area is not asked which tab it belongs in', await page.evaluate(() =>
  document.querySelectorAll('[data-pick-kind]').length === 0));

await page.evaluate(() => document.querySelector('[data-pick-major$="|0"]').click());
await page.waitForTimeout(700);

const afterDemote = await readPicks();
const demotedTown = afterDemote.find((p) => p.name === 'Pitlochry');
check('demoting puts it back in the list as an ordinary place', !!demotedTown && !demotedTown.major,
  JSON.stringify(demotedTown));
const keptDistillery = afterDemote.find((p) => /Blair Athol Distillery/.test(p.name));
check('and the places it collected stay where they were put', !!keptDistillery && keptDistillery.city === 'Pitlochry',
  JSON.stringify(keptDistillery));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
