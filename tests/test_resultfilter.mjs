// Narrowing what you already have should not cost anything.
//
// Choosing kinds before a search is a real decision with a real price - each
// one is a separate request to the model - so it stays where it is. But once
// the answers are on screen, narrowing them is free, and it is the first
// moment you can do it from knowledge rather than guesswork: forty things
// back, six of them markets, and you can see that before deciding.
//
// Every placed event already records which of the nine searches found it, so
// this needs no new data - only for the screen to use what it has.
import { chromium } from 'playwright';
import { goTo, openEventForm } from './lib/screens.mjs';
import { angleFromPrompt } from './lib/angles.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
let calls = 0;
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  calls++;
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  const angle = angleFromPrompt(p);
  // Two markets and one gig, so the counts are worth reading.
  const list = angle === 'market'
    ? [
        { name: 'Bakewell Farmers Market', date: day, time: '09:00', venue: 'Market Place', area: 'Bakewell', what: 'Stalls.', price: 'free' },
        { name: 'Monday Producers', date: day, time: '10:00', venue: 'Town Hall', area: 'Bakewell', what: 'Stalls.', price: 'free' },
      ]
    : angle === 'music'
    ? [{ name: 'Folk Night', date: day, time: '20:00', venue: 'The Castle', area: 'Bakewell', what: 'Music.', price: '£' }]
    : [];
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(list) }] } }] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ elements: [] }) }));
await page.route(/wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }],
  }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true },
  ]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ geminiKey: 'k' }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(700);
await goTo(page, 'events', 400);
await openEventForm(page);
await page.evaluate(() => document.getElementById('evSearch').click());
await page.waitForFunction(() => !/Looking|Searching/i.test(document.getElementById('view').textContent),
  { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);

const countOf = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const txt = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
const rowNames = () => page.evaluate(() =>
  [...document.querySelectorAll('.ev-name, .ev-row-name')].map((e) => e.textContent.trim()));

check('the search found things at all', /farmers market|folk night/i.test(await txt()), (await txt()).slice(0, 200));

// ---------- Chips for what is actually there ----------
const chips = await countOf('[data-ev-found]');
check('the results offer a way to narrow themselves', chips >= 2, `${chips} chips`);
check('and only for kinds that were actually found', await page.evaluate(() => {
  const keys = [...document.querySelectorAll('[data-ev-found]')].map((b) => b.getAttribute('data-ev-found'));
  // "all" plus the two that answered, and nothing for the seven that did not.
  return !keys.includes('fetes') && !keys.includes('clubs');
}), await page.evaluate(() =>
  [...document.querySelectorAll('[data-ev-found]')].map((b) => b.getAttribute('data-ev-found')).join(',')));
check('with a count on each, so you can see before you tap',
  /2/.test(await page.evaluate(() => {
    const b = document.querySelector('[data-ev-found="market"]');
    return b ? b.textContent : '';
  })), await page.evaluate(() => {
    const b = document.querySelector('[data-ev-found="market"]');
    return b ? b.textContent : 'no market chip';
  }));

// ---------- Narrowing ----------
const before = await rowNames();
check('everything is shown to start with', before.length >= 3, JSON.stringify(before));

const callsBefore = calls;
await page.evaluate(() => {
  const b = document.querySelector('[data-ev-found="music"]');
  if (b) b.click();
});
await page.waitForTimeout(400);
const after = await rowNames();
check('tapping one narrows to it', after.length === 1 && /folk night/i.test(after[0]), JSON.stringify(after));
check('and costs nothing, because the answers are already here', calls === callsBefore,
  `${calls - callsBefore} extra requests`);
check('the chosen one is marked', await page.evaluate(() =>
  !!document.querySelector('[data-ev-found="music"].on')));

// ---------- And back ----------
await page.evaluate(() => {
  const b = document.querySelector('[data-ev-found="all"]');
  if (b) b.click();
});
await page.waitForTimeout(400);
check('and there is a way back to all of them', (await rowNames()).length === before.length,
  JSON.stringify(await rowNames()));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
