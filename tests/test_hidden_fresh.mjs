// Freshness and hiding for good, end to end.
//
// A fresh search says how old it is (an app left in the background must not
// look current for hours); a result hidden as wrong stays hidden through the
// next search and a restart, with undo and a way to bring it back; and a
// saved event remembers when it was found, and says so when that was a while
// ago and the event is still to come.
import { chromium } from 'playwright';
import { openEventForm, goTo } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tomorrow = iso(new Date(Date.now() + 864e5));

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.addInitScript(() => { try { localStorage.setItem('onboarded-v1', '1'); } catch { /* nothing */ } });

await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models(\?|$)/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  const text = `- name: Folk Night; venue: Village Hall; town: Bakewell; date: ${tomorrow}; time: 19:30; link: https://x.example/folk\n` +
    `- name: Craft Morning; venue: Library; town: Bakewell; date: ${tomorrow}; time: 10:00; link: https://x.example/craft`;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] },
    groundingMetadata: { webSearchQueries: ['q'], groundingChunks: [{ web: { uri: 'https://x.example/folk', title: 'p' } }] } }] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
  lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town', namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));
await page.route(/overpass|wikidata|wikipedia|photon|tile\.|open-meteo|places\.googleapis/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('onboarded-v1', '1');
  localStorage.setItem('boards-v1', JSON.stringify({ activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Bakewell', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash', geminiModelPinned: true, mode: 'adults' }));
  localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
  localStorage.setItem('board:b:picks', JSON.stringify([{ id: 'm', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true }]));
  localStorage.setItem('board:b:search-anchor', JSON.stringify({ name: 'Bakewell', lat: 53.2129, lon: -1.6753, miles: 15 }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

const rows = () => page.evaluate(() => [...document.querySelectorAll('.ev-row .ev-name')].map((n) => n.textContent.trim()));
const text = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
const search = async () => {
  await goTo(page, 'events', 300);
  await page.evaluate(() => window.__tripTest.setEventKinds(['hall']));
  await openEventForm(page);
  await page.evaluate(() => document.getElementById('evSearch').click());
  await page.waitForFunction(() => document.querySelectorAll('.ev-row').length >= 1, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
};

// ---------- A fresh search says how old it is ----------
await search();
check('two results arrive', (await rows()).length === 2, JSON.stringify(await rows()));
check('a fresh search is dated', /Searched (just now|1 min ago)/.test(await text()), (await text()).slice(0, 300));
check('and is not called stale', !/Look again/.test(await text()));
await page.evaluate(() => { const real = Date.now.bind(Date); window.__realNow = real; Date.now = () => real() + 7 * 3600000; window.__tripTest.renderEvents(); });
await page.waitForTimeout(300);
check('left for seven hours it says so, and offers to look again', /Searched 7 h ago/.test(await text()) && /Look again/.test(await text()), (await text()).slice(0, 300));
await page.evaluate(() => { Date.now = window.__realNow; window.__tripTest.renderEvents(); });

// ---------- Hiding a wrong result ----------
const names0 = await rows();
await page.evaluate(() => document.querySelector('[data-drop-result]').click());
await page.waitForTimeout(300);
let after = await rows();
check('it goes from the list', after.length === 1 && !after.includes(names0[0]), JSON.stringify(after));
check('and is remembered on the phone', await page.evaluate(() => JSON.parse(localStorage.getItem('hidden-events-v1') || '[]').length === 1));
check('the toast says it will not come back, and offers undo', /won't come back/.test(await page.evaluate(() => document.getElementById('toast').textContent)) &&
  await page.evaluate(() => !!document.querySelector('#toast .toast-action')));
await page.evaluate(() => document.querySelector('#toast .toast-action').click());
await page.waitForTimeout(300);
check('undo brings it back and forgets it', (await rows()).length === 2 && await page.evaluate(() => JSON.parse(localStorage.getItem('hidden-events-v1') || '[]').length === 0));
await page.evaluate(() => document.querySelector('[data-drop-result]').click());
await page.waitForTimeout(300);
const stillHiddenName = names0[0];

// ---------- ...through the next search ----------
await search();
after = await rows();
check('a new search finds it again but keeps it hidden', after.length === 1 && !after.includes(stillHiddenName), JSON.stringify(after));
check('and says that one is hidden, with a way to bring it back', /1 hidden/.test(await text()) && await page.evaluate(() => !!document.getElementById('evShowHidden')));

// ---------- ...and a restart ----------
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);
await goTo(page, 'events', 600);
after = await rows();
check('after a restart it is still hidden', after.length === 1 && !after.includes(stillHiddenName), JSON.stringify(after));

// ---------- bringing it back ----------
await page.evaluate(() => document.getElementById('evShowHidden').click());
await page.waitForTimeout(300);
check('showing it again restores it, for good', (await rows()).length === 2 && await page.evaluate(() => JSON.parse(localStorage.getItem('hidden-events-v1') || '[]').length === 0));
check('and the note goes away', !/hidden/.test(await text()));
check('what is hidden is kept off backups, as a local preference', await page.evaluate(() => !JSON.stringify(window.__tripTest.buildBackup()).includes('hidden-events-v1')));

// ---------- A saved event remembers when it was found ----------
await page.evaluate(() => document.querySelector('[data-save-event="0"]').click());
await page.waitForTimeout(500);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('board:b:picks')).find((p) => p.kind === 'event'));
check('saving records when it was found, at the time of the search', saved && typeof saved.foundAt === 'number' && Date.now() - saved.foundAt < 120000, JSON.stringify(saved && saved.foundAt));
await page.evaluate(() => {
  const picks = JSON.parse(localStorage.getItem('board:b:picks'));
  picks.forEach((p) => { if (p.kind === 'event') p.foundAt = Date.now() - 5 * 86400000; });
  localStorage.setItem('board:b:picks', JSON.stringify(picks));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
await goTo(page, 'picks', 500);
await page.evaluate(() => document.querySelector('[data-open-pick^="custom:"]').click());
await page.waitForTimeout(500);
const sheet = await page.evaluate(() => document.getElementById('placeModal').textContent.replace(/\s+/g, ' '));
check('its sheet says when it was found', /Found 5 days ago/.test(sheet), sheet.slice(0, 300));
check('and, since it is still to come, that listings change', /check it's still on/i.test(sheet));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
