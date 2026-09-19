// A search is three questions, and it was asking five.
//
// This form greeted you with where, how far, when, what kind, and how the
// prompt should be phrased - all at the same visual weight, on one slab 1721
// pixels tall with 34 controls on it. Nine prompt editors sat level with
// "Today". Earlier in this same session a 27-control panel was removed for
// being exactly this, and what replaced it grew bigger than the thing it
// replaced. Putting a control panel behind a button is not simplifying it.
//
// The one thing that constrains the fix: the nine kinds are not decoration
// and not a filter. Each selected kind is one request to the model, so
// narrowing before searching saves real money. They stay a choice made
// before the search - they just stop being nine chips on the front page.
import { chromium } from 'playwright';
import { goTo, openEventForm, openWhatSheet, openWhenSheet, openWhereSheet } from './lib/screens.mjs';
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
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|tile\.|generativelanguage|photon/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Peak District', destination: 'Bakewell', dated: true, createdAt: 1 }],
  }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true },
    { id: 'a:2', name: 'Buxton', city: 'Buxton', category: 'Town', lat: 53.2588, lon: -1.9111, major: true },
  ]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
await goTo(page, 'events', 400);
await openEventForm(page);

const formControls = () => page.evaluate(() => {
  const card = document.querySelector('.ev-ask');
  if (!card) return null;
  return [...card.querySelectorAll('button, a[href], input, select, textarea')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30) || el.id || el.tagName);
});
const countOf = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const sheetText = () => page.evaluate(() => {
  const m = document.getElementById('placeModal');
  return m && m.classList.contains('open') ? m.textContent.replace(/\s+/g, ' ') : '';
});
const closeSheet = async () => {
  await page.evaluate(() => {
    const b = document.querySelector('#placeModal .modal-close');
    if (b) b.click();
  });
  await page.waitForTimeout(300);
};

// ---------- The form itself ----------
const controls = await formControls();
check('the form exists', controls !== null);
check('and asks three questions, not five', controls !== null && controls.length <= 6,
  `${controls ? controls.length : '-'} controls: ${(controls || []).join(' | ')}`);

const rowText = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-ev-ask]')];
  return rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim());
});
check('there is a row for each question', await countOf('[data-ev-ask]') === 3,
  JSON.stringify(await rowText()));

// A label alone is a form. A label with its answer is a sentence you can
// check before spending quota on it.
const rows = await rowText();
check('the where row says where', /bakewell|buxton|nearby/i.test(rows.join(' ')), JSON.stringify(rows));
check('the when row says when', /week|weekend|today|tomorrow|day/i.test(rows.join(' ')), JSON.stringify(rows));
check('the what row says what', /everything|kind|\d/i.test(rows.join(' ')), JSON.stringify(rows));

// ---------- Nothing was thrown away ----------
await openWhereSheet(page);
const where = await sheetText();
check('where still offers the saved areas', /bakewell/i.test(where) && /buxton/i.test(where), where.slice(0, 200));
check('and where you are, and a point on a map', /where i am/i.test(where) && /point at it/i.test(where), where.slice(0, 200));
check('and how far out', await countOf('#placeModal [data-ev-miles]') >= 4,
  String(await countOf('#placeModal [data-ev-miles]')));
check('and the journey mode', await countOf('#placeModal [data-ev-mode="route"]') === 1);
await page.evaluate(() => { const b = document.querySelector('#placeModal [data-ev-mode="route"]'); if (b) b.click(); });
await page.waitForTimeout(350);
check('which offers both ends and a corridor width',
  await countOf('#placeModal #evRouteFrom') === 1 && await countOf('#placeModal #evRouteTo') === 1 &&
  await countOf('#placeModal [data-ev-corridor]') >= 3);
await page.evaluate(() => { const b = document.querySelector('#placeModal [data-ev-mode="point"]'); if (b) b.click(); });
await page.waitForTimeout(350);
await closeSheet();

await openWhenSheet(page);
check('when still offers every window', await countOf('#placeModal [data-ev-when]') >= 6,
  String(await countOf('#placeModal [data-ev-when]')));
await closeSheet();

await openWhatSheet(page);
check('what still offers all nine kinds', await countOf('#placeModal [data-ev-kind]') === 9,
  String(await countOf('#placeModal [data-ev-kind]')));
// The reason narrowing exists at all, finally with room to be said.
check('and explains that narrowing saves requests', /request/i.test(await sheetText()),
  (await sheetText()).slice(0, 300));

// ---------- Choosing in a sheet updates the row behind it ----------
await page.evaluate(() => {
  const b = document.querySelector('#placeModal [data-ev-kind="music"]');
  if (b) b.click();
});
await page.waitForTimeout(350);
await closeSheet();
const after = await rowText();
check('narrowing shows on the What row', /music|1 /i.test(after.join(' ')), JSON.stringify(after));

// ---------- And the form has not quietly regrown ----------
const controlsAfter = await formControls();
check('the form is still three questions afterwards', controlsAfter !== null && controlsAfter.length <= 6,
  `${controlsAfter ? controlsAfter.length : '-'}: ${(controlsAfter || []).join(' | ')}`);

// ---------- The prompt editors are off the search path ----------
check('no prompt editors on the form', await countOf('.ev-ask [data-ev-tune]') === 0);
await openWhatSheet(page);
check('nor in the What sheet', await countOf('#placeModal [data-ev-tune]') === 0);
await closeSheet();
check('they are in Settings instead', await page.evaluate(async () => {
  if (!window.__tripTest || !window.__tripTest.openSettings) return false;
  window.__tripTest.openSettings();
  await new Promise((r) => setTimeout(r, 400));
  return document.querySelectorAll('[data-ev-tune]').length === 9;
}));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
