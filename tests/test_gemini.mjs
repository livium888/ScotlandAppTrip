import { chromium } from 'playwright';

// Use the sandbox's prebuilt browser when present, otherwise let Playwright
// resolve its own download (which is what CI has).
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
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

const listText = await page.evaluate(() => document.getElementById('view').textContent);
check('AI result shown', listText.includes('Hidden Gem Cafe'), listText.slice(0, 250));
check('AI badge shown', await page.evaluate(() => !!document.querySelector('.ai-badge')));
check('citation link shown', await page.evaluate(() =>
  !!Array.from(document.querySelectorAll('a')).find((a) => a.href.includes('example.com/cafe'))));

// add it
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
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

await page.evaluate(() => document.getElementById('autoPlanBtn').click());
await page.waitForTimeout(1200);

const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':plan')));
const all = Object.values(plan.items).flat();
check('real pick was scheduled', all.length === 1, JSON.stringify(plan.items));
check('hallucinated place was NOT scheduled', all.every((it) => it.pickId === picks[0].id), JSON.stringify(all));
check('time captured from plan', all[0] && all[0].time === '10:00', JSON.stringify(all[0]));

const planText = await page.evaluate(() => document.getElementById('view').textContent);
check('plan note shown to user', /edit anything/i.test(planText), planText.slice(0, 200));

// --- No gemini key => no gemini calls ---
geminiCalls = [];
await page.evaluate(() => {
  const t = JSON.parse(localStorage.getItem('trip-settings-v1'));
  t.geminiKey = '';
  localStorage.setItem('trip-settings-v1', JSON.stringify(t));
});
osmEmpty = true;
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'anything');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(700);
check('no gemini key => no gemini call', geminiCalls.length === 0, JSON.stringify(geminiCalls.length));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
