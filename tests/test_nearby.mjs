// "Chelsea in London is definitely not 10 miles from Stirling."
//
// The radius check ran inside `if (geo)`. So a suggestion the geocoder could
// place was measured and dropped if it was too far - but a suggestion it
// could NOT place fell straight past the check and was listed anyway, with no
// coordinates, under a heading promising results within N miles of you.
//
// That is the whole bug: the app never claimed the thing was 10 miles away,
// it just put it in a list that said so. An answer you cannot locate is not a
// weaker answer to "what is near me", it is not an answer.
import { chromium } from 'playwright';
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
await page.addInitScript(() => {
  try { localStorage.setItem('onboarded-v1', '1'); } catch (e) { /* nothing to do */ }
});

// Four suggestions: one genuinely nearby, one the geocoder cannot place at
// all, one that places hundreds of miles away, and one more nearby - the
// exact mix that produced a Chelsea in a Stirling search.
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([
      { name: 'The Birds and Bees', area: 'Stirling', why: 'Round the corner.' },
      { name: 'The Chelsea Kitchen', area: 'Chelsea, London', why: 'The model got lost.' },
      { name: 'Somewhere Nobody Can Find', area: 'Stirling', why: 'No map has this.' },
      { name: 'Darnley Coffee House', area: 'Stirling', why: 'Also nearby.' },
    ]) }] } }] }) });
});

await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const q = decodeURIComponent(route.request().url());
  // Stirling is 56.116, -3.936. Chelsea is 51.487, -0.169 - about 350 miles.
  if (/Birds/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
      lat: '56.1180', lon: '-3.9330', display_name: 'The Birds and Bees, Stirling', type: 'pub',
      namedetails: { name: 'The Birds and Bees' }, address: { town: 'Stirling' }, extratags: {} }]) });
  }
  if (/Darnley/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
      lat: '56.1200', lon: '-3.9370', display_name: 'Darnley Coffee House, Stirling', type: 'cafe',
      namedetails: { name: 'Darnley Coffee House' }, address: { town: 'Stirling' }, extratags: {} }]) });
  }
  if (/Chelsea/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
      lat: '51.4875', lon: '-0.1687', display_name: 'The Chelsea Kitchen, London', type: 'restaurant',
      namedetails: { name: 'The Chelsea Kitchen' }, address: { city: 'London' }, extratags: {} }]) });
  }
  // Everything else: found nothing. This is the case that used to slip past.
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await page.route(/wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis|upload\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-n', boards: [{ id: 'b-n', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-n:folders', JSON.stringify(['Stirling']));
  localStorage.setItem('board:b-n:picks', JSON.stringify([
    { id: 'p1', name: 'Stirling Castle', city: 'Stirling', category: 'Castle',
      lat: 56.1237, lon: -3.9474, addedAt: 1, photoChecked: true }]));
  localStorage.setItem('board:b-n:plan', JSON.stringify({ days: [], items: {} }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

// Search around Stirling Castle, ten miles out.
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await page.evaluate(() => document.querySelector('[data-explore-from]').click());
await page.waitForSelector('#exploreCatBtn', { timeout: 5000 });
await page.evaluate(() => document.getElementById('exploreCatBtn').click());
await page.waitForSelector('[data-choose-cat]', { timeout: 4000 });
await page.evaluate(() => document.querySelector('[data-choose-cat="cafe"]').click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const btn = document.getElementById('exploreSearchBtn') ||
    Array.from(document.querySelectorAll('button')).find((b) => /^\s*(🔍\s*)?Search/i.test(b.textContent));
  if (btn) btn.click();
});
await page.waitForTimeout(9000);

const shown = await page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));

// The report, in the user's own words.
check('a place in London is not offered as being near Stirling',
  !/Chelsea/.test(shown), shown.slice(0, 400));
// And the case that actually caused it: no coordinates at all.
check('nor is one that could not be found on a map anywhere',
  !/Nobody Can Find/.test(shown), shown.slice(0, 400));
check('what genuinely is nearby still comes back',
  /Birds and Bees/.test(shown) && /Darnley/.test(shown), shown.slice(0, 400));

// Every result on a "near here" screen has to be placeable, or the distance
// beside it is a guess dressed as a fact.
check('and every one of them shows how far away it is',
  (shown.match(/(mi|yd) away|🚗/g) || []).length >= 2, shown.slice(0, 400));

// A shorter list should explain itself rather than look like a thin answer.
check('the ones left out are accounted for',
  /Left out/.test(shown) && /couldn't be found on the map/.test(shown), shown.slice(0, 500));
check('including the one that was simply too far', /too far away/.test(shown), shown.slice(0, 500));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
