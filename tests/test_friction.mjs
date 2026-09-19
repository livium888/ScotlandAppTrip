// Saving a place cost more than it should.
//
// Filing used to happen silently on a 40km guess over three hardcoded cities,
// which was often wrong. The fix was to ask - every time, including the great
// majority of saves where the answer was never in doubt. That is one bad habit
// traded for another: an interruption on every single add.
//
// The rule now is the one the geocoder already follows: act when there is one
// obvious answer, ask when there is a real choice. And when it does ask, it
// asks everything about the place at once, rather than spreading three
// questions across a modal, a toast and a detail sheet.
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

const readPicks = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-f:picks') || '[]'));

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
      { name: 'Moulin Inn', area: 'Pitlochry', why: 'Old inn up the hill.' },
    ]) }] } }],
  }) });
});
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const url = decodeURIComponent(route.request().url());
  const inn = [{
    lat: '56.7120', lon: '-3.7290', display_name: 'Moulin Inn, Pitlochry', type: 'pub', class: 'amenity',
    namedetails: { name: 'Moulin Inn' }, address: { town: 'Pitlochry' }, extratags: {},
  }];
  const town = [{
    lat: '56.7028', lon: '-3.7317', display_name: 'Pitlochry, Perth and Kinross, Scotland', type: 'town',
    class: 'place', namedetails: { name: 'Pitlochry' }, address: { town: 'Pitlochry' }, extratags: {},
  }];
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(/Moulin/i.test(url) ? inn : town) });
});
await page.route(/wikidata|wikipedia|overpass|tile\.|open-meteo|photon/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-f', boards: [{ id: 'b-f', name: 'Friction', destination: 'Scotland', dated: false, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
    travellers: 'family of 3, 4-year-old who walks',
  }));
  // One area, and the place saved below sits a mile inside it.
  localStorage.setItem('board:b-f:folders', JSON.stringify(['Pitlochry', 'Edinburgh']));
  localStorage.setItem('board:b-f:picks', JSON.stringify([
    { id: 'custom:Pitlochry', name: 'Pitlochry', city: 'Pitlochry', major: true, category: 'Town',
      lat: 56.7028, lon: -3.7317, addedAt: 1 },
  ]));
});
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchTrigger');

// ---------- The search bar is a search bar ----------

check('the top bar is a real field, not a button dressed as one', await page.evaluate(() => {
  const el = document.getElementById('pickSearchTrigger');
  return !!el && el.tagName === 'INPUT';
}));
await page.click('#pickSearchTrigger');
await page.waitForSelector('#pickSearchInput');
check('and one tap puts the cursor in it', await page.evaluate(() =>
  document.activeElement && document.activeElement.id === 'pickSearchInput'));

// ---------- One obvious answer is not a question ----------

await page.fill('#pickSearchInput', 'Moulin Inn');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForSelector('[data-add-candidate]', { timeout: 8000 });
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
// Saving geocodes before it writes, so how long it takes depends on the
// machine. 1600ms was generous on a quiet box and short on a runner with
// three suites sharing two cores - the same blind-sleep flake that took
// test_explore_ai down. Wait for the thing being asserted instead: the pick
// in storage, and the toast that reports where it went.
await page.waitForFunction(() => {
  const id = JSON.parse(localStorage.getItem('boards-v1') || '{}').activeId;
  if (!id) return false;
  const picks = JSON.parse(localStorage.getItem('board:' + id + ':picks') || '[]');
  return Array.isArray(picks) && picks.some((p) => /Moulin/.test(p.name || ''));
}, { timeout: 20000 }).catch(() => {});
await page.waitForFunction(
  () => /Saved to/.test((document.getElementById('toast') || {}).textContent || ''),
  { timeout: 20000 }
).catch(() => {});

check('a place plainly inside one area asks nothing', await page.evaluate(() =>
  document.querySelectorAll('#placeModal [data-label-folder]').length === 0));
const saved = (await readPicks()).find((p) => /Moulin/.test(p.name));
check('it is saved', !!saved, JSON.stringify((await readPicks()).map((p) => p.name)));
check('and filed under that area', !!saved && saved.city === 'Pitlochry', JSON.stringify(saved));
check('the toast says where it went', await page.evaluate(() =>
  /Saved to Pitlochry/.test((document.getElementById('toast') || {}).textContent || '')),
  await page.evaluate(() => (document.getElementById('toast') || {}).textContent || 'no toast'));

// ---------- ...but changing it is right there ----------

check('and offers to change it', await page.evaluate(() => {
  const el = document.getElementById('toast');
  return !!el && !!el.querySelector('.toast-action') && /Change/.test(el.textContent);
}));
await page.evaluate(() => document.querySelector('.toast-action').click());
await page.waitForSelector('#placeModal.open [data-label-folder]', { timeout: 4000 });

// ---------- Everything about the place, in one sheet ----------

const sheet = await page.evaluate(() => ({
  what: document.querySelectorAll('[data-label-major]').length,
  kind: document.querySelectorAll('[data-label-kind]').length,
  folders: document.querySelectorAll('[data-label-folder]').length,
  newFolder: !!document.getElementById('labelNewFolder'),
}));
check('what it is, is asked here', sheet.what === 2, JSON.stringify(sheet));
check('which list it shows in, too', sheet.kind === 2, JSON.stringify(sheet));
check('and where it goes', sheet.folders >= 2, JSON.stringify(sheet));
check('with room for a folder that does not exist yet', sheet.newFolder);

// Marking it an area drops the two questions that no longer apply.
await page.evaluate(() => document.querySelector('[data-label-major="1"]').click());
await page.waitForTimeout(300);
check('an area is not asked which list it belongs in', await page.evaluate(() =>
  document.querySelectorAll('[data-label-kind]').length === 0));
await page.evaluate(() => document.querySelector('[data-label-major="0"]').click());
await page.waitForTimeout(300);

// Moving it somewhere else takes one tap and Done.
await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('[data-label-folder]'));
  (chips.find((c) => c.textContent.trim().startsWith('Edinburgh')) || chips[0]).click();
});
await page.evaluate(() => document.getElementById('labelDone').click());
await page.waitForTimeout(800);
const moved = (await readPicks()).find((p) => /Moulin/.test(p.name));
check('the change sticks', !!moved && moved.city === 'Edinburgh', JSON.stringify(moved));

// ---------- Telling the AI what the options do not cover ----------

await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'lunch');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForSelector('#refineForm', { timeout: 8000 });
check('the results screen takes your own words', await page.evaluate(() =>
  !!document.getElementById('refineInput')));

aiPrompts = [];
await page.fill('#refineInput', 'somewhere we can sit outside with a buggy');
await page.evaluate(() => document.getElementById('refineForm').requestSubmit());
await page.waitForTimeout(2000);
check('and passes them to the model as written', aiPrompts.some((p) => /sit outside with a buggy/.test(p)),
  JSON.stringify(aiPrompts).slice(0, 200));
check('alongside what you searched for', aiPrompts.some((p) => /lunch/.test(p)),
  JSON.stringify(aiPrompts).slice(0, 200));
check('and says it is still applying them', await page.evaluate(() =>
  /Also asking for/.test(document.getElementById('searchOverlay').textContent)));

aiPrompts = [];
await page.evaluate(() => document.getElementById('refineClear').click());
await page.waitForTimeout(1800);
check('dropping them searches again without them', aiPrompts.length > 0 && !aiPrompts.some((p) => /buggy/.test(p)),
  JSON.stringify(aiPrompts).slice(0, 200));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
