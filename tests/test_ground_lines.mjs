// Describe-a-place, Places nearby and the event backfill, with search on.
//
// On the Gemini 3 models, asking for JSON - even in the wording of the
// question - silently switches Google Search off, and the answer comes from
// memory. These three still asked for JSON with search on. They ask for plain
// lines now, and read them, which this checks end to end: the request carries
// the search tool, its text never says JSON, and what comes back as lines is
// shown.
import { chromium } from 'playwright';
import { openExplore } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
await page.addInitScript(() => { try { localStorage.setItem('onboarded-v1', '1'); } catch { /* nothing */ } });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

const asked = [];
let reply = () => '';
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models(\?|$)/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const body = JSON.parse(route.request().postData() || '{}');
  const prompt = body.contents[0].parts[0].text;
  asked.push({ prompt, searchTool: !!(body.tools && body.tools.length), jsonMode: !!(body.generationConfig && body.generationConfig.responseMimeType) });
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: reply(prompt) }] },
      groundingMetadata: { webSearchQueries: ['q'], groundingChunks: [{ web: { uri: 'https://example.com/r', title: 'review' } }] } }] }) });
});
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const url = decodeURIComponent(route.request().url());
  const hit = (name, lat, lon, type, road) => [{ lat: String(lat), lon: String(lon), display_name: `${name}, Edinburgh`, type,
    namedetails: { name }, address: { city: 'Edinburgh', road }, extratags: {} }];
  const body = /Lovecrumbs/.test(url) ? hit('Lovecrumbs', 55.9463, -3.2010, 'cafe', 'West Port')
    : /Bakehouse/.test(url) ? hit('The Bakehouse', 55.9470, -3.2000, 'bakery', 'High Street')
    : hit('Edinburgh Castle', 55.9486, -3.1999, 'castle');
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route(/overpass|wikidata|wikipedia|photon|tile\.|open-meteo|places\.googleapis/, (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [], search: [] }) }));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({ activeId: 'b', boards: [{ id: 'b', name: 'Trip', destination: 'Edinburgh', dated: true, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Edinburgh', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash', travellers: 'two adults' }));
  localStorage.setItem('board:b:folders', JSON.stringify(['Edinburgh']));
  localStorage.setItem('board:b:picks', JSON.stringify([
    // An event that is missing what a listing would state, for the backfill.
    { id: 'ev1', name: 'Toddler Rhyme Time', kind: 'event', city: 'Edinburgh', venue: 'Central Library', startsAt: Date.now() + 2 * 864e5, source: 'events', lat: 55.95, lon: -3.19 },
  ]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

// ---------- Places nearby ----------
reply = () => '- name: Lovecrumbs; area: West Port; rating: 4.6/5; reviews: about 800; price: ££; booking: no; why: Small cake shop, good for a short stop.';
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await openExplore(page);
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(250);
await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'Edinburgh Castle');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForSelector('[data-around-candidate]', { timeout: 10000 });
await page.evaluate(() => document.querySelector('[data-around-candidate]').click());
await page.waitForSelector('#exploreRunBtn', { timeout: 8000 });
asked.length = 0;
await page.click('#exploreCatBtn');
await page.waitForSelector('[data-choose-cat="cafe"]', { timeout: 3000 });
await page.evaluate(() => document.querySelector('[data-choose-cat="cafe"]').click());
await page.waitForSelector('#exploreRunBtn:not([disabled])', { timeout: 3000 });
await page.click('#exploreRunBtn');
await page.waitForFunction(() => /Lovecrumbs/.test(document.getElementById('view').textContent), { timeout: 20000 }).catch(() => {});
const nearby = asked.find((a) => /currently-open places matching/.test(a.prompt));
check('Places nearby asks with search on', !!nearby && nearby.searchTool, JSON.stringify(asked.map((a) => a.prompt.slice(0, 50))));
check('and never says JSON', !!nearby && !/json/i.test(nearby.prompt) && !nearby.jsonMode);
check('and asks for lines, with the rating only if confirmed', !!nearby && /one listing per line/.test(nearby.prompt) && /Do not invent a rating/.test(nearby.prompt));
check('what comes back as lines is shown', await page.evaluate(() => /Lovecrumbs/.test(document.getElementById('view').textContent)));

// ---------- Describe a place ----------
reply = () => '- name: The Bakehouse; area: Edinburgh; postcode: EH1 1AA; why: Fresh bread and a big window.';
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(300);
asked.length = 0;
await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'a bakery with a big window');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForFunction(() => /Bakehouse/.test(document.body.textContent), { timeout: 20000 }).catch(() => {});
const described = asked.find((a) => /real, currently-open places matching this request/.test(a.prompt));
check('describe-a-place asks with search on', !!described && described.searchTool);
check('and never says JSON', !!described && !/json/i.test(described.prompt) && !described.jsonMode);
check('and a place written as a line is shown', await page.evaluate(() => /Bakehouse/.test(document.body.textContent)));
await page.evaluate(() => { const c = document.querySelector('#placeModal .modal-close, .search-overlay .search-close'); if (c) c.click(); });

// ---------- Filling in saved events ----------
reply = () => '- n: 1; setting: indoor; ages: 0-3; for children: aimed; booking: none';
asked.length = 0;
const res = await page.evaluate(() => window.__tripTest.backfillEvents());
check('the backfill asks with search on, and never says JSON', asked.length >= 1 && asked[0].searchTool && !/json/i.test(asked[0].prompt) && !asked[0].jsonMode, JSON.stringify(asked.map((a) => [a.searchTool, a.jsonMode])));
check('it reports success', res && res.ok === true, JSON.stringify(res));
const filled = await page.evaluate(() => JSON.parse(localStorage.getItem('board:b:picks')).find((p) => p.id === 'ev1'));
check('and a line is read into the saved event', filled.setting === 'indoor' && filled.minAge === 0 && filled.maxAge === 3 && filled.childFocus === 'aimed', JSON.stringify(filled));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
