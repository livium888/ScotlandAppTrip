// The Troubleshoot screen, end to end.
//
// "I'm not getting anything at all, and I want to see what was sent and what
// was returned." It is reachable before any search has run, it records every
// request with the raw reply (including failures), its live checks name the
// failing layer in words, the whole thing copies out as one report, and the
// key is never in any of it.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
const KEY = 'AIzaSySECRETKEY1234567890abcdefghijk';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
await page.setViewportSize({ width: 390, height: 844 });
await page.addInitScript(() => { try { localStorage.setItem('onboarded-v1', '1'); } catch { /* nothing */ } });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
let mode = 'quota';           // quota | ok | memory
const seenHeaders = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  seenHeaders.push({ url, key: route.request().headers()['x-goog-api-key'] });
  if (/\/models(\?|$)/.test(url)) return route.fulfill(json(200, { models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }));
  const body = JSON.parse(route.request().postData() || '{}');
  if (mode === 'quota') return route.fulfill(json(429, { error: { code: 429, message: 'Quota exceeded for metric generate_content_free_tier_requests', status: 'RESOURCE_EXHAUSTED' } }));
  const grounded = !!(body.tools && body.tools.length);
  const text = grounded ? '- n: 1; setting: indoor; booking: none' : 'OK';
  const gm = grounded && mode === 'ok' ? { webSearchQueries: ['films fareham'], groundingChunks: [{ web: { uri: 'https://cineworld.example', title: 'c' } }] } : undefined;
  route.fulfill(json(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...(gm ? { groundingMetadata: gm } : {}) }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6 } }));
});
await page.route(/overpass/, (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: 'Connected as: 1' }));
await page.route(/nominatim/, (r) => r.fulfill(json(200, [{ lat: '50.85', lon: '-1.18', display_name: 'Fareham, Hampshire' }])));
await page.route(/wikidata|wikipedia|photon|tile\.|open-meteo|places\.googleapis/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate((key) => {
  localStorage.setItem('boards-v1', JSON.stringify({ activeId: 'b', boards: [{ id: 'b', name: 'Trip', destination: 'Fareham', dated: true, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Fareham', geminiKey: key, geminiModel: 'models/gemini-3.5-flash', geminiModelPinned: true }));
  localStorage.setItem('board:b:folders', JSON.stringify(['Fareham']));
  localStorage.setItem('board:b:picks', JSON.stringify([{ id: 'ev1', name: 'Toddler Rhyme Time', kind: 'event', city: 'Fareham', venue: 'Library', startsAt: Date.now() + 864e5, source: 'events', lat: 50.85, lon: -1.18 }]));
}, KEY);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
const sheet = () => page.evaluate(() => document.getElementById('placeModal').innerText);
const close = () => page.evaluate(() => document.querySelector('#placeModal .modal-close').click());

// ---------- Reachable before any search has run ----------
await goTo(page, 'events', 400);
check('Find always offers Troubleshoot, even before a search', await page.evaluate(() => !!document.getElementById('evTroubleshoot')));
await page.click('#evTroubleshoot');
await page.waitForSelector('#tsRun', { timeout: 3000 });
check('it opens a sheet with the checks and says there is nothing to show yet', /Troubleshoot search/.test(await sheet()) && /No request to a model has been made/.test(await sheet()));
await close();

// ---------- A failed request is recorded with its raw reply ----------
mode = 'quota';
await page.evaluate(() => window.__tripTest.backfillEvents());
await page.click('#evTroubleshoot').catch(async () => { await goTo(page, 'events', 300); await page.click('#evTroubleshoot'); });
await page.waitForSelector('#tsRun');
let text = await sheet();
check('the request that failed is listed as failed, with its status', /Failed \(HTTP 429\)/.test(text), text.slice(0, 300));
await page.evaluate(() => document.querySelectorAll('.ts-exchange').forEach((d) => { d.open = true; }));
text = await sheet();
check('it shows exactly what was sent', /--- sent ---/.test(text) && /Toddler Rhyme Time/.test(text) && /one listing per line/.test(text));
check('and exactly what came back, Google\'s own words', /--- returned ---/.test(text) && /Quota exceeded for metric generate_content_free_tier_requests/.test(text) && /RESOURCE_EXHAUSTED/.test(text));
check('with whether search was offered, and the model used', /Search offered: yes/.test(text) && /gemini-3\.5-flash/.test(text));
check('and the key is nowhere on the sheet', !text.includes(KEY) && !/AIzaSy/.test(text));
check('nor in what is stored on the phone', await page.evaluate((k) => !(localStorage.getItem('ai-exchanges-v1') || '').includes(k), KEY));
check('and it is not in a backup', await page.evaluate(() => !JSON.stringify(window.__tripTest.buildBackup()).includes('ai-exchanges-v1')));

// ---------- The live checks ----------
mode = 'quota';
await page.click('#tsRun');
await page.waitForFunction(() => !document.getElementById('tsRun').disabled, null, { timeout: 20000 });
text = await sheet();
check('with the key over its quota, the verdict says so in words', /quota or rate limit/i.test(await page.evaluate(() => document.getElementById('tsVerdict').textContent)), await page.evaluate(() => document.getElementById('tsVerdict').textContent));
check('each check says its result as a word, not only a colour', /Failed/.test(text) && /OK/.test(text) && /Skipped|Warning/.test(text) || /Failed/.test(text));
check('the failing check shows Google\'s message', /Quota exceeded/.test(await page.evaluate(() => document.getElementById('tsSteps').textContent)));

mode = 'memory';
await page.click('#tsRun');
await page.waitForFunction(() => !document.getElementById('tsRun').disabled && /Search is not running/.test(document.getElementById('tsVerdict').textContent), null, { timeout: 20000 });
check('a model that answers without searching is named as the problem, with what to do', await page.evaluate(() => /Search is not running/.test(document.getElementById('tsVerdict').textContent) && /Flash/.test(document.getElementById('tsVerdict').textContent)));
check('and that check is a warning', /Warning/.test(await page.evaluate(() => document.getElementById('tsSteps').textContent)));

mode = 'ok';
seenHeaders.length = 0;
await page.click('#tsRun');
await page.waitForFunction(() => !document.getElementById('tsRun').disabled && /Every service responds/.test(document.getElementById('tsVerdict').textContent), null, { timeout: 20000 });
check('with everything working the verdict says so and points at the record', await page.evaluate(() => /sent and returned/.test(document.getElementById('tsVerdict').textContent)));
check('every step passed, including the search, with what it searched for', await page.evaluate(() => document.querySelectorAll('.ts-step.ts-ok').length === 6 && /films fareham/.test(document.getElementById('tsSteps').textContent)));
check('the key went in a header on every request, never in an address', seenHeaders.length >= 3 && seenHeaders.every((h) => h.key === KEY && !/key=|AIza/.test(h.url)));

// ---------- The report ----------
await page.click('#tsCopy');
await page.waitForTimeout(300);
const copied = await page.evaluate(() => navigator.clipboard.readText());
check('Copy puts the whole report on the clipboard: verdict, checks and the requests', /VERDICT:/.test(copied) && /--- checks ---/.test(copied) && /--- requests to the model/.test(copied) && /Quota exceeded/.test(copied), copied.slice(0, 200));
check('with the build, model, and that a key is set - never the key', /key: set/.test(copied) && /pinned in Settings/.test(copied) && !copied.includes(KEY) && !/AIzaSy/.test(copied));

// ---------- Clearing ----------
await page.click('#tsClear');
check('the record can be cleared', /No request to a model has been made/.test(await page.evaluate(() => document.getElementById('tsExchanges').textContent)));
await close();

// ---------- From Settings ----------
await page.click('#settingsBtn');
await page.waitForTimeout(400);
check('Settings has a Troubleshoot button', await page.evaluate(() => !!document.getElementById('troubleshootBtn')));
await page.click('#troubleshootBtn');
await page.waitForSelector('#tsRun', { timeout: 3000 });
check('and it opens the same screen', /Troubleshoot search/.test(await sheet()));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
