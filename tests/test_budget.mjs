// "Budget is manual, no-one wants to use a manual feature that much."
//
// It was a spreadsheet: one row per saved place, each with an empty number
// box, plus a form for anything else. Forty empty boxes on a phone is not a
// feature, it is homework, so the screen showed £0 for ever.
//
// Everything on it was already knowable - the trip has days, the days have
// places, the places have coordinates, and what a castle costs a family is
// an ordinary fact. So it works itself out, says where each number came
// from, and only asks you when you disagree with it.
import { chromium } from 'playwright';
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

let asked = '';
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  try { asked = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text; } catch (e) { /* not a prompt */ }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      places: [
        { name: 'Edinburgh Castle', low: 60, high: 66, note: 'family ticket' },
        { name: 'Arthur’s Seat', low: 0, high: 0, note: 'free' },
        { name: 'The Sheep Heid Inn', low: 45, high: 70, note: 'lunch for three' },
      ],
      foodPerDay: { low: 40, high: 75, note: '' },
      fuelTotal: { low: 18, high: 26, note: '' },
      stayPerNight: { low: 95, high: 140, note: '' },
    }) }] } }] }) });
});
await page.route(/nominatim|wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis/, (r) => r.abort());

const text = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' ').trim());
const budget = async () => {
  await page.evaluate(() => document.querySelector('[data-view="budget"]').click());
  await page.waitForTimeout(350);
};

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-b', boards: [{ id: 'b-b', name: 'Trip', destination: 'Edinburgh', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Edinburgh', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
    travellers: 'family of 3, 4-year-old' }));
  localStorage.setItem('board:b-b:folders', JSON.stringify(['Edinburgh']));
  localStorage.setItem('board:b-b:picks', JSON.stringify([
    { id: 'p1', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999, addedAt: 1 },
    { id: 'p2', name: 'Arthur’s Seat', city: 'Edinburgh', category: 'Hill', lat: 55.9444, lon: -3.1617, addedAt: 2 },
    { id: 'p3', name: 'The Sheep Heid Inn', city: 'Edinburgh', category: 'Pub', lat: 55.9403, lon: -3.1583, addedAt: 3 },
  ]));
  localStorage.setItem('board:b-b:plan', JSON.stringify({
    days: [{ id: 'd1', label: 'Day 1 · Sat 15 Aug' }, { id: 'd2', label: 'Day 2 · Sun 16 Aug' }],
    items: { d1: [{ pickId: 'p1', time: '10:00' }, { pickId: 'p3', time: '13:00' }], d2: [{ pickId: 'p2', time: '11:00' }] } }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);

// ---------- Before it knows anything ----------

await budget();
check('it offers to work the trip out', await page.evaluate(() => !!document.getElementById('budgetEstimate')));
check('rather than a grid of empty boxes', await page.evaluate(() =>
  document.querySelectorAll('.budget-line input[type="number"]').length === 0));

// ---------- Working it out ----------

await page.evaluate(() => document.getElementById('budgetEstimate').click());
await page.waitForTimeout(2500);
const done = await text();

check('it asked about the group actually travelling', /family of 3/.test(asked), asked.slice(0, 160));
check('and about the days in the plan', /2 day/.test(asked), asked.slice(0, 200));
check('and about the driving it can measure itself', /\d+ miles of driving/.test(asked), asked.slice(0, 260));

check('every place is priced without being asked', /Edinburgh Castle/.test(done) && /Sheep Heid/.test(done), done.slice(0, 200));
check('free is said as free, not left blank', /free/i.test(done), done.slice(0, 300));
check('food across the days is counted', /Eating, 2 days/.test(done), done.slice(0, 300));
check('so is a night in between', /1 night/.test(done), done.slice(0, 400));
check('and the driving', /Getting about/.test(done), done.slice(0, 400));

// 60+0+45 places, 80 food low, 18 fuel, 95 stay = 298 low.
check('the total is a range rather than a false precision', /£\d+–£\d+/.test(done), done.slice(0, 120));
check('and it adds up', /£298/.test(done), done.slice(0, 120));

// Every number says where it came from. An estimate that does not admit to
// being one is just a wrong number.
check('every line says where its number came from', await page.evaluate(() =>
  document.querySelectorAll('.budget-tag').length >= 5));
check('and they are marked as estimates', /est\./.test(done), done.slice(0, 300));

// ---------- Disagreeing with it ----------

await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-budget-open]'));
  rows.find((r) => /Edinburgh Castle/.test(r.textContent)).click();
});
await page.waitForSelector('[data-budget-edit]');
check('a line opens in place rather than in a browser dialog', await page.evaluate(() =>
  !!document.querySelector('.budget-line.editing input')));
await page.evaluate(() => {
  const i = document.querySelector('[data-budget-edit]');
  i.value = '40';
  i.dispatchEvent(new Event('blur'));
});
await page.waitForTimeout(400);
const mine = await text();
check('your price is kept', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('board:b-b:picks')).some((p) => p.id === 'p1' && p.cost === 40)));
check('and marked as yours rather than an estimate', /yours/.test(mine), mine.slice(0, 300));
check('and the total follows it down', /£278/.test(mine), mine.slice(0, 120));

// A trip-level line can be argued with in the same way.
await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-budget-open]'));
  rows.find((r) => /Somewhere to stay/.test(r.textContent)).click();
});
await page.waitForSelector('[data-budget-edit]');
await page.evaluate(() => {
  const i = document.querySelector('[data-budget-edit]');
  i.value = '0';
  i.dispatchEvent(new Event('blur'));
});
await page.waitForTimeout(400);
check('staying with family costs nothing, and it believes you', /£183/.test(await text()), (await text()).slice(0, 120));

// ---------- It stays worked out ----------

await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await budget();
check('the estimate survives closing the app', /Edinburgh Castle/.test(await text()) && /est\./.test(await text()),
  (await text()).slice(0, 200));
check('and so does your correction', /yours/.test(await text()), (await text()).slice(0, 300));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
