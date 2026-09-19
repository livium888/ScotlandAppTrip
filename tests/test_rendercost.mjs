// One value, read and re-parsed a hundred times, in a single render.
//
// Rendering Saved with 120 saved places made 258 localStorage reads and 258
// JSON.parse calls, re-parsing 212KB - because activeBoard() and loadPlan()
// sit inside per-row helpers, so boards-v1 was fetched and parsed 127 times
// and board:plan 121 times to draw one list. Plan re-parsed 343KB, reading
// people-v1 56 times.
//
// This asserts on the number of reads rather than on milliseconds. A time
// budget passes on a quiet machine and fails on a loaded CI runner, which is
// how a test ends up measuring the runner instead of the code; a count of
// reads is the same number everywhere.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

// Generous next to 258, and far under any plausible per-row read.
const CEILING = 25;

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|tile\.|generativelanguage/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
// A trip somebody has actually used: 120 places over eight towns, a week planned.
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }],
  }));
  const towns = ['Bakewell', 'Buxton', 'Matlock', 'Castleton', 'Hathersage', 'Eyam', 'Tideswell', 'Ashbourne'];
  const picks = [];
  towns.forEach((t, ti) => {
    for (let i = 0; i < 15; i++) {
      picks.push({ id: `p${ti}-${i}`, name: `${t} place ${i}`, city: t, category: 'Attraction',
        lat: 53.2 + ti / 50 + i / 500, lon: -1.6 - ti / 60, folder: t, addedAt: ti * 100 + i });
    }
  });
  localStorage.setItem('board:b:picks', JSON.stringify(picks));
  localStorage.setItem('board:b:folders', JSON.stringify(towns));
  const days = [], items = {};
  for (let d = 0; d < 7; d++) {
    const id = 'd' + d;
    days.push({ id, label: `Day ${d + 1} · Day`, date: new Date(Date.now() + d * 864e5).toISOString().slice(0, 10) });
    items[id] = picks.slice(d * 4, d * 4 + 4).map((x, i) => ({ pickId: x.id, time: `${9 + i * 2}:00` }));
  }
  localStorage.setItem('board:b:plan', JSON.stringify({ days, items }));
  localStorage.setItem('people-v1', JSON.stringify([{ name: 'Ella', dob: '2021-04-02' }, { name: 'Sam', dob: '2016-09-11' }]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(900);

const costOf = async (name) => {
  await goTo(page, name, 0);
  await page.waitForTimeout(450);
  return page.evaluate((n) => {
    const realGet = Storage.prototype.getItem;
    let gets = 0;
    const counts = {};
    Storage.prototype.getItem = function (k) {
      gets++;
      counts[k] = (counts[k] || 0) + 1;
      return realGet.call(this, k);
    };
    try {
      window.__tripTest.showView(n);
    } finally {
      Storage.prototype.getItem = realGet;
    }
    const worst = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['none', 0];
    return { gets, worstKey: worst[0], worstCount: worst[1] };
  }, name);
};

for (const screen of ['picks', 'itinerary', 'today', 'kids']) {
  const r = await costOf(screen);
  check(`${screen} reads storage a sane number of times (<= ${CEILING})`,
    r.gets <= CEILING, `${r.gets} reads, worst: ${r.worstKey} x${r.worstCount}`);
  check(`${screen} does not read one key over and over`,
    r.worstCount <= 4, `${r.worstKey} read ${r.worstCount}x`);
}

// The cache must not outlive the render, or a write would be invisible until
// something else happened to repaint.
await goTo(page, 'picks', 400);
const fresh = await page.evaluate(() => {
  const before = window.__tripTest.loadPicks().length;
  const picks = JSON.parse(localStorage.getItem('board:b:picks'));
  picks.push({ id: 'brand-new', name: 'Monsal Head', city: 'Bakewell', category: 'Attraction', lat: 53.24, lon: -1.72 });
  localStorage.setItem('board:b:picks', JSON.stringify(picks));
  return { before, after: window.__tripTest.loadPicks().length };
});
check('a write between renders is seen immediately', fresh.after === fresh.before + 1,
  JSON.stringify(fresh));

// And a render that throws must not leave the cache switched on for ever.
await page.evaluate(() => window.__tripTest.forceRenderFailure && window.__tripTest.forceRenderFailure());
await page.waitForTimeout(300);
const afterCrash = await page.evaluate(() => {
  const picks = JSON.parse(localStorage.getItem('board:b:picks'));
  picks.push({ id: 'another', name: 'Stanage Edge', city: 'Hathersage', category: 'Attraction', lat: 53.34, lon: -1.63 });
  localStorage.setItem('board:b:picks', JSON.stringify(picks));
  return window.__tripTest.loadPicks().some((p) => p.id === 'another');
});
check('a render that throws does not leave the cache stuck on', afterCrash);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
