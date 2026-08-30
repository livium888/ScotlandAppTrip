// "The sorting and ordering of things in Kids and Picks is all over the
// place, very hard to navigate and make sense of it."
//
// It was two systems fighting. Places were grouped into sections by town, in
// whatever order the folders happened to be created, and then sorted inside
// each section by a separate chip. So "Nearest" meant nearest within a town
// while the towns sat in an arbitrary order; "By day" scattered Monday's
// stops across five headings; the chip was a saved preference with no label,
// so the list came back in a different order from the one you left it in for
// no visible reason; and Kids ignored all of it and sorted by distance from
// an origin nothing on screen named.
//
// One control now, and the order chosen decides the sections as well as the
// rows.
import { chromium } from 'playwright';
import { goTo, openSortRow } from './lib/screens.mjs';
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
await page.route(/generativelanguage|nominatim|wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis/, (r) => r.abort());

const tab = async (n) => {
  await goTo(page, n, 0);
  await page.waitForTimeout(350);
};
const order = async (key) => {
  await openSortRow(page);
  await page.evaluate((k) => document.querySelector(`[data-sort="${k}"]`).click(), key);
  await page.waitForTimeout(350);
};
// The screen as a reader meets it: headings and the rows under each.
const layout = () => page.evaluate(() => {
  const out = [];
  let current = null;
  document.querySelectorAll('#view .section-label, #view .area-head-name, #view button.pick-row, #view .kids-row-name')
    .forEach((el) => {
      const isRow = el.classList.contains('pick-row') || el.classList.contains('kids-row-name');
      if (isRow) {
        const name = el.classList.contains('kids-row-name')
          ? el.textContent.trim()
          : el.querySelector('.pick-row-name').textContent.trim();
        if (current) current.rows.push(name);
      } else {
        // The count sits in its own span next to the label, and a foldable
        // heading also carries a caret, so read the label itself.
        const label = el.querySelector('.fold-label') || el.querySelector('span:first-child');
        current = { head: (label ? label.textContent : el.textContent).trim(), rows: [] };
        out.push(current);
      }
    });
  return out;
});

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-o', boards: [{ id: 'b-o', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Scotland', geminiKey: '', geminiModel: '' }));
  localStorage.setItem('board:b-o:folders', JSON.stringify(['Edinburgh', 'Pitlochry']));
  // Deliberately added in a jumbled order, from two towns, some on days and
  // some not - which is the state a real list is in after a week of saving.
  localStorage.setItem('board:b-o:picks', JSON.stringify([
    { id: 'p1', name: 'Zoo', city: 'Edinburgh', category: 'Zoo', lat: 55.9425, lon: -3.2683, addedAt: 10 },
    { id: 'p2', name: 'Blair Castle', city: 'Pitlochry', category: 'Castle', lat: 56.7658, lon: -3.8489, addedAt: 40 },
    { id: 'p3', name: 'Arthur Seat', city: 'Edinburgh', category: 'Hill', lat: 55.9444, lon: -3.1617, addedAt: 20 },
    { id: 'p4', name: 'Riverside Playground', city: 'Pitlochry', category: 'Playground', lat: 56.7030, lon: -3.7320, addedAt: 50 },
    { id: 'p5', name: 'Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999, addedAt: 30 },
  ]));
  localStorage.setItem('board:b-o:plan', JSON.stringify({
    days: [{ id: 'd1', label: 'Day 1 · Sat 15 Aug' }, { id: 'd2', label: 'Day 2 · Sun 16 Aug' }],
    items: {
      d1: [{ pickId: 'p5', time: '10:00' }, { pickId: 'p3', time: '14:00' }],
      d2: [{ pickId: 'p2', time: '11:00' }],
    } }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await tab('picks');

// ---------- The control says what it does ----------

check('the order is named on arrival, without four bare chips', await page.evaluate(() => {
  const t = document.getElementById('sortToggle');
  return !!t && /by area|by day|nearest|just added/i.test(t.textContent);
}), await page.evaluate(() => (document.getElementById('sortToggle') || {}).textContent));
await openSortRow(page);
check('and opening it offers all four, explained', await page.evaluate(() =>
  !!document.querySelector('.order-note') && document.querySelectorAll('[data-sort]').length === 4));
check('and it says which one is on', await page.evaluate(() =>
  document.querySelectorAll('.order-chip.on').length === 1));

// ---------- By area: sections are towns, A-Z inside ----------

await order('area');
const byArea = await layout();
check('by area, the headings are the towns',
  byArea.some((s) => /Edinburgh/.test(s.head)) && byArea.some((s) => /Pitlochry/.test(s.head)),
  JSON.stringify(byArea.map((s) => s.head)));
check('and each town is alphabetical inside itself',
  byArea.filter((s) => s.rows.length > 1).every((s) =>
    JSON.stringify(s.rows) === JSON.stringify([...s.rows].sort((a, b) => a.localeCompare(b, 'en-GB')))),
  JSON.stringify(byArea));
check('every place is somewhere', byArea.reduce((a, s) => a + s.rows.length, 0) === 5,
  JSON.stringify(byArea));

// ---------- By day: the headings are the days ----------

await order('day');
const byDay = await layout();
check('by day, the headings are days rather than towns',
  /Sat 15/.test(byDay[0].head) && !byDay.some((s) => /Edinburgh|Pitlochry/.test(s.head)),
  JSON.stringify(byDay.map((s) => s.head)));
check("a day's stops are together and in the order you'll do them",
  JSON.stringify(byDay[0].rows) === JSON.stringify(['Castle', 'Arthur Seat']), JSON.stringify(byDay[0]));
check('and the second day is its own heading', /Sun 16/.test(byDay[1].head), JSON.stringify(byDay[1]));
check('everything not on a day yet collects at the end, where the work is',
  /Not on a day yet/.test(byDay[byDay.length - 1].head) && byDay[byDay.length - 1].rows.length === 2,
  JSON.stringify(byDay[byDay.length - 1]));

// ---------- Nearest: one list, because that is what nearest means ----------

await order('near');
const near = await layout();
check('nearest is one list rather than distance-within-a-town', near.length === 1,
  JSON.stringify(near.map((s) => s.head)));
check('and it names what it is measuring from', /Closest to/.test(near[0].head), near[0].head);
check('the closest really is first', near[0].rows[0] === 'Castle', JSON.stringify(near[0].rows));
check('and the far end of the country is last',
  near[0].rows[near[0].rows.length - 1] === 'Blair Castle', JSON.stringify(near[0].rows));
check('with the distances shown, since that is the order',
  /\d+(\.\d+)?\s*(mi|yd)/.test(await page.evaluate(() => document.getElementById('view').textContent)));

// ---------- Just added ----------

await order('recent');
const recent = await layout();
check('just added is one list, newest first',
  recent.length === 1 && recent[0].rows[0] === 'Riverside Playground', JSON.stringify(recent[0]));

// ---------- Kids agrees with Picks ----------

await page.evaluate(() => {
  const picks = JSON.parse(localStorage.getItem('board:b-o:picks'));
  picks.forEach((p) => { if (p.id !== 'p1') p.forKids = true; });
  localStorage.setItem('board:b-o:picks', JSON.stringify(picks));
});
await tab('kids');
await order('day');
const kidsByDay = await layout();
await openSortRow(page);
check('Kids is ordered by the same control', await page.evaluate(() =>
  document.querySelectorAll('[data-sort]').length === 4));
check('and obeys it, rather than always sorting by distance',
  kidsByDay.some((s) => /Sat 15/.test(s.head)) && !kidsByDay.some((s) => /Pitlochry/.test(s.head)),
  JSON.stringify(kidsByDay.map((s) => s.head)));

await tab('picks');
await openSortRow(page);
check('the two screens agree on the order without being told twice',
  await page.evaluate(() => !!document.querySelector('[data-sort="day"].on')));

// The choice is remembered, and now there is something on screen saying what
// it is - which is what made it confusing rather than merely sticky.
await page.reload({ waitUntil: 'load' });
await tab('picks');
await openSortRow(page);
check('it is still in that order when you come back', await page.evaluate(() =>
  !!document.querySelector('[data-sort="day"].on')));
check('and the screen says so', /order you/.test(await page.evaluate(() =>
  document.querySelector('.order-note').textContent)));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
