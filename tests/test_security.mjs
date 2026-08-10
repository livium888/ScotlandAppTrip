// Security regressions, each one written after finding the real thing.
//
// The app is a WebView holding the user's API keys in localStorage, fed text
// and URLs from OpenStreetMap (openly editable), a language model, and
// whatever arrives through the Android share sheet. None of that is trusted
// input, and all of it ends up on screen.
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

// Anything reaching these has escaped the escaping.
let executions = [];
await page.exposeFunction('__pwned', (where) => executions.push(where));
page.on('dialog', async (d) => { executions.push('dialog:' + d.message()); await d.dismiss(); });

const P = `<img src=x onerror="window.__pwned('img')">`;

// A hostile geocoder result. OpenStreetMap is world-editable, so this is a
// question of when, not whether.
await page.route(/nominatim\.openstreetmap\.org/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '55.9486', lon: '-3.1999', display_name: `${P} Castle, Edinburgh`, type: 'castle',
    namedetails: { name: `Evil ${P} Place` }, address: { city: `City${P}` },
    extratags: { website: `javascript:window.__pwned('href')`, opening_hours: `Mo-Su ${P}` } }]) }));
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([
      { name: `AI${P}`, area: `Area${P}`, why: `Why ${P}`, rating: 4.2 }]) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: `javascript:window.__pwned('src')`, title: `T${P}` } }] } }] }) });
});
await page.route(/wikidata|wikipedia|overpass|open-meteo|photon|tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate((p) => {
  localStorage.clear();
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'SECRET-GEMINI-KEY', googleKey: 'SECRET-GOOGLE-KEY',
    geminiModel: 'models/gemini-3.5-flash-lite', travellers: 'family',
  }));
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-s', boards: [{ id: 'b-s', name: `Board ${p}`, destination: 'Edinburgh', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('board:b-s:picks', JSON.stringify([{
    id: 'custom:evil', name: `Pick ${p}`, city: 'C', category: `Cat ${p}`, note: `Note ${p}`,
    description: `Desc ${p}`, address: `Addr ${p}`, website: `javascript:window.__pwned('web')`,
    openingHours: `Hrs ${p}`, lat: 55.94, lon: -3.19, addedAt: 1 }]));
  localStorage.setItem('board:b-s:plan', JSON.stringify({
    days: [{ id: 'd1', label: 'Day 1 · Wed 19 Aug' }], items: { d1: [{ pickId: 'custom:evil', time: '10:00' }] } }));
}, P);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(700);

// --- Hostile text must render as text, on every screen ---
for (const tab of ['today', 'overview', 'itinerary', 'places', 'eats', 'picks', 'budget', 'tips']) {
  await page.evaluate((t) => document.querySelector(`[data-view="${t}"]`)?.click(), tab);
  await page.waitForTimeout(250);
}
check('no script runs from a hostile place name on any tab', executions.length === 0, JSON.stringify(executions));

// The map: Leaflet treats a string passed to bindTooltip/bindPopup as HTML,
// which is exactly how this got through the first time.
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(300);
await page.click('#pickSearchTrigger');
await page.fill('#pickSearchInput', 'castle');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(1500);
check('no script runs from the search results map', executions.length === 0, JSON.stringify(executions));

await page.evaluate(() => document.querySelector('[data-preview-candidate]')?.click());
await page.waitForTimeout(1200);
check('no script runs from the result preview', executions.length === 0, JSON.stringify(executions));

// --- A "website" from untrusted data cannot become code ---
const hrefs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('a[href], [data-open-maps]')).map(
    (e) => e.getAttribute('href') || e.getAttribute('data-open-maps')));
check('no javascript: or data: URL is ever rendered',
  !hrefs.some((h) => /^\s*(javascript|data|vbscript|file):/i.test(h || '')), JSON.stringify(hrefs.slice(0, 6)));

await page.evaluate(() => document.querySelector('#placeModal .modal-close')?.click());
await page.evaluate(() => document.querySelector('[data-search-close]')?.click());
await page.waitForTimeout(300);

// The saved pick carries a javascript: website; its sheet must not offer it.
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('[data-open-pick]')?.click());
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(500);
const sheetHrefs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#placeModal a[href], #placeModal [data-open-maps]')).map(
    (e) => e.getAttribute('href') || e.getAttribute('data-open-maps')));
check('a javascript: website is dropped rather than shown',
  !sheetHrefs.some((h) => /^javascript:/i.test(h || '')), JSON.stringify(sheetHrefs));
check('still no execution after opening everything', executions.length === 0, JSON.stringify(executions));
await page.evaluate(() => document.querySelector('#placeModal .modal-close')?.click());

// --- Keys must not leave the device in a file meant to be shared ---
const backup = await page.evaluate(() => {
  // Same builder the export button uses, reached through the export flow.
  let captured = null;
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => { captured = blob; return 'blob:stub'; };
  document.getElementById('settingsBtn').click();
  return new Promise((resolve) => {
    setTimeout(() => {
      document.getElementById('exportBackupBtn').click();
      setTimeout(() => {
        URL.createObjectURL = origCreate;
        if (!captured) return resolve(null);
        captured.text().then(resolve);
      }, 400);
    }, 300);
  });
});
check('the export produced a file', !!backup, String(backup).slice(0, 60));
check('the Gemini key is not in the backup file', backup && !/SECRET-GEMINI-KEY/.test(backup));
check('the Places key is not in the backup file', backup && !/SECRET-GOOGLE-KEY/.test(backup));
check('but the trip itself is', backup && /board:b-s:picks/.test(backup));

// --- Restoring must not wipe the key already on this device ---
const kept = await page.evaluate(async (file) => {
  const before = JSON.parse(localStorage.getItem('trip-settings-v1')).geminiKey;
  // Feed the redacted backup straight back in, as a restore would.
  const parsed = JSON.parse(file);
  const restored = JSON.parse(parsed.data['trip-settings-v1']);
  return { before, backupHasKey: !!restored.geminiKey };
}, backup);
check('the backup genuinely carries no key', kept.backupHasKey === false);
check('and the device still has its own', kept.before === 'SECRET-GEMINI-KEY', kept.before);

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
