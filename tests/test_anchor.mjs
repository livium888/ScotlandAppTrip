// Search was returning places from anywhere on earth, and the reason was that
// no part of the chain ever carried a coordinate. Every backend got a string -
// "cafe, Scotland" - and did its best with it:
//
//   Nominatim   free text, no viewbox, no bounds
//   Google      textQuery only, no location restriction
//   Gemini      told "in Scotland", then each name geocoded by name alone
//
// and nothing afterwards checked that what came back was anywhere near where
// you meant. "Newport" is a town in Wales, one in Fife, and about thirty more.
//
// So every search is now anchored to a real place with real coordinates and a
// radius; the anchor goes to each backend in the form that backend can
// enforce; and anything still arriving from the wrong end of the country is
// dropped and counted rather than listed.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 820 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

const PITLOCHRY = { lat: 56.7028, lon: -3.7317 };

let aiPrompts = [];
let aiResults = () => [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  let prompt = '';
  try { prompt = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text; } catch (e) { /* not a prompt */ }
  aiPrompts.push(prompt);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(aiResults(prompt)) }] } }] }) });
});

// The geocoder as it really behaves: the same name exists in several places,
// and which one you get depends entirely on how you asked.
//   - unbounded "The Bakehouse" -> Cornwall, 500 miles away, because it is the
//     better-known one
//   - bounded to the viewbox    -> the local one
//   - with the postcode         -> the local one, no ambiguity at all
const FAR = { lat: 50.1200, lon: -5.5370, name: 'The Bakehouse', town: 'Sennen' };
const NEAR = { lat: 56.7040, lon: -3.7290, name: 'The Bakehouse', town: 'Pitlochry' };
let geoCalls = [];
const row = (p) => ({
  lat: String(p.lat), lon: String(p.lon), display_name: `${p.name}, ${p.town}`, type: 'bakery', class: 'shop',
  namedetails: { name: p.name }, address: { town: p.town }, extratags: {},
});

await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const url = decodeURIComponent(route.request().url());
  const q = (/[?&]q=([^&]*)/.exec(url) || [])[1] || '';
  const bounded = /bounded=1/.test(url);
  geoCalls.push({ q, bounded, viewbox: (/viewbox=([^&]*)/.exec(url) || [])[1] || '' });

  if (/PH16/i.test(q)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { ...row(NEAR), display_name: 'PH16, Pitlochry', type: 'postcode', class: 'place', namedetails: { name: 'PH16' } }]) });
  if (/^Pitlochry/i.test(q)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { lat: String(PITLOCHRY.lat), lon: String(PITLOCHRY.lon), display_name: 'Pitlochry, Perth and Kinross', type: 'town',
      class: 'place', namedetails: { name: 'Pitlochry' }, address: { town: 'Pitlochry' }, extratags: {} }]) });

  if (/Bakehouse/i.test(q)) {
    // The whole bug in one line: unbounded and without a postcode, the famous
    // one wins.
    if (bounded || /PH16/i.test(q)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row(NEAR)]) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row(FAR), row(NEAR)]) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await page.route(/wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis/, (r) => r.abort());

const readAnchor = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-a:search-anchor') || 'null'));
const names = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.search-result .place-name')).map((e) => e.textContent.trim()));
const anchorBar = () => page.evaluate(() =>
  (document.querySelector('.search-anchor-text') || {}).textContent || '');

async function seed(picks) {
  await page.evaluate((seeded) => {
    localStorage.clear();
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b-a', boards: [{ id: 'b-a', name: 'Anchor', destination: 'Scotland', dated: false, hasGuide: false, createdAt: 1 }],
    }));
    localStorage.setItem('trip-settings-v1', JSON.stringify({
      destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
      travellers: 'family of 3',
    }));
    localStorage.setItem('board:b-a:folders', JSON.stringify(['Pitlochry']));
    localStorage.setItem('board:b-a:picks', JSON.stringify(seeded));
  }, picks);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(300);
}

const search = async (text) => {
  await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
  await page.waitForSelector('#pickSearchInput');
  await page.fill('#pickSearchInput', text);
  await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
  await page.waitForTimeout(2500);
};

await page.goto(BASE, { waitUntil: 'load' });
await seed([{ id: 'custom:Pitlochry', name: 'Pitlochry', city: 'Pitlochry', major: true, category: 'Town',
  lat: PITLOCHRY.lat, lon: PITLOCHRY.lon, addedAt: 1 }]);
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchTrigger');

// ---------- The area being searched is on screen before anything is typed ----------

await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
await page.waitForSelector('#pickSearchInput');
check('the search screen says where it is looking', /Pitlochry/.test(await anchorBar()), await anchorBar());
check('and how far out', /25 miles/.test(await anchorBar()), await anchorBar());
check('with a way to change it', await page.evaluate(() => !!document.querySelector('[data-anchor-open]')));

// ---------- A name that exists in two places, five hundred miles apart ----------

aiResults = () => [{ name: 'The Bakehouse', area: 'Pitlochry', postcode: '', why: 'Bread worth stopping for.' }];
geoCalls = [];
aiPrompts = [];
await page.fill('#pickSearchInput', 'bakery');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(2500);

check('the model is told the radius, not just the country',
  aiPrompts.some((p) => /within 25 miles of Pitlochry/.test(p)), (aiPrompts[0] || '').slice(0, 220));
check('and told to leave out anywhere further, rather than pad the list',
  aiPrompts.some((p) => /Do not include somewhere further away/.test(p)));
check('and asked for a postcode it can be pinned by',
  aiPrompts.some((p) => /"postcode"/.test(p)));

check('the lookup is bounded to a box, not just seasoned with a region name',
  geoCalls.some((c) => c.bounded && c.viewbox), JSON.stringify(geoCalls.slice(0, 3)));

const found = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('board:b-a:picks') || '[]'));
const shown = await names();
check('the local one is what you get', shown.some((n) => /Bakehouse/.test(n)), JSON.stringify(shown));
const pin = await page.evaluate(() => {
  const el = document.querySelector('.search-result-area, .search-result');
  return el ? el.textContent : '';
});
check('and it is the near one, not the famous one 500 miles away', await page.evaluate(() =>
  !/Sennen/.test(document.getElementById('searchOverlay').textContent)),
  await page.evaluate(() => document.getElementById('searchOverlay').textContent.slice(0, 200)));

// ---------- A postcode in the query is the clearest thing anyone can type ----------

geoCalls = [];
aiPrompts = [];
await page.fill('#pickSearchInput', 'PH16');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(2500);
check('a postcode typed as the query becomes the area searched',
  geoCalls.some((c) => /PH16/i.test(c.q)), JSON.stringify(geoCalls.slice(0, 3)));
check('and the screen says so', /PH16/.test(await anchorBar()), await anchorBar());

// A postcode the model returns is used ahead of the town name, because a name
// and a postcode has exactly one answer where a name and a town has thirty.
aiResults = () => [{ name: 'The Bakehouse', area: 'Newport', postcode: 'PH16 5AN', why: 'The right one.' }];
geoCalls = [];
await page.fill('#pickSearchInput', 'bread');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(2500);
check('a postcode from the model is used to pin the place',
  geoCalls.some((c) => /Bakehouse,\s*PH16/i.test(c.q)), JSON.stringify(geoCalls.slice(0, 4)));

// ---------- Whatever still arrives from the wrong end of the country ----------

aiResults = () => [
  { name: 'The Bakehouse', area: 'Pitlochry', postcode: '', why: 'Near.' },
  { name: 'Far Bakery', area: 'Sennen', postcode: '', why: 'Nowhere near.' },
];
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(route.request().url()) || [])[1] || '');
  if (/Far Bakery/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { ...row(FAR), namedetails: { name: 'Far Bakery' }, display_name: 'Far Bakery, Sennen' }]) });
  }
  if (/Bakehouse/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row(NEAR)]) });
  }
  if (/^Pitlochry/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { lat: String(PITLOCHRY.lat), lon: String(PITLOCHRY.lon), display_name: 'Pitlochry', type: 'town', class: 'place',
        namedetails: { name: 'Pitlochry' }, address: { town: 'Pitlochry' }, extratags: {} }]) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});

await page.evaluate(() => document.querySelector('[data-search-close]').click());
await page.waitForTimeout(300);
await search('bakery');

const kept = await names();
check('a result 500 miles out is not listed', !kept.some((n) => /Far Bakery/.test(n)), JSON.stringify(kept));
check('the near one still is', kept.some((n) => /Bakehouse/.test(n)), JSON.stringify(kept));
check('and it says what was left out rather than quietly showing less', await page.evaluate(() =>
  /too far from/.test(document.getElementById('searchOverlay').textContent)),
  await page.evaluate(() => document.getElementById('searchOverlay').textContent.slice(0, 300)));
check('with one tap to look further out', await page.evaluate(() =>
  !!document.querySelector('[data-anchor-wider]')));

await page.evaluate(() => document.querySelector('[data-anchor-wider]').click());
await page.waitForTimeout(2500);
const widened = await readAnchor();
check('which widens the area rather than opening a settings screen',
  widened && widened.miles === 50, JSON.stringify(widened));
check('and the screen agrees', /50 miles/.test(await anchorBar()), await anchorBar());

// A town you have typed the name of is not a thing being found near you - it
// is the thing you asked for. Filtering those away would leave an empty screen
// with a footnote for anyone planning somewhere they are not yet.
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(route.request().url()) || [])[1] || '');
  if (/Newport/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { lat: '51.5842', lon: '-2.9977', display_name: 'Newport, Wales', type: 'town', class: 'place',
        namedetails: { name: 'Newport' }, address: { town: 'Newport' }, extratags: {} }]) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
aiResults = () => [];
await page.fill('#pickSearchInput', 'Newport');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(2500);
check('a town you name is still found, however far away it is',
  (await names()).some((n) => /Newport/.test(n)), JSON.stringify(await names()));

// ---------- Changing it by hand ----------

await page.evaluate(() => document.querySelector('[data-anchor-open]').click());
await page.waitForSelector('#anchorForm', { timeout: 4000 });
check('the sheet offers the areas you have saved', await page.evaluate(() =>
  !!document.querySelector('[data-anchor-pick]')));
check('and takes a town or a postcode', await page.evaluate(() =>
  !!document.getElementById('anchorInput') &&
  /postcode/i.test(document.getElementById('placeModal').textContent)),
  await page.evaluate(() => document.getElementById('anchorInput').placeholder));

await page.evaluate(() => document.getElementById('anchorAnywhere').click());
await page.waitForTimeout(2000);
check('"anywhere" really does remove the limit', (await readAnchor()) === 'anywhere',
  JSON.stringify(await readAnchor()));
check('and says so plainly', /anywhere/i.test(await anchorBar()), await anchorBar());

// ---------- A board with nothing saved yet ----------

await seed([]);
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchTrigger');
await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
await page.waitForSelector('#pickSearchInput');
check('with nothing saved there is nothing to anchor to, and it says that',
  /anywhere/i.test(await anchorBar()), await anchorBar());

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
