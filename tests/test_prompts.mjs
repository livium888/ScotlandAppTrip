// Steering the AI yourself: standing preferences that apply to every search,
// and per-category rewording when a category asks the wrong question. The
// thing worth guarding is the split - your words must reach the model, and
// the JSON scaffolding must stay out of your hands so an edit can change the
// answer without breaking the search.
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

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();

// The app now meets a first-time user with three questions before anything
// else. This suite is about a trip already under way, so it answers the door
// on the way in - re-applied on every navigation, since these tests clear
// storage and reload.
await page.addInitScript(() => {
  try { localStorage.setItem('onboarded-v1', '1'); } catch (e) { /* nothing to do */ }
});
await page.setViewportSize({ width: 390, height: 820 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

let prompts = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  prompts.push(JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([
      { name: 'Green Bowl', area: 'Old Town', why: 'Fits.' },
    ]) }] } }],
  }) });
});
await page.route(/nominatim\.openstreetmap\.org/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '55.9486', lon: '-3.1999', display_name: 'Edinburgh Castle, Edinburgh', type: 'castle',
    namedetails: { name: 'Edinburgh Castle' }, address: { city: 'Edinburgh' }, extratags: {} }]) }));
await page.route(/wikidata|wikipedia|overpass|tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
    travellers: 'family of 3, 4-year-old who walks',
  }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(300);

// --- Settings: your standing instructions ---
await page.evaluate(() => document.getElementById('settingsBtn').click());
await page.waitForSelector('#setPreferences', { timeout: 3000 });
check('there is somewhere to say what you want', true);

const presets = await page.evaluate(() => Array.from(document.querySelectorAll('[data-pref-preset]')).map((b) => b.textContent.trim()));
check('suggestions offered rather than a blank page', presets.length >= 6, JSON.stringify(presets));

// Tapping a suggestion must add to what's typed, never replace it.
await page.fill('#setPreferences', 'we hate queues');
await page.evaluate(() => document.querySelector('[data-pref-preset]').click());
const afterPreset = await page.evaluate(() => document.getElementById('setPreferences').value);
check('a suggestion adds to what you typed', /we hate queues/.test(afterPreset) && afterPreset.split('\n').length === 2, JSON.stringify(afterPreset));
check('the suggestion shows as chosen', await page.evaluate(() => !!document.querySelector('[data-pref-preset].on')));

// Tapping it again takes it back out.
await page.evaluate(() => document.querySelector('[data-pref-preset]').click());
check('tapping again removes it', await page.evaluate(() =>
  document.getElementById('setPreferences').value.trim() === 'we hate queues'));

await page.fill('#setPreferences', 'no chains, nothing needing a car');
await page.evaluate(() => document.getElementById('saveSettings').click());
await page.waitForTimeout(400);
check('preferences are saved', await page.evaluate(() =>
  /no chains/.test(JSON.parse(localStorage.getItem('trip-settings-v1')).preferences)));

// --- They reach every kind of AI request ---
prompts = [];
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
// Open the search screen if we aren't already on it - a second search from
// the results doesn't mean going back to Picks first.
if (!(await page.evaluate(() => document.getElementById('searchOverlay').classList.contains('open')))) {
  await page.waitForSelector('#pickSearchTrigger');
  await page.click('#pickSearchTrigger');
}
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'lunch');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(1200);
check('a place search carries your preferences', prompts.some((p) => /no chains, nothing needing a car/.test(p)), (prompts[0] || '').slice(0, 200));
check('and still says who is travelling', prompts.some((p) => /4-year-old/.test(p)));

prompts = [];
// Back out of the search screen before using Explore behind it.
await page.evaluate(() => document.querySelector('[data-search-close]').click());
await page.waitForTimeout(300);
await page.click('#exploreToggle');
await centreOn('Edinburgh Castle');
await page.waitForTimeout(700);
await page.click('#exploreCatBtn');
await page.waitForSelector('[data-choose-cat="healthy"]');
await page.evaluate(() => document.querySelector('[data-choose-cat="healthy"]').click());
await page.waitForSelector('#exploreRunBtn:not([disabled])', { timeout: 3000 });
await page.click('#exploreRunBtn');
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 20000 });
check('Explore carries them too', prompts.some((p) => /no chains, nothing needing a car/.test(p)), (prompts[0] || '').slice(0, 200));

// The built-in "prefer independents" nudge steps aside once you've said what
// you want, rather than arguing with it.
check('the default nudge yields to your own words', !prompts.some((p) => /Prefer independent, well-regarded places over chains/.test(p)), (prompts[0] || '').slice(0, 300));

// --- Per-category rewording ---
check('a chosen category can be tuned', await page.evaluate(() => !!document.getElementById('exploreCatTune')));
await page.click('#exploreCatTune');
await page.waitForSelector('#catPromptBox', { timeout: 3000 });
const shown = await page.evaluate(() => document.getElementById('catPromptBox').value);
check('it opens on the current question', /salad|grain bowls/i.test(shown), shown.slice(0, 120));
check('the JSON rules are not exposed for editing', !/JSON/i.test(shown), shown.slice(0, 200));

prompts = [];
await page.fill('#catPromptBox', 'poke bowls and salad bars only');
await page.evaluate(() => document.getElementById('catPromptSave').click());
await page.waitForSelector('#exploreRunBtn:not([disabled])', { timeout: 3000 });
await page.click('#exploreRunBtn');
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 20000 });
check('the reworded question is what gets asked', prompts.some((p) => /poke bowls and salad bars only/.test(p)), (prompts[0] || '').slice(0, 200));
check('the old wording is gone', !prompts.some((p) => /grain bowls/.test(p)));
check('the formatting rules are still added by the app', prompts.every((p) => /ONLY a JSON array/.test(p)));
check('and the radius still is too', prompts.some((p) => /\b\d+ miles\b/.test(p)), (prompts[0] || '').slice(0, 200));

check('the rewrite is stored', await page.evaluate(() =>
  /poke bowls/.test(JSON.parse(localStorage.getItem('trip-settings-v1')).catPrompts.healthy)));

// An edited category is marked, so your own changes aren't invisible.
await page.click('#exploreCatBtn');
await page.waitForSelector('[data-choose-cat="healthy"]');
check('an edited category is marked in the list', await page.evaluate(() =>
  !!document.querySelector('[data-choose-cat="healthy"] .cat-tuned')));
check('untouched categories are not', await page.evaluate(() =>
  !document.querySelector('[data-choose-cat="cafe"] .cat-tuned')));
await page.evaluate(() => document.querySelector('.modal-close').click());
await page.waitForTimeout(200);

// Reset puts the built-in wording back rather than leaving a stale copy.
prompts = [];
await page.click('#exploreCatTune');
await page.waitForSelector('#catPromptReset');
await page.evaluate(() => document.getElementById('catPromptReset').click());
await page.waitForSelector('#exploreRunBtn:not([disabled])', { timeout: 3000 });
await page.click('#exploreRunBtn');
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 20000 });
check('reset restores the default question', prompts.some((p) => /grain bowls/.test(p)), (prompts[0] || '').slice(0, 200));
check('and clears the stored rewrite', await page.evaluate(() =>
  !JSON.parse(localStorage.getItem('trip-settings-v1')).catPrompts.healthy));

// --- You can read the question that was actually asked ---
await page.waitForSelector('#exploreShowPrompt', { timeout: 3000 });
await page.click('#exploreShowPrompt');
await page.waitForTimeout(300);
const openText = await page.evaluate(() => document.getElementById('view').textContent);
check('the exact question can be read back', /ONLY a JSON array/.test(openText) && /no chains/.test(openText), openText.slice(0, 200));
await page.click('#exploreShowPrompt');
await page.waitForTimeout(300);
check('and hidden again', !/ONLY a JSON array/.test(await page.evaluate(() => document.getElementById('view').textContent)));

// --- Preferences survive a backup, like everything else ---
const backup = await page.evaluate(() => localStorage.getItem('trip-settings-v1'));
check('preferences are part of the settings that get backed up', /preferences/.test(backup), backup.slice(0, 200));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
