// Asking one question should take one panel.
//
// Setting up an event search meant: open the form, tap "Somewhere else",
// land in a modal, tap a place - which closed the modal - reopen it to set
// the distance, which closed it again, come back to the form, choose when,
// choose what, then search. The modal closed on every single tap and said
// nothing about what you had chosen, so the only record of your own choice
// was your memory of having made it.
//
// Where, how far, when and what are one question. They belong on one panel,
// with the current answer visible, and nothing closing under your thumb.
import { chromium } from 'playwright';
import { goTo, openEventForm } from './lib/screens.mjs';
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

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Peak District', destination: 'Bakewell', dated: true, createdAt: 1 }],
  }));
  // Two areas, so "somewhere you've saved" has something to offer.
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true },
    { id: 'a:2', name: 'Buxton', city: 'Buxton', category: 'Town', lat: 53.2588, lon: -1.9111, major: true },
    { id: 'c:1', name: 'Chatsworth House', city: 'Bakewell', category: 'Attraction', lat: 53.2276, lon: -1.6104 },
  ]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
await goTo(page, 'events', 400);
await openEventForm(page);

const countOf = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const txt = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
const modalOpen = () => page.evaluate(() => {
  const m = document.getElementById('placeModal');
  return !!m && m.classList.contains('open');
});
const tap = async (sel) => {
  const hit = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
  await page.waitForTimeout(350);
  return hit;
};

// ---------- Everything is on the one panel ----------
check('where to look is on the panel, not behind a modal', await countOf('[data-ev-where]') >= 2,
  `${await countOf('[data-ev-where]')} place chips`);
check('how far is on the panel too', await countOf('[data-ev-miles]') >= 3,
  `${await countOf('[data-ev-miles]')} distance chips`);
check('and so is when', await countOf('[data-ev-when]') >= 5);
check('and what to look for', await countOf('[data-ev-kind]') >= 9);
check('with one button that runs it', await countOf('#evSearch') === 1);

// ---------- The choice is shown, not remembered ----------
const before = await txt();
check('the panel says where it will look', /bakewell|buxton/i.test(before), before.slice(0, 160));
check('and how far out', /\b\d+\s*miles?\b/i.test(before), before.slice(0, 200));

// ---------- Nothing closes under your thumb ----------
check('choosing a distance does not open a modal', await tap('[data-ev-miles="50"]') && !(await modalOpen()));
check('and the panel is still open afterwards', await countOf('[data-ev-when]') >= 5);
check('and it now says the distance you chose', /50 miles/i.test(await txt()), (await txt()).slice(0, 200));

check('choosing a place keeps the panel open too', await tap('[data-ev-where="a:2"]') && await countOf('[data-ev-miles]') >= 3);
check('and says the place you chose', /buxton/i.test(await txt()), (await txt()).slice(0, 200));
check('without losing the distance you already set', /50 miles/i.test(await txt()), (await txt()).slice(0, 200));

// The awkward cases still need somewhere to go - a town that is not saved,
// where you are, a point on a map. They stay, as one row.
check('there is still a way to name somewhere not saved', await countOf('#evWhereInput') === 1);
check('and to use where you are', await countOf('#evWhereHere') === 1);

// ---------- The shared sheet had the same bug ----------
// openAnchorSheet is also how the place search picks its area, and there a
// distance tap closed the sheet just the same.
await goTo(page, 'picks', 400);
await page.evaluate(() => {
  const t = document.getElementById('pickSearchTrigger');
  if (t) t.click();
});
await page.waitForTimeout(400);
const anchorBtn = await page.evaluate(() => {
  const b = document.querySelector('[data-anchor-open]');
  if (b) { b.click(); return true; }
  return false;
});
if (anchorBtn) {
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const m = document.querySelector('[data-anchor-miles="50"]');
    if (m) m.click();
  });
  await page.waitForTimeout(400);
  check('the shared sheet stays open when you change the distance', await modalOpen());
  check('and marks the distance you picked', await page.evaluate(() =>
    !!document.querySelector('[data-anchor-miles="50"].active')));
} else {
  console.log('SKIP: no anchor button on the search overlay in this build');
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
