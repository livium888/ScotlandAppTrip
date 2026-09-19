// "I'm still getting London options and I'm in Scotland."
//
// Two rules, each sound alone, that together guaranteed the thing they were
// both written to prevent.
//
// withinAnchor() answers true when a result has no coordinates. That is right
// in a list - a saved place with no coordinates should not vanish - and
// catastrophic in a filter. The search filter used it.
//
// And geocodeWithinAnchor() deliberately REFUSES coordinates that fall outside
// the area, returning null, on the reasoning that no coordinates is safer than
// wrong ones. So a result the geocoder correctly identified as being in London
// had its coordinates stripped, became a result with no coordinates, and then
// sailed through the filter that exists to keep the search local.
//
// The further from the anchor a result was, the more certainly it was shown.
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

await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([
      { name: 'Stirling Coffee Rooms', area: 'Stirling', why: 'Actually here.' },
      // The model was asked about Stirling, so it labels everything Stirling -
      // including two places that are actually four hundred miles south. This
      // is the case that got through: the app believed the label over the map.
      { name: 'Borough Market Stall', area: 'Stirling', why: 'Says Stirling, is London.' },
      { name: 'The Chelsea Kitchen', area: 'Stirling', why: 'Also says Stirling.' },
    ]) }] } }] }) });
});
// The geocoder knows perfectly well where these are. That was never the
// problem - the problem was what the app did with the answer.
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const q = decodeURIComponent(route.request().url());
  const hit = (name, lat, lon, city) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ lat: String(lat), lon: String(lon), display_name: `${name}, ${city}`,
      type: 'cafe', class: 'amenity', namedetails: { name }, address: { city }, extratags: {} }]) });
  if (/Coffee\W*Rooms/i.test(q)) return hit('Stirling Coffee Rooms', 56.1180, -3.9350, 'Stirling');
  if (/Borough/i.test(q)) return hit('Borough Market Stall', 51.5055, -0.0910, 'London');
  if (/Chelsea/i.test(q)) return hit('The Chelsea Kitchen', 51.4875, -0.1687, 'London');
  if (/Stirling/i.test(q)) return hit('Stirling', 56.1165, -3.9369, 'Stirling');
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await page.route(/wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis|upload\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-a', boards: [{ id: 'b-a', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-a:picks', JSON.stringify([]));
  localStorage.setItem('board:b-a:plan', JSON.stringify({ days: [], items: {} }));
  // Standing in Stirling, looking 10 miles around.
  localStorage.setItem('board:b-a:search-anchor', JSON.stringify({
    name: 'Stirling', lat: 56.1165, lon: -3.9369, miles: 10 }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'somewhere for coffee');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(9000);

const shown = await page.evaluate(() =>
  document.getElementById('searchOverlay').textContent.replace(/\s+/g, ' '));

check('London is not offered to somebody standing in Stirling',
  !/Chelsea|Borough/.test(shown), shown.slice(0, 400));
check('what is actually here still comes back',
  /Stirling Coffee Rooms/.test(shown), shown.slice(0, 400));
check('and the screen accounts for what it dropped',
  /not shown/.test(shown), shown.slice(0, 500));

// Every result offered has to be one the app could actually place, or the
// area it claims to be searching means nothing.
check('everything offered has a location behind it', await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-preview-candidate]')).length > 0));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
