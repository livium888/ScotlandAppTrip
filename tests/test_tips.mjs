/* global PACKING */
// Notes & packing, end to end.
//
// This screen had no browser test of its own, and it was about to move out of
// app.js. This pins what it does today: the list is seeded once from the
// bundled defaults plus a few lines for who is actually coming, ticks and
// edits are kept per trip, the old global ticks are carried over, and the
// notes are saved when you leave the box.
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
await page.addInitScript(() => { localStorage.setItem('onboarded-v1', '1'); });
await page.route(/nominatim|wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis|generativelanguage/, (r) => r.abort());

const seed = async ({ people, legacy } = {}) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(({ people, legacy }) => {
    localStorage.clear();
    localStorage.setItem('onboarded-v1', '1');
    localStorage.setItem('boards-v1', JSON.stringify({ activeId: 'b1', boards: [
      { id: 'b1', name: 'One', destination: 'Bakewell', dated: true, createdAt: 1 },
      { id: 'b2', name: 'Two', destination: 'Matlock', dated: true, createdAt: 2 }] }));
    if (people) localStorage.setItem('people-v1', JSON.stringify(people));
    if (legacy) localStorage.setItem('scotland-trip-packing-v1', JSON.stringify(legacy));
  }, { people, legacy });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
};
const openTips = async () => {
  await page.evaluate(() => { window.__tripTest.showView('itinerary'); document.querySelector('[data-trip-extra="tips"]').click(); });
  await page.waitForTimeout(300);
};
const list = () => page.evaluate(() => [...document.querySelectorAll('.packing-list li')].map((li) => ({ text: li.querySelector('.packing-text').textContent, done: li.classList.contains('checked') })));
const stored = (board, part) => page.evaluate(([b, p]) => JSON.parse(localStorage.getItem(`board:${b}:${p}`)), [board, part]);

// ---------- A family: the list is seeded for who is coming ----------
await seed({ people: [{ name: 'Liviu', age: 38 }, { name: 'Ella', age: 3, buggy: true, naps: true }], legacy: { 0: true } });
await openTips();
const defaults = await page.evaluate(() => PACKING.slice());
let items = await list();
check('the bundled defaults are there, then the lines for this family', items.length === defaults.length + 3 &&
  items.slice(0, defaults.length).every((it, i) => it.text === defaults[i]), `${items.length} vs ${defaults.length + 3}`);
check('a buggy, a child and a napper each add their own line', items.some((i) => /Buggy, and the rain cover/.test(i.text)) &&
  items.some((i) => /comfort toy/.test(i.text)) && items.some((i) => /nap happen away from home/.test(i.text)));
check('ticks from the old global list are carried over', items[0].done === true && items.slice(1).every((i) => !i.done));
check('the seeded list is saved for this trip, so it is not re-seeded', (await stored('b1', 'packing')).length === items.length);
check('the heading counts what is packed', /Packing list · 1\/\d+/.test(await page.evaluate(() => document.getElementById('view').textContent)));

// ---------- Ticking, removing, adding ----------
await page.click('.packing-list li:nth-child(2) .packing-text');
check('ticking an item marks it and keeps it', (await list())[1].done === true && (await stored('b1', 'packing'))[1].done === true);
await page.click('.packing-list li:nth-child(2) .packing-text');
check('ticking again clears it', (await list())[1].done === false);
const before = (await list()).length;
await page.click('[data-packing-remove="0"]');
items = await list();
check('removing drops that item only', items.length === before - 1 && items[0].text === defaults[1]);
await page.fill('#packingAddInput', 'Spare socks');
await page.press('#packingAddInput', 'Enter');
await page.waitForTimeout(200);
items = await list();
check('adding puts a new, unticked item at the end', items[items.length - 1].text === 'Spare socks' && items[items.length - 1].done === false);
await page.fill('#packingAddInput', '   ');
await page.press('#packingAddInput', 'Enter');
check('adding nothing adds nothing', (await list()).length === items.length);

// ---------- Notes ----------
await page.fill('#boardNotes', 'Flat code 4821; Sam is driving');
await page.click('#packingAddInput');
check('notes are saved when you leave the box', await stored('b1', 'notes') === 'Flat code 4821; Sam is driving');

// ---------- Each trip has its own ----------
await page.evaluate(() => window.__tripTest.showView('itinerary'));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await openTips();
check('after a reload the list and notes are still there', (await list()).some((i) => i.text === 'Spare socks') &&
  await page.evaluate(() => document.getElementById('boardNotes').value === 'Flat code 4821; Sam is driving'));
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('boards-v1')); s.activeId = 'b2'; localStorage.setItem('boards-v1', JSON.stringify(s));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await openTips();
items = await list();
check('another trip starts from the defaults, without the first trip\'s edits or notes', !items.some((i) => i.text === 'Spare socks') &&
  await page.evaluate(() => document.getElementById('boardNotes').value === ''));

// ---------- Adults only ----------
await seed({ people: [{ name: 'A', age: 40 }, { name: 'B', age: 41 }] });
await openTips();
items = await list();
const d2 = await page.evaluate(() => PACKING.length);
check('with no children, buggy or naps, only the defaults', items.length === d2);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
