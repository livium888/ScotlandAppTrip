// The app is careful about data it writes and trusting about data it reads.
//
// loadPlan checks that days is an array and then hands the object back
// without ever looking at items - and there are 29 unguarded plan.items[...]
// reads behind it. A plan with days and no items throws a TypeError and
// takes Today and Plan down together. That is not hypothetical: it happened
// during development, from a seed written a plausible-but-wrong way.
//
// loadPicks, the most-read data in the app, validates nothing at all.
// readJson guards parsing, not shape, so valid JSON of the wrong type comes
// straight back and every .filter on it throws.
//
// And importBackup checks the envelope - format string, version - then does
// store(k, data[k]) verbatim for every key. Its own comment says "quietly
// restoring half of it is how somebody loses a trip". That reasoning was
// applied to versions and never to content, so a file truncated in transit
// or edited by hand installs a broken state. Restore is what people reach
// for when something has ALREADY gone wrong; it must not be able to make
// things worse.
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
// Deliberately NOT failing the suite on pageerror: this suite is about what
// the app does when the data is wrong, and a thrown render is the very thing
// being tested. The checks below say whether it coped.
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|tile\.|generativelanguage/, (r) => r.abort());

const board = () => ({ activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }] });
const goodPicks = [
  { id: 'c:1', name: 'Chatsworth House', city: 'Bakewell', category: 'Attraction', lat: 53.2276, lon: -1.6104 },
  { id: 'c:2', name: 'The Old Bakery', city: 'Bakewell', category: 'Cafe', lat: 53.2129, lon: -1.6753 },
];
const seed = async (setup) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(([b, picks, s]) => {
    localStorage.clear();
    localStorage.setItem('boards-v1', JSON.stringify(b));
    localStorage.setItem('board:b:picks', JSON.stringify(picks));
    localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
    // eslint-disable-next-line no-eval
    eval(s);
  }, [board(), goodPicks, setup]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
};
const broke = () => page.evaluate(() => /Something went wrong on this screen/.test(document.getElementById('view').textContent));
const txt = () => page.evaluate(() => document.getElementById('view').textContent);

// ---------- A plan with days but no items ----------
// The exact shape that killed two screens during development.
await seed(`localStorage.setItem('board:b:plan', JSON.stringify({ days: [{ id: 'd1', label: 'Day 1 . Sun', date: '2026-09-01' }] }));`);
await goTo(page, 'today', 400);
check('a plan missing its items does not kill Today', !(await broke()), (await txt()).slice(0, 120));
await goTo(page, 'itinerary', 400);
check('nor Plan', !(await broke()), (await txt()).slice(0, 120));
check('and the day it does know about is still shown', /day 1/i.test(await txt()), (await txt()).slice(0, 120));

// ---------- A plan whose items is the wrong type entirely ----------
await seed(`localStorage.setItem('board:b:plan', JSON.stringify({ days: [{ id: 'd1', label: 'Day 1 . Sun' }], items: [] }));`);
await goTo(page, 'itinerary', 400);
check('an items of the wrong type is survived too', !(await broke()), (await txt()).slice(0, 120));

// ---------- Picks that is not a list ----------
await seed(`localStorage.setItem('board:b:picks', JSON.stringify({ nope: true }));`);
await goTo(page, 'picks', 400);
check('a picks that is not a list does not kill Saved', !(await broke()), (await txt()).slice(0, 120));
await goTo(page, 'today', 400);
check('nor Today', !(await broke()));

// ---------- Rubbish inside an otherwise fine list ----------
await seed(`localStorage.setItem('board:b:picks', JSON.stringify([null, 'a string', 42, { id: 'c:1', name: 'Chatsworth House', city: 'Bakewell', category: 'Attraction', lat: 53.2276, lon: -1.6104 }]));`);
await goTo(page, 'picks', 400);
check('junk entries are dropped rather than crashing the list', !(await broke()));
check('and the real place still shows', /chatsworth/i.test(await txt()), (await txt()).slice(0, 200));

// ---------- Restoring a broken backup ----------
await seed(`localStorage.setItem('board:b:plan', JSON.stringify({ days: [], items: {} }));`);
const restore = (data) => page.evaluate((d) => {
  const file = JSON.stringify({ format: 'scotland-trip-backup', version: 1, exportedAt: new Date().toISOString(), data: d });
  return window.__tripTest.importBackup(file);
}, data);

const bad = await restore({ 'board:b:picks': JSON.stringify({ not: 'a list' }) });
check('a backup whose picks are not a list is refused', bad && bad.ok === false, JSON.stringify(bad));
// Guarded on ok === false: without that, "Restored 0 boards, NaN places"
// matches on the word "places" and the check passes while the app is busy
// destroying the data it just claimed to restore.
check('and the refusal says what is wrong with it',
  bad && bad.ok === false && /place|list|damaged|readable/i.test(bad.message || ''), bad && bad.message);

// The important half: refusing must leave what was already here alone.
const survived = await page.evaluate(() => JSON.parse(localStorage.getItem('board:b:picks') || '[]'));
check('and nothing already on the phone was overwritten by the attempt',
  Array.isArray(survived) && survived.length === 2, JSON.stringify(survived).slice(0, 120));

const bad2 = await restore({ 'board:b:plan': JSON.stringify({ days: 'not an array' }) });
check('a backup with a malformed plan is refused too', bad2 && bad2.ok === false, JSON.stringify(bad2));

// A good file still restores, or the check above is worthless.
const good = await restore({
  'board:b:picks': JSON.stringify([{ id: 'x:1', name: 'Monsal Head', city: 'Bakewell', category: 'Attraction', lat: 53.24, lon: -1.72 }]),
  'board:b:folders': JSON.stringify(['Bakewell']),
});
check('a sound backup still restores', good && good.ok === true, JSON.stringify(good));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
await goTo(page, 'picks', 400);
check('and its contents are actually there afterwards', /monsal head/i.test(await txt()), (await txt()).slice(0, 200));

// ---------- The error card, when a screen does fail ----------
await page.evaluate(() => window.__tripTest.forceRenderFailure && window.__tripTest.forceRenderFailure());
await page.waitForTimeout(300);
if (await broke()) {
  check('a broken screen offers a way to rescue the data', await page.evaluate(() =>
    !!document.getElementById('crashBackup')));
  check('and does not claim the data is fine, which is the one thing it cannot know',
    !/saved data is untouched/i.test(await txt()), (await txt()).slice(0, 200));
} else {
  check('a render failure can be forced, so the error card can be tested', false, 'no way to force one');
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
