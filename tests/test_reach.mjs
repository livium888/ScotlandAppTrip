// Everything you can tap has to be big enough to tap.
//
// Twenty-nine controls rendered under the 44px minimum that both Apple and
// Google publish. The worst were on Plan, the screen with the most controls
// on it: the reorder arrows were 23x27, sitting immediately beside Remove at
// 27x27 - so a missed tap is not harmless, it deletes the stop you were
// trying to move.
//
// The rule is about the hit area, not the drawing. An icon can stay 16px and
// still be easy to hit if its button reaches 44; growing the glyph instead
// would have made the app look like a toy.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const MIN = 44;

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|tile\.|generativelanguage/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }],
  }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'c:1', name: 'Chatsworth House', city: 'Bakewell', category: 'Attraction', lat: 53.2276, lon: -1.6104, folder: 'Bakewell' },
    { id: 'c:2', name: 'The Old Bakery', city: 'Bakewell', category: 'Cafe', lat: 53.2129, lon: -1.6753, folder: 'Bakewell' },
    { id: 'c:3', name: 'Monsal Head', city: 'Bakewell', category: 'Attraction', lat: 53.24, lon: -1.72, folder: 'Days out' },
  ]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell', 'Days out']));
  localStorage.setItem('people-v1', JSON.stringify([{ name: 'Ella', dob: '2021-04-02' }]));
  const iso = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const lab = (n) => `Day ${n + 1} · ${new Date(Date.now() + n * 864e5).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  localStorage.setItem('board:b:plan', JSON.stringify({
    days: [{ id: 'd1', label: lab(0), date: iso(0) }, { id: 'd2', label: lab(1), date: iso(1) }],
    items: { d1: [{ pickId: 'c:1', time: '10:00' }, { pickId: 'c:2', time: '13:00' }], d2: [{ pickId: 'c:3', time: '09:30' }] },
  }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(700);

// The tappable box, which is not always the painted box: a button can draw a
// small icon and still take a 44px tap through padding or a stretched
// pseudo-element. This asks the browser what would actually receive the tap.
const tooSmall = () => page.evaluate((min) => {
  const out = [];
  document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]').forEach((el) => {
    if (el.offsetParent === null) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    let w = r.width, h = r.height;
    // A ::before or ::after used purely to enlarge the hit area counts.
    ['::before', '::after'].forEach((pseudo) => {
      const cs = getComputedStyle(el, pseudo);
      if (!cs || cs.content === 'none' || cs.position !== 'absolute') return;
      const px = (v) => (v && v.endsWith('px') ? parseFloat(v) : 0);
      const grownW = r.width - px(cs.left) - px(cs.right);
      const grownH = r.height - px(cs.top) - px(cs.bottom);
      if (grownW > w) w = grownW;
      if (grownH > h) h = grownH;
    });
    // A checkbox draws at its own size whatever the stylesheet asks, so the
    // label wrapped around it carries the target - which is the bigger thing
    // to aim at and the one people actually tap. Exempt only when the label
    // really is big enough.
    if (el.type === 'checkbox' || el.type === 'radio') {
      const label = el.closest('label');
      if (label && label.getBoundingClientRect().height >= min - 0.5) return;
    }
    if (w < min - 0.5 || h < min - 0.5) {
      const label = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
      out.push(`${Math.round(w)}x${Math.round(h)} .${(el.className || el.tagName).toString().trim().split(/\s+/)[0]} "${label.slice(0, 18)}"`);
    }
  });
  return out;
}, MIN);

const SCREENS = ['today', 'itinerary', 'picks', 'events', 'more', 'kids', 'budget', 'tips', 'usage'];
const all = new Map();
for (const s of SCREENS) {
  await goTo(page, s, 0);
  await page.waitForTimeout(400);
  for (const o of await tooSmall()) all.set(o, s);
}

const offenders = [...all.keys()].sort();
check(`nothing you can tap is under ${MIN}px`, offenders.length === 0,
  `${offenders.length}: ${offenders.slice(0, 12).join(' | ')}`);

// Plan named specifically, because it had the worst of them and because a
// regression there is the one that deletes a stop instead of moving it.
const planOffenders = [...all.entries()].filter(([, s]) => s === 'itinerary').map(([o]) => o);
check('the reorder and remove buttons on Plan are reachable', planOffenders.length === 0,
  planOffenders.join(' | '));

// Being big enough is not enough on its own: two 44px targets touching each
// other still mis-fire. The destructive one needs air around it.
await goTo(page, 'itinerary', 400);
const gap = await page.evaluate(() => {
  const row = document.querySelector('.plan-item');
  if (!row) return null;
  const btns = [...row.querySelectorAll('button')].map((b) => b.getBoundingClientRect()).sort((a, b) => a.left - b.left);
  if (btns.length < 2) return null;
  let smallest = Infinity;
  for (let i = 1; i < btns.length; i++) smallest = Math.min(smallest, btns[i].left - btns[i - 1].right);
  return smallest;
});
check('and not jammed against each other', gap === null || gap >= 0, `smallest gap ${gap}`);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
