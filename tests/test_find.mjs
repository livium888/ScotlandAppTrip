// One question, one place to ask it.
//
// The app had four ways to find something you had not already saved, and
// they lived in three different tabs: dated events in the What's on tab,
// "Explore around a place" folded inside Saved, and "Suggest a trip" as a
// button inside Plan. Nothing told you which one answered which question, so
// finding out what you could do meant remembering where the app had put that
// particular kind of finding.
//
// They belong together. Two rules shape how:
//   - Dated events stay one tap away. They are the common case, and paying a
//     tap on every visit to tidy a menu is a bad trade.
//   - Saved goes back to being only what you saved.
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
    { id: 'c:2', name: 'The Dog and Gun', city: 'Keswick', category: 'Pub', lat: 54.6013, lon: -3.1367 },
  ]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Keswick']));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

const countOf = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const txt = () => page.evaluate(() => document.getElementById('view').textContent);
const tap = async (sel) => {
  const hit = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
  await page.waitForTimeout(400);
  return hit;
};

// ---------- The tab holds more than events now, and says so ----------
const tabLabel = await page.evaluate(() => {
  const t = document.querySelector('[data-view="events"] .tab-label');
  return t ? t.textContent.trim() : '';
});
check('the tab is named for the question, not one answer to it', /find/i.test(tabLabel), tabLabel);

// ---------- Events are still one tap ----------
await goTo(page, 'events', 400);
check('and it still lands straight on dated things, not a menu',
  await countOf('#evSearch') === 1 || await countOf('.ev-asked') === 1);

// ---------- The other two ways are here too ----------
check('the other ways to look are on the same screen',
  await countOf('[data-find="explore"]') === 1 && await countOf('[data-find="idea"]') === 1,
  `explore:${await countOf('[data-find="explore"]')} idea:${await countOf('[data-find="idea"]')}`);
check('and they are below the events, not above them', await page.evaluate(() => {
  const ev = document.querySelector('.ev-asked, #evSearch');
  const other = document.querySelector('[data-find="explore"]');
  if (!ev || !other) return false;
  return ev.getBoundingClientRect().top < other.getBoundingClientRect().top;
}));

// ---------- Saved is only what you saved ----------
await goTo(page, 'picks', 400);
check('Explore is no longer folded inside Saved', await countOf('#exploreToggle') === 0);
check('and Saved still shows what you saved', /castlerigg/i.test(await txt()));

// ---------- Explore still works, on its own screen ----------
await goTo(page, 'events', 400);
check('exploring is reachable from Find', await tap('[data-find="explore"]'));
check('and it opens the explore screen', /around|where i am|point on a map/i.test(await txt()), (await txt()).slice(0, 120));
check('with its controls present', await countOf('#exploreGpsBtn') === 1);

// Choosing a centre must redraw the screen it is actually on, not the Saved
// screen it used to live in - that was six hard-coded renderPicks() calls.
await page.evaluate(() => {
  if (window.__tripTest && window.__tripTest.setExploreCentre) {
    window.__tripTest.setExploreCentre({ name: 'Keswick', lat: 54.60, lon: -3.13 });
  }
});
await page.waitForTimeout(400);
check('and picking a centre updates this screen rather than another one',
  /around/i.test(await txt()) && await countOf('#exploreGpsBtn') === 1, (await txt()).slice(0, 140));

// ---------- Back out ----------
check('Find is the lit tab while you are on one of its screens', await page.evaluate(() =>
  !!document.querySelector('[data-view="events"].active')));

// The back link used to spell its own label, with "More" special-cased,
// which was fine while More was the only parent. The moment Find became one
// too it read "events" - a raw view key, on screen, to a person. It reads
// the tab now, so the two cannot disagree.
const back = await page.evaluate(() => {
  const b = document.querySelector('.sub-back');
  return b ? b.textContent.trim() : '';
});
check('the way back is named the way the tab is', back === 'Find', back);
check('and never shows an internal view key', !/^(events|picks|itinerary|explore|usage|tips)$/i.test(back), back);

// This screen has no search field - that is on Saved - so it must not tell
// anyone to use one.
const exploreText = await txt();
check('it does not point at a search field that is not on this screen',
  !/search at the top of the screen/i.test(exploreText));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
