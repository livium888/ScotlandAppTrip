// Three things at once, because they came in together.
//
// Today never changed with the date. It was drawn when you opened the tab and
// never again, so leaving the app open - or backgrounded, which on a phone is
// the same thing - meant it was still yesterday's day the next morning, with
// "NEXT" pointing at a stop you did before lunch.
//
// The Trip tab counted things: places saved, days planned, how many scheduled.
// All of it readable on the screens where it matters, so the space went to the
// question that actually gets asked with a small child in tow - where can they
// run about, and what do we do now it is raining.
//
// And the search chips offered the asks people type anyway. The useful ones
// are the ones that never occur to you.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}${''}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 820 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

let aiPrompts = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  try { aiPrompts.push(JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text); } catch (e) { /* not a prompt */ }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([
      { name: 'The Play Barn', area: 'Pitlochry', postcode: '', why: 'Indoor, and it has a coffee machine.' },
    ]) }] } }] }) });
});
await page.route(/nominatim\.openstreetmap\.org/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '56.7100', lon: '-3.7300', display_name: 'The Play Barn, Pitlochry', type: 'attraction', class: 'leisure',
    namedetails: { name: 'The Play Barn' }, address: { town: 'Pitlochry' }, extratags: {} }]) }));
await page.route(/wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis/, (r) => r.abort());

const picks = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-k:picks') || '[]'));
const viewText = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' ').trim());
// Kids, Budget and Notes are rows in More rather than tabs of their own now,
// so "go to that screen" means the tab if there is one and the More row if
// there is not.
const tab = async (name) => goTo(page, name, 400);

// A day today and a day tomorrow, so "which day is it" has a right answer that
// changes at midnight.
const today = new Date();
const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
const label = (d, n) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Day ${n} · ${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
};

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(([todayLabel, tomorrowLabel]) => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-k', boards: [{ id: 'b-k', name: 'Kids', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
    travellers: 'family of 3, 4-year-old who walks',
  }));
  localStorage.setItem('board:b-k:folders', JSON.stringify(['Pitlochry']));
  localStorage.setItem('board:b-k:picks', JSON.stringify([
    { id: 'custom:Playground', name: 'Riverside Playground', city: 'Pitlochry', category: 'Playground',
      lat: 56.7030, lon: -3.7320, addedAt: 1 },
    { id: 'custom:Castle', name: 'Blair Castle', city: 'Pitlochry', category: 'Castle',
      lat: 56.7658, lon: -3.8489, addedAt: 2 },
    { id: 'custom:Whisky', name: 'Edradour Distillery', city: 'Pitlochry', category: 'Distillery',
      lat: 56.7010, lon: -3.7000, addedAt: 3 },
  ]));
  localStorage.setItem('board:b-k:plan', JSON.stringify({
    days: [{ id: 'd1', label: todayLabel }, { id: 'd2', label: tomorrowLabel }],
    items: { d1: [{ pickId: 'custom:Playground', time: '10:00' }], d2: [{ pickId: 'custom:Castle', time: '11:00' }] },
  }));
}, [label(today, 1), label(tomorrow, 2)]);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);

// ---------- Today is about today ----------

await tab('today');
check('Today opens on the day it actually is',
  new RegExp(`\\b${today.getDate()}\\b`).test(await viewText()), (await viewText()).slice(0, 120));
check('and shows what is on it', /Riverside Playground/.test(await viewText()), (await viewText()).slice(0, 160));

// Midnight, without waiting for it: the clock moves and the screen is asked to
// notice, which is what going to bed and picking the phone up again does.
await page.evaluate(([tomorrowLabel]) => {
  const plan = JSON.parse(localStorage.getItem('board:b-k:plan'));
  // Relabel so that "tomorrow" is now today - the same thing the calendar does
  // overnight, from the app's point of view.
  plan.days[0].label = plan.days[0].label.replace(/·.*/, '· Mon 1 Jan');
  plan.days[1].label = tomorrowLabel;
  localStorage.setItem('board:b-k:plan', JSON.stringify(plan));
}, [label(today, 2)]);
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(600);
check('coming back to the app moves it on to the right day',
  /Blair Castle/.test(await viewText()), (await viewText()).slice(0, 200));

// ---------- The kids list ----------

// No longer a tab of its own - seven along the bottom of a phone is a menu
// rather than a bar. It is a row in More, one tap from anywhere.
await tab('more');
check('there is a way to the kids list', await page.evaluate(() =>
  !!document.querySelector('[data-more="kids"]')));
check('and it says how many are marked rather than just naming itself',
  await page.evaluate(() => /marked/.test(document.querySelector('[data-more="kids"]').textContent)),
  await page.evaluate(() => document.querySelector('[data-more="kids"]').textContent.replace(/\s+/g, ' ')));
check('and the Trip tab that counted things is gone', await page.evaluate(() =>
  !document.querySelector('[data-view="overview"]')));

await tab('kids');
const kidsText = await viewText();
check('a playground marks itself', /Riverside Playground/.test(kidsText), kidsText.slice(0, 200));
check('a distillery does not', !/Edradour/.test(kidsText), kidsText.slice(0, 200));
check('nor does a castle, which is a judgement only you can make',
  !/Blair Castle/.test(kidsText), kidsText.slice(0, 200));
check('there are quick ways to find more', await page.evaluate(() =>
  document.querySelectorAll('[data-kid-search]').length >= 6));
check('including the two that matter most on a bad day', await page.evaluate(() => {
  const text = Array.from(document.querySelectorAll('[data-kid-search]')).map((b) => b.textContent).join(' ');
  return /rains/i.test(text) && /Soft play/i.test(text);
}));

// A search from here is the ordinary search, so everything it can do works.
await page.evaluate(() => document.querySelector('[data-kid-search]').click());
await page.waitForSelector('#searchOverlay.open', { timeout: 4000 });
await page.waitForTimeout(4000);
check('tapping one runs a real search', await page.evaluate(() =>
  /Play Barn/.test(document.getElementById('searchOverlay').textContent)),
  await page.evaluate(() => document.getElementById('searchOverlay').textContent.slice(0, 160)));
check('asked as a person would ask it, not as a category',
  aiPrompts.some((p) => /young child/i.test(p)), (aiPrompts[0] || '').slice(0, 200));
await page.evaluate(() => document.querySelector('[data-search-close]').click());
await page.waitForTimeout(400);

// ---------- Marking one yourself ----------

await tab('picks');
await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-open-pick]'));
  (rows.find((r) => /Blair Castle/.test(r.textContent)) || rows[0]).click();
});
await page.waitForSelector('#placeModal.open', { timeout: 4000 });
check('a place can be marked as one for the kids', await page.evaluate(() =>
  !!document.querySelector('[data-toggle-kids]')));
await page.evaluate(() => document.querySelector('[data-toggle-kids]').click());
await page.waitForTimeout(600);
check('and it is remembered', (await picks()).some((p) => p.name === 'Blair Castle' && p.forKids === true),
  JSON.stringify((await picks()).map((p) => `${p.name}=${p.forKids}`)));
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.waitForTimeout(300);

await tab('kids');
check('so it shows up on the list', /Blair Castle/.test(await viewText()), (await viewText()).slice(0, 200));

// And taken off again - including one that marked itself.
await page.evaluate(() => document.querySelector('[data-kid-off]').click());
await page.waitForTimeout(600);
check('anything on the list can be taken off it', await page.evaluate(() =>
  document.querySelectorAll('.kids-row').length === 1),
  await page.evaluate(() => String(document.querySelectorAll('.kids-row').length)));
check('with a way back, since it is one tap', await page.evaluate(() =>
  !!document.querySelector('.toast-action')));

// ---------- Asks nobody thinks to type ----------

await tab('picks');
await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
await page.waitForSelector('#pickSearchInput');
const chips = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.search-chip')).map((c) => c.textContent.trim()));
check('the chips include the ones worth asking and easy to miss',
  chips.some((c) => /Comfort food/i.test(c)) &&
  chips.some((c) => /locals actually eat/i.test(c)) &&
  chips.some((c) => /Worth the detour/i.test(c)), JSON.stringify(chips));
check('and one that is deliberately not a category', chips.some((c) => /Surprise me/i.test(c)), JSON.stringify(chips));

aiPrompts = [];
await page.evaluate(() => document.querySelector('[data-surprise]').click());
await page.waitForTimeout(2000);
check('surprise me actually asks something',
  aiPrompts.length > 0 && aiPrompts[0].length > 40, (aiPrompts[0] || 'nothing asked').slice(0, 160));
check('and it is not one of the chips already on screen', await page.evaluate((shown) => {
  const asked = (document.getElementById('pickSearchInput') || {}).value || '';
  return !!asked && !shown.includes(asked);
}, chips), await page.evaluate(() => (document.getElementById('pickSearchInput') || {}).value || ''));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
