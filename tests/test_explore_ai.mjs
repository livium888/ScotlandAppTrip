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

// The panel's own search field is gone: there is one search, at the top of the
// screen, and its results carry "🧭 around here". This is that route.
const centreOn = async (query) => {
  await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
  await page.waitForTimeout(250);
  await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
  await page.waitForSelector('#pickSearchInput');
  await page.fill('#pickSearchInput', query);
  await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
  await page.waitForSelector('[data-around-candidate]', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('[data-around-candidate]').click());
  await page.waitForSelector('#exploreRunBtn', { timeout: 8000 });
  await page.waitForTimeout(300);
};

// Saving now always asks which folder, with the app's guess marked as a
// suggestion rather than applied silently. Accept the suggestion (or the first
// chip) so these tests exercise what they are actually about.
const chooseFolder = async () => {
  // The labelling sheet only appears when there is a real choice to make. When
  // one area obviously contains the place, it files itself and says so.
  const sheet = await page.waitForSelector('#placeModal.open [data-label-folder]', { timeout: 1500 }).catch(() => null);
  if (!sheet) {
    await page.waitForTimeout(500);
    return;
  }
  await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('#placeModal [data-label-folder]'));
    (chips.find((c) => c.classList.contains('active')) || chips[0]).click();
  });
  await page.evaluate(() => document.getElementById('labelDone').click());
  await page.waitForTimeout(500);
};

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
await centreOn('Edinburgh Castle');
await page.waitForTimeout(800);

// --- Gemini powers the category browse ---
const chooseCategory = async (key) => {
  await page.click('#exploreCatBtn');
  await page.waitForSelector(`[data-choose-cat="${key}"]`, { timeout: 3000 });
  await page.evaluate((k) => document.querySelector(`[data-choose-cat="${k}"]`).click(), key);
  // Choosing only sets the question now - Search is what asks it.
  await page.waitForSelector('#exploreRunBtn:not([disabled])', { timeout: 3000 });
  await page.click('#exploreRunBtn');
};
await chooseCategory('cafe');
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 20000 });
await page.waitForTimeout(300);

check('Gemini was asked for the category', /caf[eé]s/i.test(promptSeen), promptSeen.slice(0, 80));
check('traveller context included', /4-year-old/.test(promptSeen));
check('radius expressed in the prompt, in miles', /\b\d+ miles\b|\byards\b/.test(promptSeen), promptSeen.slice(0, 140));
check('Overpass not used while Gemini works', overpassCalls === 0, String(overpassCalls));

const text = await page.evaluate(() => document.getElementById('view').textContent);
check('AI suggestion listed', /Lovecrumbs/.test(text), text.slice(0, 300));
check('wrongly-placed suggestion filtered out', !/Wrong City Cafe/.test(text));
check('AI badge shown in Explore', await page.evaluate(() => !!document.querySelector('.explore-result .ai-badge')));
check('citation link shown', await page.evaluate(() =>
  !!Array.from(document.querySelectorAll('.explore-result a')).find((a) => a.href.includes('lovecrumbs'))));
check('distance computed from the centre, in miles', /\d+(\.\d+)?\s*(yd|mi) away/.test(text), text.slice(0, 300));

// --- Saving one keeps the AI description and OSM position ---
await page.evaluate(() => document.querySelector('[data-explore-add]').click());
await chooseFolder();
await page.waitForTimeout(900);
const picks = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks') || '[]'));
const saved = picks.find((p) => p.name === 'Lovecrumbs');
check('AI explore result can be saved', !!saved, JSON.stringify(picks.map((p) => p.name)));
check('saved with real coordinates', saved && saved.lat != null, saved && String(saved.lat));

// --- Overpass backs it up when Gemini fails ---
geminiFail = true;
overpassCalls = 0;
await chooseCategory('museum');
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 20000 });
await page.waitForTimeout(300);

check('Overpass used when Gemini fails', overpassCalls >= 1, String(overpassCalls));
const text2 = await page.evaluate(() => document.getElementById('view').textContent);
check('fallback results shown', /OSM Fallback Cafe/.test(text2), text2.slice(0, 300));
check('the fallback is announced, not silent', /Fell back to OpenStreetMap/.test(text2), text2.slice(0, 300));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
