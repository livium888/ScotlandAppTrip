// A screen should open on your stuff, not on the machinery for getting it.
//
// What's on opened on 27 tappable controls and 844 pixels of pure control
// panel - five "when" chips, nine "what" chips, nine pencils, "Somewhere
// else", "all 9" and a button - before a single event. The panel already
// knew how to collapse: it did so the moment a search finished. It just
// never started that way, so the one moment you most need orientation is
// the one moment the app gives you a form.
//
// The pencils are the other half. They edit the prompt sent to the model -
// a genuine power feature - and they sat at exactly the same visual weight
// as "Today". Nine of them, always.
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

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Lake District', destination: 'Keswick', dated: true, createdAt: 1 }],
  }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'c:1', name: 'Castlerigg Stone Circle', city: 'Keswick', category: 'Attraction', lat: 54.6027, lon: -3.0983 },
  ]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Keswick']));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
await goTo(page, 'events', 400);

const taps = () => page.evaluate(() =>
  [...document.getElementById('view').querySelectorAll('button, a, input, select, textarea')]
    .filter((el) => el.offsetParent !== null).length);
const txt = () => page.evaluate(() => document.getElementById('view').textContent);
const has = (sel) => page.evaluate((s) => !!document.querySelector(s), sel);
const countOf = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
// Tolerant on purpose: run against the unfixed code, a missing button should
// fail the check that names it and let the rest of the suite report, rather
// than throwing and printing nothing at all.
const tap = async (sel) => {
  const hit = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
  await page.waitForTimeout(300);
  return hit;
};

// --- Arriving on the screen ---
const idleTaps = await taps();
check('arriving on What\'s on does not open a control panel', idleTaps <= 10, `${idleTaps} tappable controls`);

check('the thing you came to do is the obvious button', await has('#evSearch'));

// The primary action has to be reachable without scrolling on a 390x844
// phone. It was at roughly 800px, under the fold on anything smaller.
const btnTop = await page.evaluate(() => {
  const b = document.getElementById('evSearch');
  return b ? b.getBoundingClientRect().top : 99999;
});
check('and it is above the fold', btnTop < 700, `${Math.round(btnTop)}px from the top`);

// The summary has to answer both halves of "what am I about to ask for":
// where, and over what period. Which period depends on whether the board has
// dates, so this checks that one is named rather than naming one of them.
const summary = await page.evaluate(() => {
  const el = document.querySelector('.ev-asked');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
});
check('the summary says where it will look', /keswick/i.test(summary), summary);
check('and over what period', /week|weekend|today|tomorrow|day|while you're there|\d/i.test(summary), summary);
check('and what kinds of thing', /everything|music|market/i.test(summary), summary);

// The chips are not gone, only folded away.
check('the when chips are not on screen until asked for', await countOf('[data-ev-when]') === 0);
check('nor the nine kind chips', await countOf('[data-ev-kind]') === 0);
check('nor the nine prompt pencils', await countOf('[data-ev-tune]') === 0);

// --- Opening the panel ---
check('the summary bar is what you tap to change it', await tap('#evEdit'));

check('tapping the summary opens the full form', await countOf('[data-ev-when]') >= 5);
check('and every kind is there once open', await countOf('[data-ev-kind]') >= 9);

// Nine pencils inside an already-busy form is the same mistake one level
// down, so they get their own disclosure.
check('the pencils stay folded even inside the open form', await countOf('[data-ev-tune]') === 0);
check('but there is a way to reach them', await has('#evTuneToggle'));

await tap('#evTuneToggle');
check('opening it reveals one pencil per kind', await countOf('[data-ev-tune]') >= 9);

// --- It still does the job ---
await tap('[data-ev-kind="music"]');
check('choosing a kind still registers', await page.evaluate(() =>
  !!document.querySelector('[data-ev-kind="music"].on')));

// The panel folds again once you have asked, which is what it always did.
check('the form can be closed again without searching', await has('#evAskDone'));
await tap('#evAskDone');
check('and folding it returns you to the summary', await countOf('[data-ev-when]') === 0);
check('with the choice you just made shown on it', /music/i.test(await txt()));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
