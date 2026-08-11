// Searching for a town never found the town.
//
// Every backend answers with businesses. The AI is asked for places that are
// "real, currently-open" and "still trading", which a town is not, and Google
// Places answers with establishments. So "Pitlochry" came back as five cafés
// in Pitlochry, and the one thing you had typed was the one thing you could
// not save. The "save as a town or area" button existed, but nothing that
// reached the results list could ever satisfy it.
//
// These drive it with an AI key configured, because that is the case that was
// broken - without a key the OSM fallback happened to return the town.
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

const readPicks = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-c:picks') || '[]'));

// The AI answers the way it really does: with businesses, never the town.
let aiPrompts = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  aiPrompts.push(JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([
      { name: 'Hettie’s Tearoom', area: 'Pitlochry', why: 'Cakes, and room for a buggy.' },
      { name: 'Victoria’s Restaurant', area: 'Pitlochry', why: 'Long-standing high street place.' },
    ]) }] } }],
  }) });
});

await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const url = decodeURIComponent(route.request().url());
  const town = [{
    lat: '56.7028', lon: '-3.7317', display_name: 'Pitlochry, Perth and Kinross, Scotland', type: 'town',
    class: 'place', namedetails: { name: 'Pitlochry' }, address: { town: 'Pitlochry' }, extratags: {},
  }];
  const tearoom = [{
    lat: '56.7035', lon: '-3.7300', display_name: 'Hettie’s Tearoom, Pitlochry', type: 'cafe',
    class: 'amenity', namedetails: { name: 'Hettie’s Tearoom' }, address: { town: 'Pitlochry' }, extratags: {},
  }];
  const restaurant = [{
    lat: '56.7031', lon: '-3.7305', display_name: 'Victoria’s Restaurant, Pitlochry', type: 'restaurant',
    class: 'amenity', namedetails: { name: 'Victoria’s Restaurant' }, address: { town: 'Pitlochry' }, extratags: {},
  }];
  const body = /Hettie|Tearoom/i.test(url) ? tearoom : /Victoria/i.test(url) ? restaurant : town;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route(/wikidata|wikipedia|overpass|tile\.|open-meteo/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-c', boards: [{ id: 'b-c', name: 'Scotland', destination: 'Scotland', dated: false, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
    travellers: 'family of 3, 4-year-old who walks',
  }));
});
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchTrigger');

// ---------- The town is in the results ----------

await page.click('#pickSearchTrigger');
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'Pitlochry');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForSelector('[data-add-candidate]', { timeout: 8000 });
await page.waitForTimeout(1200);

const names = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.search-result .place-name')).map((e) => e.textContent.trim()));
check('the AI still answers with businesses', names.some((n) => /Hettie/.test(n)), JSON.stringify(names));
check('but the town you typed is in the results too', names.some((n) => /^Pitlochry/.test(n)), JSON.stringify(names));
check('and it is first, being what you asked for', /^Pitlochry/.test(names[0] || ''), JSON.stringify(names));
check('it is marked as a town rather than a place in one', await page.evaluate(() =>
  !!document.querySelector('.search-result .area-badge')));

// ---------- Saving it takes one tap and asks no folder question ----------

await page.evaluate(() => document.querySelector('.search-result-area [data-add-candidate]').click());
await page.waitForTimeout(1500);

const saved = await readPicks();
const town = saved.find((p) => p.name === 'Pitlochry');
check('the town saves', !!town, JSON.stringify(saved.map((p) => p.name)));
check('as an area, not as somewhere to visit', !!town && town.major === true, JSON.stringify(town));
check('under its own name', !!town && town.city === 'Pitlochry', JSON.stringify(town));
check('with no folder question to answer', await page.evaluate(() =>
  document.querySelectorAll('#placeModal [data-label-folder]').length === 0));
check('and the other reading is offered rather than assumed', await page.evaluate(() => {
  const el = document.getElementById('toast');
  return !!el && /Just a place/i.test(el.textContent);
}), await page.evaluate(() => (document.getElementById('toast') || {}).textContent || 'no toast'));

// ---------- Places found near it file under it ----------

await page.fill('#pickSearchInput', 'Hettie’s Tearoom');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[data-add-candidate]')).find((b) => !b.disabled);
  btn.click();
});
await page.waitForTimeout(1800);
// One area obviously contains it, so there is nothing to ask: it files itself
// and says where, with the way to change it on the toast.
check('a place inside the new area is not made into a question', await page.evaluate(() =>
  document.querySelectorAll('#placeModal [data-label-folder]').length === 0));
check('it says where it went', await page.evaluate(() => {
  const el = document.getElementById('toast');
  return !!el && /Saved to Pitlochry/.test(el.textContent);
}), await page.evaluate(() => (document.getElementById('toast') || {}).textContent || 'no toast'));
check('and offers to change it', await page.evaluate(() => {
  const el = document.getElementById('toast');
  return !!el && !!el.querySelector('.toast-action') && /Change/.test(el.textContent);
}));

const after = await readPicks();
const cafe = after.find((p) => /Hettie/.test(p.name));
check('so it lands under the town', !!cafe && cafe.city === 'Pitlochry', JSON.stringify(after.map((p) => `${p.name}:${p.city}`)));

await page.evaluate(() => document.querySelector('[data-search-close]').click());
await page.waitForTimeout(600);
check('and the town heads its own section', await page.evaluate(() =>
  !!document.querySelector('.area-head-name') &&
  /Pitlochry/.test(document.querySelector('.area-head-name').textContent)));

// ---------- Exploring around it is not limited to the category list ----------

await page.evaluate(() => document.getElementById('exploreToggle').click());
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-explore-from]').click());
await page.waitForTimeout(800);

check('a description can be typed straight into Explore', await page.evaluate(() =>
  !!document.getElementById('exploreDescribeForm')));
check('without opening the category list at all', await page.evaluate(() =>
  !document.getElementById('placeModal').classList.contains('open')));

aiPrompts = [];
await page.fill('#exploreDescribeInput', 'somewhere with a garden and space for a toddler');
await page.evaluate(() => document.getElementById('exploreDescribeForm').requestSubmit());
await page.waitForTimeout(600);
check('describing it does not search on its own', aiPrompts.length === 0, JSON.stringify(aiPrompts.length));
check('it becomes what Search will ask for', /garden and space for a toddler/.test(
  await page.evaluate(() => document.getElementById('exploreCatBtn').textContent)),
  await page.evaluate(() => document.getElementById('exploreCatBtn').textContent));

await page.click('#exploreRunBtn');
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 20000 });
check('and Search asks it, in the words you used', aiPrompts.some((p) => /garden and space for a toddler/.test(p)),
  JSON.stringify(aiPrompts).slice(0, 200));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
