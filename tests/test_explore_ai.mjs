// Explore now uses Gemini for category browsing with Overpass as backup.
// The interesting cases are the guards: a model can name a real place in the
// wrong city, and a quiet drop to thinner data should be visible.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

let geminiFail = false;
let overpassCalls = 0;
let promptSeen = '';

await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  if (geminiFail) {
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
      error: { code: 503, message: 'Model overloaded.' } }) });
  }
  promptSeen = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{
      content: { parts: [{ text: JSON.stringify([
        { name: 'Lovecrumbs', area: 'West Port', why: 'Small cake shop, good for a short stop.' },
        { name: 'Wrong City Cafe', area: 'Elsewhere', why: 'Should be filtered out.' },
      ]) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/lovecrumbs', title: 'review' } }] },
    }],
  }) });
});

// Centre geocode + per-suggestion geocodes. "Wrong City Cafe" lands far away
// and must be discarded rather than shown as nearby.
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const url = decodeURIComponent(route.request().url());
  let body;
  if (/Wrong City Cafe/.test(url)) {
    body = [{ lat: '51.5074', lon: '-0.1278', display_name: 'Wrong City Cafe, London', type: 'cafe',
      namedetails: { name: 'Wrong City Cafe' }, address: { city: 'London' }, extratags: {} }];
  } else if (/Lovecrumbs/.test(url)) {
    body = [{ lat: '55.9463', lon: '-3.2010', display_name: 'Lovecrumbs, West Port, Edinburgh', type: 'cafe',
      namedetails: { name: 'Lovecrumbs' }, address: { city: 'Edinburgh', road: 'West Port' },
      extratags: { opening_hours: 'Tu-Su 10:00-18:00' } }];
  } else {
    body = [{ lat: '55.9486', lon: '-3.1999', display_name: 'Edinburgh Castle, Edinburgh', type: 'castle',
      namedetails: { name: 'Edinburgh Castle' }, address: { city: 'Edinburgh' }, extratags: {} }];
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.route(/overpass/, (route) => {
  overpassCalls++;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [
    { type: 'node', lat: 55.9490, lon: -3.1990, tags: { name: 'OSM Fallback Cafe' } },
  ] }) });
});
await page.route(/wikidata|wikipedia/, (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ search: [] }) }));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
    travellers: 'family of 3, 4-year-old who walks',
  }));
});
await page.reload({ waitUntil: 'load' });

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#exploreToggle');
await page.click('#exploreToggle');
await page.waitForSelector('#exploreSearchForm');
await page.fill('#exploreSearchInput', 'Edinburgh Castle');
await page.evaluate(() => document.getElementById('exploreSearchForm').requestSubmit());
await page.waitForTimeout(800);

// --- Gemini powers the category browse ---
await page.evaluate(() => document.querySelector('[data-explore-cat="cafe"]').click());
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 20000 });
await page.waitForTimeout(300);

check('Gemini was asked for the category', /cafes/i.test(promptSeen), promptSeen.slice(0, 80));
check('traveller context included', /4-year-old/.test(promptSeen));
check('radius expressed in the prompt', /1\.5 km|1500 m/.test(promptSeen), promptSeen.slice(0, 140));
check('Overpass not used while Gemini works', overpassCalls === 0, String(overpassCalls));

const text = await page.evaluate(() => document.getElementById('view').textContent);
check('AI suggestion listed', /Lovecrumbs/.test(text), text.slice(0, 300));
check('wrongly-placed suggestion filtered out', !/Wrong City Cafe/.test(text));
check('AI badge shown in Explore', await page.evaluate(() => !!document.querySelector('.explore-result .ai-badge')));
check('citation link shown', await page.evaluate(() =>
  !!Array.from(document.querySelectorAll('.explore-result a')).find((a) => a.href.includes('lovecrumbs'))));
check('distance computed from the centre', /\d+\s*(m|km) away/.test(text), text.slice(0, 300));

// --- Saving one keeps the AI description and OSM position ---
await page.evaluate(() => document.querySelector('[data-explore-add]').click());
await page.waitForTimeout(900);
const picks = await page.evaluate(() => JSON.parse(localStorage.getItem('scotland-trip-picks-v1') || '[]'));
const saved = picks.find((p) => p.name === 'Lovecrumbs');
check('AI explore result can be saved', !!saved, JSON.stringify(picks.map((p) => p.name)));
check('saved with real coordinates', saved && saved.lat != null, saved && String(saved.lat));

// --- Overpass backs it up when Gemini fails ---
geminiFail = true;
overpassCalls = 0;
await page.evaluate(() => document.querySelector('[data-explore-cat="museum"]').click());
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 20000 });
await page.waitForTimeout(300);

check('Overpass used when Gemini fails', overpassCalls >= 1, String(overpassCalls));
const text2 = await page.evaluate(() => document.getElementById('view').textContent);
check('fallback results shown', /OSM Fallback Cafe/.test(text2), text2.slice(0, 300));
check('the fallback is announced, not silent', /Fell back to OpenStreetMap/.test(text2), text2.slice(0, 300));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
