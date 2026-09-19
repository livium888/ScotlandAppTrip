// Every screen should open on your stuff, with the machinery below it.
//
// Plan opened on two large AI buttons and two paragraphs explaining them,
// and only then your actual days - so the thing you came to look at started
// below the fold on a phone, on a screen whose entire subject is that thing.
// Saved opened on seven chips across two rows: what kind, then what order.
//
// The sort row is a special case worth stating, because it was itself a fix.
// Ordering used to be a silent saved preference, so the list came back in a
// different order from the one you left it in with nothing on screen to say
// why. Folding it away again would put that bug straight back, so the rule
// here is narrower than "hide it": the current order must still be named on
// arrival, it just does not need four chips and a note to say so.
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
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|tile\.|generativelanguage/, (r) => r.abort());

const seed = async (withDays) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((days) => {
    localStorage.clear();
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b', boards: [{ id: 'b', name: 'Lake District', destination: 'Keswick', dated: true, createdAt: 1 }],
    }));
    localStorage.setItem('board:b:picks', JSON.stringify([
      { id: 'c:1', name: 'Castlerigg Stone Circle', city: 'Keswick', category: 'Attraction', lat: 54.6027, lon: -3.0983, folder: 'Keswick' },
      { id: 'c:2', name: 'The Dog and Gun', city: 'Keswick', category: 'Pub', lat: 54.6013, lon: -3.1367, folder: 'Keswick' },
      { id: 'c:3', name: 'Whinlatter Forest', city: 'Braithwaite', category: 'Attraction', lat: 54.6055, lon: -3.2258, folder: 'Days out' },
    ]));
    localStorage.setItem('board:b:folders', JSON.stringify(['Keswick', 'Days out']));
    if (days) {
      const d = new Date();
      const lab = `Day 1 · ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
      localStorage.setItem('board:b:plan', JSON.stringify({
        days: [{ id: 'd1', label: lab, date: d.toISOString().slice(0, 10) }],
        items: { d1: [{ pickId: 'c:1', time: '10:00' }, { pickId: 'c:2', time: '13:00' }] },
      }));
    }
  }, withDays);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
};

// Where something sits down the page, or -1 if it is not there at all.
const topOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return -1;
  const r = el.getBoundingClientRect();
  return r.top + (document.getElementById('view').scrollTop || 0);
}, sel);
const countOf = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const txt = () => page.evaluate(() => document.getElementById('view').textContent);

// ---------- Plan, with days in it ----------
await seed(true);
await goTo(page, 'itinerary', 400);

const firstDay = await topOf('.day-card');
const aiCard = await topOf('.plan-ai-card');
check('your days are on the plan screen at all', firstDay >= 0, String(firstDay));
check('and they come before the buttons that build them',
  firstDay >= 0 && aiCard >= 0 && firstDay < aiCard, `day at ${Math.round(firstDay)}, buttons at ${Math.round(aiCard)}`);
check('the first day is above the fold', firstDay >= 0 && firstDay < 600, `${Math.round(firstDay)}px`);
check('and the ways to build a plan are still there', aiCard >= 0 && await countOf('#autoPlanBtn') === 1 && await countOf('#tripIdeaBtn') === 1);

// ---------- Plan, with nothing in it ----------
await seed(false);
await goTo(page, 'itinerary', 400);
const emptyAi = await topOf('.plan-ai-card');
check('with no days yet, the way to make some is what you land on',
  emptyAi >= 0 && emptyAi < 400, `${Math.round(emptyAi)}px`);

// ---------- Saved ----------
await seed(true);
await goTo(page, 'picks', 400);

check('the order the list is in is still named on arrival', /by area|by day|nearest|just added/i.test(await txt()));
const orderChips = await countOf('.order-chip');
check('but it does not take four chips and a caption to say so', orderChips === 0, `${orderChips} order chips on screen`);
check('the kind filter stays, because it is the main way you cut the list',
  await countOf('[data-pick-kind-filter]') >= 2);

check('there is one control to change the order', await countOf('#sortToggle') === 1);
await page.evaluate(() => { const b = document.getElementById('sortToggle'); if (b) b.click(); });
await page.waitForTimeout(300);
check('and opening it offers every order', await countOf('.order-chip') === 4);
check('with the note explaining what each one does', /grouped by town|in the order you/i.test(await txt()));

// Changing it still works, and still says so.
await page.evaluate(() => {
  const b = document.querySelector('[data-sort="recent"]');
  if (b) b.click();
});
await page.waitForTimeout(300);
check('picking one applies it', /just added/i.test(await txt()));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
