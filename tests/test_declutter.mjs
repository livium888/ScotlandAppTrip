// Less on every screen.
//
// "If Steve Jobs saw this app, what would he change?" Most of the answer was
// deleting things:
//
// - A plan stop carried a time box, up and down arrows and a remove button
//   on every row, all the time, so a finished plan looked like a form. A stop
//   reads as its time and name now; tapping it opens its controls, and a
//   handle drags it to a new place in the day.
// - Two large "build it for me" buttons, each with a paragraph, sat under
//   every plan. There is one way in, and both builders are one tap inside.
// - Screens captioned themselves: the top bar repeated the name of the tab
//   you had just pressed, and headings came with a sentence saying what the
//   screen was for.
//
// Nothing here may cost a feature: every control that went out of sight has
// to still be one tap away and still work.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
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
await page.route(/nominatim|wikidata|wikipedia|overpass|tile\.|open-meteo|photon|googleapis/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('onboarded-v1', '1');
  localStorage.setItem('trip-settings-v1', JSON.stringify({ geminiKey: 'k' }));
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Edinburgh', destination: 'Edinburgh', dated: true, createdAt: 1 }] }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'c:castle', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999 },
    { id: 'c:camera', name: 'Camera Obscura', city: 'Edinburgh', category: 'Museum', lat: 55.9489, lon: -3.1953 },
    { id: 'c:seat', name: "Arthur's Seat", city: 'Edinburgh', category: 'Hill', lat: 55.944, lon: -3.1618 },
  ]));
  localStorage.setItem('board:b:plan', JSON.stringify({
    days: [{ id: 'd1', label: 'Day 1' }],
    items: { d1: [
      { pickId: 'c:castle', time: '10:00' },
      { pickId: 'c:camera', time: '12:00' },
      { pickId: 'c:seat', time: '15:00' },
    ] },
  }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

const visible = (sel) => page.evaluate((s) => Array.from(document.querySelectorAll(s))
  .filter((el) => el.offsetParent !== null).length, sel);
const order = () => page.evaluate(() => {
  const plan = JSON.parse(localStorage.getItem('board:b:plan'));
  return plan.items.d1.map((it) => `${it.time} ${it.pickId}`);
});

// ---------- A stop reads first, edits on tap ----------

await goTo(page, 'itinerary', 400);
check('three stops on the plan', await page.evaluate(() => document.querySelectorAll('.plan-item').length) === 3);
check('with no time boxes showing', await visible('[data-plan-time]') === 0, String(await visible('[data-plan-time]')));
check('no arrows', await visible('[data-plan-move]') === 0, String(await visible('[data-plan-move]')));
check('and no remove buttons', await visible('[data-plan-remove]') === 0, String(await visible('[data-plan-remove]')));
check('each still says its time and its name', await page.evaluate(() =>
  /10:00\s*Edinburgh Castle/.test(document.querySelector('.plan-item').textContent.replace(/\s+/g, ' '))));

await page.click('[data-plan-open="d1|c:camera"]');
await page.waitForTimeout(300);
check('tapping a stop opens its controls', await visible('[data-plan-time]') === 1 &&
  await visible('[data-plan-move]') === 2 && await visible('[data-plan-remove]') === 1);
check('on that stop only', await page.evaluate(() =>
  !!document.querySelector('[data-plan-key="d1|c:camera"] [data-plan-time]').offsetParent));

// The controls that are now inside still work, as a person would use them.
await page.click('[data-plan-key="d1|c:camera"] [aria-label="Move up"]');
await page.waitForTimeout(300);
check('the arrows still move a stop, and the times stay in order',
  JSON.stringify(await order()) === JSON.stringify(['10:00 c:camera', '12:00 c:castle', '15:00 c:seat']),
  JSON.stringify(await order()));
check('and the stop stays open to move again', await visible('[data-plan-time]') === 1);

await page.click('[data-plan-open="d1|c:seat"]');
await page.waitForTimeout(300);
check('opening another closes the first', await visible('[data-plan-time]') === 1 && await page.evaluate(() =>
  !!document.querySelector('[data-plan-key="d1|c:seat"] [data-plan-time]').offsetParent));
await page.click('[data-plan-open="d1|c:seat"]');
await page.waitForTimeout(300);
check('and tapping it again closes it', await visible('[data-plan-time]') === 0);

// ---------- Drag to reorder ----------

check('each stop has a handle to drag it by', await visible('.plan-drag') === 3);
check('the drag library is loaded', await page.evaluate(() => typeof window.Sortable === 'function'));

// A real drag, on the handle, from the last stop to the first.
const handle = async (pick) => page.evaluate((p) => {
  const r = document.querySelector(`[data-plan-key="d1|${p}"] .plan-drag`).getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, pick);
const from = await handle('c:seat');
const to = await handle('c:camera');
await page.mouse.move(from.x, from.y);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(from.x, from.y + ((to.y - 8) - from.y) * (i / 12));
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(500);
check('dragging the last stop to the top puts it first, in the first time slot',
  JSON.stringify(await order()) === JSON.stringify(['10:00 c:seat', '12:00 c:camera', '15:00 c:castle']),
  JSON.stringify(await order()));

// The rule itself, without a mouse: places move, the day's times stay put.
await page.evaluate(() => window.__tripTest.movePlanItemTo('d1', 'c:castle', 1));
check('moving a stop keeps the times where they were in the day',
  JSON.stringify(await order()) === JSON.stringify(['10:00 c:seat', '12:00 c:castle', '15:00 c:camera']),
  JSON.stringify(await order()));

// ---------- One way to build it ----------

await goTo(page, 'itinerary', 300);
check('one "Build it for me", not two buttons', await visible('#buildItBtn') === 1 &&
  await visible('#autoPlanBtn') === 0 && await visible('#tripIdeaBtn') === 0);
await page.click('#buildItBtn');
await page.waitForTimeout(300);
check('with both builders one tap inside', await visible('#autoPlanBtn') === 1 && await visible('#tripIdeaBtn') === 1);
await page.click('#autoPlanBtn');
await page.waitForSelector('#planOverlay.open', { timeout: 4000 });
check('and they still open', await page.evaluate(() => document.getElementById('planOverlay').classList.contains('open')));
await page.evaluate(() => document.querySelector('#planOverlay [data-close], #planOverlay .modal-close, #planOverlay .planner-close')?.click());
await page.waitForTimeout(300);

// ---------- Screens do not caption themselves ----------

const text = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
check('the top bar names the trip, not the tab', await page.evaluate(() => !document.getElementById('topbarSub')));
await goTo(page, 'itinerary', 300);
check('the plan does not explain its builders',
  !/see what fits before anything changes|you get whole routes back/i.test(await text()));
await goTo(page, 'events', 300);
check('Find does not explain what an event is', !/Things with a date on them/i.test(await text()), (await text()).slice(0, 200));
await goTo(page, 'explore', 300);
check('nor Places nearby what nearby means', !/anything around a point you choose/i.test(await text()));

// ---------- No strip across the top ----------

// Hidden in fact, not just in name: the banner's own display rule beat the
// attribute, and an empty strip sat under the top bar on every screen.
check('and nothing is laid across the top of every screen', await page.evaluate(() =>
  document.getElementById('appBanner').hidden && document.getElementById('appBanner').getBoundingClientRect().height === 0),
  String(await page.evaluate(() => document.getElementById('appBanner').getBoundingClientRect().height)));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
