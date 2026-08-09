// Gemini is now the primary search with OSM as backup, and the model is
// chosen from what the key actually exposes rather than hardcoded - which is
// how a valid key looked broken the first time.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const MODELS = [
  { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
  // Deprecated, and listed before the current one - the old picker took this.
  { name: 'models/gemini-2.0-flash-lite-001', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-flash-lite-preview', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
];
const DEAD_MODEL = 'models/gemini-2.0-flash-lite-001';

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

let generateUrls = [];
let osmCalls = 0;
let geminiShouldFail = false;

await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: MODELS }) });
  }
  generateUrls.push(url);
  if (url.includes('gemini-2.0-flash-lite-001')) {
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({
      error: { code: 404, message: 'This model models/gemini-2.0-flash-lite-001 is no longer available.' } }) });
  }
  if (geminiShouldFail) {
    return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({
      error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded.' } }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([
      { name: 'The Tiny Chippy', area: 'Leith', why: 'Small, quick, good for kids.' },
    ]) }] } }],
  }) });
});
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  osmCalls++;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '55.97', lon: '-3.17', display_name: 'Result from OSM, Edinburgh', type: 'restaurant',
    namedetails: { name: 'Result from OSM' }, address: { city: 'Edinburgh' }, extratags: {},
  }]) });
});
await page.route(/wikidata|wikipedia|overpass/, (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ search: [] }) }));

await page.goto(BASE, { waitUntil: 'load' });

// --- Detect models and pick one ---
await page.click('#settingsBtn');
await page.waitForSelector('#setGeminiKey');

// Discoverability: the picker must be on screen before detection, explaining
// how to fill it, rather than not existing until a button is pressed.
const before = await page.evaluate(() => {
  const wrap = document.getElementById('geminiModelWrap');
  const sel = document.getElementById('setGeminiModel');
  return { hidden: wrap.hidden, disabled: sel.disabled, text: sel.textContent.trim() };
});
check('picker is visible before detection', before.hidden === false, JSON.stringify(before));
check('picker explains how to populate it', /Test key & find models/.test(before.text), before.text);
check('picker disabled until populated', before.disabled === true, JSON.stringify(before));

await page.fill('#setGeminiKey', 'KEY');
await page.click('#testGeminiBtn');
await page.waitForTimeout(900);

const shown = await page.evaluate(() => {
  const wrap = document.getElementById('geminiModelWrap');
  const sel = document.getElementById('setGeminiModel');
  return { hidden: wrap.hidden, disabled: sel.disabled, options: Array.from(sel.options).map((o) => o.value) };
});
check('model picker enabled after detection', shown.hidden === false && shown.disabled === false, JSON.stringify(shown));
check('lists the generateContent models', shown.options.includes('models/gemini-3.5-flash-lite') &&
  shown.options.includes('models/gemini-3.5-pro'), JSON.stringify(shown.options));
check('excludes embedding-only models', !shown.options.some((o) => /embedding/.test(o)), JSON.stringify(shown.options));

const auto = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-settings-v1')).geminiModel);
check('auto-pick chooses the newest lite tier', auto === 'models/gemini-3.5-flash-lite', auto);
check('auto-pick avoids the deprecated dated build', auto !== DEAD_MODEL, auto);
check('auto-pick avoids preview builds', !/preview/.test(auto || ''), auto);

// The reported bug: choose a model, test it, and the choice was overwritten
// by the app's own guess.
await page.evaluate(() => {
  const sel = document.getElementById('setGeminiModel');
  sel.value = 'models/gemini-2.5-flash';
  sel.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(250);
await page.click('#testGeminiBtn');
await page.waitForTimeout(900);
const afterTest = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-settings-v1')).geminiModel);
check('testing does NOT overwrite a chosen model', afterTest === 'models/gemini-2.5-flash', afterTest);
const msg = await page.evaluate(() => document.getElementById('geminiTestResult').textContent);
check('test says which model it used and that it was yours', /gemini-2\.5-flash/.test(msg) && /your choice/i.test(msg), msg.slice(0, 160));

// A 404 must not silently revert a deliberate choice.
await page.evaluate(() => {
  const sel = document.getElementById('setGeminiModel');
  sel.value = 'models/gemini-2.0-flash-lite-001';
  sel.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(250);
await page.click('#testGeminiBtn');
await page.waitForTimeout(900);
const after404 = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-settings-v1')).geminiModel);
check('a 404 does not wipe the chosen model', after404 === DEAD_MODEL, after404);
const msg404 = await page.evaluate(() => document.getElementById('geminiTestResult').textContent);
check('404 tells you to pick another model', /no longer available/.test(msg404) && /Pick a different model/.test(msg404), msg404.slice(0, 200));

// Saving with the picker populated keeps the real name, not placeholder text.
await page.evaluate(() => {
  const sel = document.getElementById('setGeminiModel');
  sel.value = 'models/gemini-3.5-flash-lite';
  sel.dispatchEvent(new Event('change'));
});
await page.click('#saveSettings');
await page.waitForTimeout(300);
const afterSave = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-settings-v1')).geminiModel);
check('Save keeps the chosen model', afterSave === 'models/gemini-3.5-flash-lite', afterSave);
await page.click('#settingsBtn');
await page.waitForSelector('#setGeminiModel');

// Choosing a different model takes effect without pressing Save.
await page.evaluate(() => {
  const sel = document.getElementById('setGeminiModel');
  sel.value = 'models/gemini-3.5-pro';
  sel.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(300);
check('picker selection persists immediately', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('trip-settings-v1')).geminiModel === 'models/gemini-3.5-pro'));

// Put it back to lite and confirm requests use it.
await page.evaluate(() => {
  const sel = document.getElementById('setGeminiModel');
  sel.value = 'models/gemini-3.5-flash-lite';
  sel.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(200);
await page.click('#saveSettings');
await page.waitForTimeout(300);

// --- Gemini is tried FIRST, before OSM ---
generateUrls = []; osmCalls = 0;
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'somewhere quick to eat with a toddler');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(1500);

check('Gemini was called for the search', generateUrls.length >= 1, String(generateUrls.length));
check('the chosen model was used', generateUrls.some((u) => /gemini-3\.5-flash-lite:generateContent/.test(u)),
  generateUrls[0] || 'none');
const text = await page.evaluate(() => document.getElementById('view').textContent);
check('Gemini result shown, not the OSM one', /The Tiny Chippy/.test(text) && !/Result from OSM/.test(text), text.slice(0, 200));

// --- OSM backs it up when Gemini fails ---
geminiShouldFail = true;
generateUrls = []; osmCalls = 0;
await page.fill('#pickSearchInput', 'anything at all');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(1500);

const text2 = await page.evaluate(() => document.getElementById('view').textContent);
check('falls back to OSM when Gemini fails', /Result from OSM/.test(text2), text2.slice(0, 200));
check('OSM actually queried', osmCalls >= 1, String(osmCalls));
check('the Gemini failure is still reported', /429|Quota|Rate limit/i.test(text2), text2.slice(0, 300));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
