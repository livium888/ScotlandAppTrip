// "The ask somewhere else option won't do anything, won't open anything."
//
// The sheet was built only after the map lookups for nearby towns and
// cinemas finished, and those go to public servers that can take half a
// minute or fail - so the tap looked dead. It now opens at once with a
// usable question, adds the names if they arrive, and the assistant buttons
// open their pages.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.addInitScript(() => { localStorage.setItem('onboarded-v1', '1'); });
await page.route(/wikidata|wikipedia|tile\.|photon|open-meteo|places\.googleapis|generativelanguage/, (r) => r.abort());
// The map servers never answer.
await page.route(/overpass/, () => {});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));
const opened = [];
await ctx.route(/chatgpt\.com|gemini\.google\.com/, (route) => { opened.push(route.request().url()); route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }); });

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-h', boards: [{ id: 'b-h', name: 'Trip', destination: 'Peak District', dated: true, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Peak District', geminiKey: '' }));
  localStorage.setItem('board:b-h:picks', JSON.stringify([]));
  localStorage.setItem('board:b-h:plan', JSON.stringify({ days: [], items: {} }));
  localStorage.setItem('board:b-h:search-anchor', JSON.stringify({ name: 'Bakewell', lat: 53.2129, lon: -1.6753, miles: 15 }));
  localStorage.removeItem('event-cache-v1');
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await goTo(page, 'events', 400);

await page.click('#evHandoff');
const t0 = Date.now();
await page.waitForSelector('#handoffPrompt', { timeout: 3000 }).catch(() => {});
check('tapping it opens the sheet at once, even while the map servers say nothing',
  await page.evaluate(() => !!document.getElementById('handoffPrompt')) && Date.now() - t0 < 3000, `${Date.now() - t0}ms`);
check('with a question already in it', await page.evaluate(() => document.getElementById('handoffPrompt').value.length > 200));
check('and says it is still looking up names', await page.evaluate(() => /Looking up/.test(document.getElementById('handoffLookup').textContent)));

await page.click('[data-assistant="chatgpt"]');
await page.waitForTimeout(800);
check('the ChatGPT button opens ChatGPT', opened.some((u) => /chatgpt\.com/.test(u)) ||
  ctx.pages().some((p) => /chatgpt\.com/.test(p.url())), JSON.stringify(opened));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
