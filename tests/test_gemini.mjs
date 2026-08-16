import { chromium } from 'playwright';

// Use the sandbox's prebuilt browser when present, otherwise let Playwright
// resolve its own download (which is what CI has).
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

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

// The app now meets a first-time user with three questions before anything
// else. This suite is about a trip already under way, so it answers the door
// on the way in - re-applied on every navigation, since these tests clear
// storage and reload.
await page.addInitScript(() => {
  try { localStorage.setItem('onboarded-v1', '1'); } catch (e) { /* nothing to do */ }
});
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

let geminiCalls = [];
let osmEmpty = true;

await page.route(/generativelanguage\.googleapis\.com/, async (route) => {
  // Model discovery (GET /models) now precedes generateContent.
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const body = JSON.parse(route.request().postData() || '{}');
  const prompt = body.contents[0].parts[0].text;
  geminiCalls.push({ prompt, grounded: !!body.tools });

  if (/Arrange these saved places/.test(prompt)) {
    // Includes a hallucinated place that is NOT in the user's picks -
    // it must be dropped, not scheduled.
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify([
        { day: 1, name: 'Hidden Gem Cafe', time: '10:00' },
        { day: 2, name: 'A Place That Does Not Exist', time: '14:00' },
      ]) + '\n```' }] } }],
    }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{
      content: { parts: [{ text: JSON.stringify([{ name: 'Hidden Gem Cafe', area: 'Old Town', why: 'Quiet with space for a pushchair.' }]) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/cafe', title: 'Cafe review' } }] },
    }],
  }) });
});

await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  if (osmEmpty) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '55.95', lon: '-3.19', display_name: 'Hidden Gem Cafe, Old Town, Edinburgh', type: 'cafe',
    namedetails: { name: 'Hidden Gem Cafe' }, address: { city: 'Edinburgh', road: 'Old Town' },
    extratags: { website: 'https://gem.example' },
  }]) });
});
await page.route(/wikidata\.org|wikipedia\.org/, (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ search: [] }) }));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(200);

// configure gemini key
await page.click('#settingsBtn');
await page.waitForSelector('#setGeminiKey');
await page.fill('#setGeminiKey', 'GEM-KEY');
await page.fill('#setTravellers', 'family of 3, 4-year-old who walks');
await page.click('#saveSettings');
await page.waitForTimeout(200);
const s = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-settings-v1')));
check('gemini key + travellers saved', s.geminiKey === 'GEM-KEY' && /4-year-old/.test(s.travellers), JSON.stringify(s));

// --- Search: OSM empty -> Gemini fallback, geocode resolves via OSM ---
osmEmpty = true;
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
// Open the search screen if we aren't already on it - a second search from
// the results doesn't mean going back to Picks first.
if (!(await page.evaluate(() => document.getElementById('searchOverlay').classList.contains('open')))) {
  await page.waitForSelector('#pickSearchTrigger');
  await page.click('#pickSearchTrigger');
}
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'quiet cafe near the castle for a toddler');
// first nominatim call (search) returns empty; geocode afterwards should resolve
await page.evaluate(() => { window.__osmPhase = 1; });
osmEmpty = true;
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(400);
osmEmpty = false; // geocode of the suggested name now resolves
await page.waitForTimeout(1200);

const searchCall = geminiCalls.find((c) => /Find up to 5 real/.test(c.prompt));
check('gemini used for search when OSM empty', !!searchCall, JSON.stringify(geminiCalls.map(c=>c.prompt.slice(0,40))));
check('search call used Google Search grounding', searchCall && searchCall.grounded === true);
check('traveller context sent to gemini', searchCall && /4-year-old/.test(searchCall.prompt));

// Search results live on their own screen now.
const listText = await page.evaluate(() => document.getElementById('searchOverlay').textContent);
check('AI result shown', listText.includes('Hidden Gem Cafe'), listText.slice(0, 250));
check('AI badge shown', await page.evaluate(() => !!document.querySelector('.ai-badge')));
check('citation link shown', await page.evaluate(() =>
  !!Array.from(document.querySelectorAll('a')).find((a) => a.href.includes('example.com/cafe'))));

// add it
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
await chooseFolder();
// Adding now saves immediately - no folder question to answer.
await page.waitForTimeout(900);
const picks = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks') || '[]'));
check('AI-found place saved with real OSM coords', picks.length === 1 && picks[0].lat != null, JSON.stringify(picks[0] || {}).slice(0, 200));

// --- Auto plan ---
await page.evaluate(() => document.querySelector('[data-view="itinerary"]').click());
await page.waitForTimeout(150);
await page.evaluate(() => document.querySelector('[data-plan-mode="mine"]').click());
await page.waitForTimeout(200);
check('Plan my days button present', await page.evaluate(() => !!document.getElementById('autoPlanBtn')));

// The button now opens the chooser: what to plan is a question, and the answer
// is reviewed before anything is written.
await page.evaluate(() => document.getElementById('autoPlanBtn').click());
await page.waitForSelector('#planOverlay.open', { timeout: 4000 });
await page.evaluate(() => document.querySelector('[data-plan-run]').click());
await page.waitForSelector('.planner-day', { timeout: 8000 });

const beforeApply = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':plan') || '{"days":[],"items":{}}'));
check('nothing is scheduled until the plan is accepted',
  Object.values(beforeApply.items || {}).flat().length === 0, JSON.stringify(beforeApply.items));

await page.evaluate(() => document.querySelector('[data-plan-apply]').click());
await page.waitForTimeout(1200);

const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':plan')));
const all = Object.values(plan.items).flat();
check('real pick was scheduled', all.length === 1, JSON.stringify(plan.items));
check('hallucinated place was NOT scheduled', all.every((it) => it.pickId === picks[0].id), JSON.stringify(all));
check('time captured from plan', all[0] && all[0].time === '10:00', JSON.stringify(all[0]));

// --- No gemini key => no gemini calls ---
geminiCalls = [];
await page.evaluate(() => {
  const t = JSON.parse(localStorage.getItem('trip-settings-v1'));
  t.geminiKey = '';
  localStorage.setItem('trip-settings-v1', JSON.stringify(t));
});
osmEmpty = true;
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
// Open the search screen if we aren't already on it - a second search from
// the results doesn't mean going back to Picks first.
if (!(await page.evaluate(() => document.getElementById('searchOverlay').classList.contains('open')))) {
  await page.waitForSelector('#pickSearchTrigger');
  await page.click('#pickSearchTrigger');
}
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'anything');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(700);
check('no gemini key => no gemini call', geminiCalls.length === 0, JSON.stringify(geminiCalls.length));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
