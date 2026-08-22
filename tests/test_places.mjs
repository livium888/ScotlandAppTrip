// The Places tab (now the Picks list, since Places and Eats became a filter
// on it rather than tabs of their own) had two kinds of entry side by side:
// saved places as rows that opened a sheet, and bundled guide entries as tall
// cards where only a small ♥ responded to a tap - eleven of which did nothing
// at all when tapped. There was also no way to order any of it.
//
// The bundled guide has since been removed with the trip it described, so
// half of that is history. What is left is the half that still matters and
// still regresses: every entry on the screen responds to a tap, the list can
// be ordered, and folders separate it rather than filtering it.
//
// These checks drive the real controls rather than reading the DOM, because
// "the handler is attached" and "tapping it does something" turned out to be
// different questions.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 820 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.route(/nominatim\.openstreetmap\.org/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '55.9486', lon: '-3.1999', display_name: 'Edinburgh Castle, Edinburgh', type: 'castle',
    namedetails: { name: 'Edinburgh Castle' }, address: { city: 'Edinburgh' }, extratags: {} }]) }));
await page.route(/wikidata|wikipedia|overpass|googleapis|open-meteo|photon|tile\./, (r) => r.abort());

const names = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.pick-row .pick-row-name')).map((e) => e.textContent.trim()));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  // The board the problem showed up on.
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-p', boards: [{ id: 'b-p', name: 'Trip', destination: 'Edinburgh', dated: true, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('board:b-p:folders', JSON.stringify(['Edinburgh', 'Stirling']));
  localStorage.setItem('board:b-p:picks', JSON.stringify([
    { id: 'custom:Zoo', name: 'Edinburgh Zoo', city: 'Edinburgh', category: 'Zoo', lat: 55.9426, lon: -3.2686, addedAt: 100 },
    { id: 'custom:Castle', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999, addedAt: 200 },
    { id: 'custom:Arthur', name: "Arthur's Seat", city: 'Edinburgh', category: 'Hill', lat: 55.9444, lon: -3.1618, addedAt: 300 },
    { id: 'custom:Wallace', name: 'Wallace Monument', city: 'Stirling', category: 'Monument', lat: 56.1385, lon: -3.92, addedAt: 400 },
  ]));
  localStorage.setItem('board:b-p:plan', JSON.stringify({
    days: [{ id: 'd1', label: 'Day 1 · Wed 19 Aug' }],
    items: { d1: [{ pickId: 'custom:Castle', time: '10:00' }] },
  }));
});
await page.reload({ waitUntil: 'load' });
const openPicks = async () => {
  await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
  await page.waitForTimeout(400);
};
await openPicks();

// --- Every entry on the screen responds to a tap ---
const dead = await page.evaluate(() => {
  // Anything that looks like an entry but has no way to open it.
  const rows = Array.from(document.querySelectorAll('.pick-row'));
  return rows.filter((r) => !r.matches('[data-open-pick]') && !r.querySelector('[data-open-pick]')).length;
});
check('no entry on the screen is dead to a tap', dead === 0, `${dead} dead rows`);

// A real click on a saved row, the way a finger does it.
const firstRowName = (await names())[0];
await page.click('.pick-row');
await page.waitForSelector('#placeModal.open', { timeout: 3000 });
check('a saved place opens the place you tapped', await page.evaluate((n) =>
  document.querySelector('.modal-title').textContent.trim() === n, firstRowName), firstRowName);
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.waitForTimeout(300);

// The sheet a row opens is the place you tapped, and it offers the things you
// do to a place rather than being a dead end.
const sheet = await page.evaluate(() => document.getElementById('placeModal').textContent);
check('and the sheet is about that place, with something to do in it',
  /Remove|Add to a day|Directions|Explore/i.test(sheet), sheet.slice(0, 200));
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.waitForTimeout(300);

// --- Sorting ---
const sorts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-sort]')).map((b) => b.textContent.trim()));
check('the list can be ordered', sorts.length >= 3, JSON.stringify(sorts));

// A–Z stopped being a mode of its own when ordering and grouping became one
// decision: it is how every grouped list is sorted inside its section, so the
// question is now whether "By area" is alphabetical within a town.
await page.evaluate(() => document.querySelector('[data-sort="area"]').click());
await page.waitForTimeout(300);
const perSection = await page.evaluate(() => {
  // Saved rows only.
  const out = [];
  let current = null;
  document.querySelectorAll('#view .section-label, #view button.pick-row').forEach((el) => {
    if (el.classList.contains('pick-row')) {
      if (current) current.push(el.querySelector('.pick-row-name').textContent.trim());
    } else {
      current = [];
      out.push(current);
    }
  });
  return out.filter((s) => s.length > 1);
});
check('by area sorts alphabetically inside each area',
  perSection.every((s) => JSON.stringify(s) === JSON.stringify([...s].sort((a, b) => a.localeCompare(b, 'en-GB')))),
  JSON.stringify(perSection));

await page.evaluate(() => document.querySelector('[data-sort="near"]').click());
await page.waitForTimeout(400);
const near = await names();
check('Nearest puts the closest first', near[0] === 'Edinburgh Castle', JSON.stringify(near.slice(0, 3)));
check('and Stirling last', near[near.length - 1] === 'Wallace Monument', JSON.stringify(near));
check('distances are shown when sorting by them, in miles', /\d+(\.\d+)?\s*(mi|yd)/.test(
  await page.evaluate(() => document.getElementById('view').textContent)));

await page.evaluate(() => document.querySelector('[data-sort="day"]').click());
await page.waitForTimeout(300);
check('By day puts the scheduled place first', (await names())[0] === 'Edinburgh Castle', JSON.stringify(await names()));

// The choice sticks, rather than resetting every time you come back.
await page.reload({ waitUntil: 'load' });
await openPicks();
check('the chosen order is remembered', await page.evaluate(() =>
  !!document.querySelector('[data-sort="day"].on')));

// --- Folders separate the list instead of filtering it ---
// The folder chips went with the tab. Every folder is a heading on one
// screen now, which answers the same question - what is where - without
// hiding the rest of the list to do it.
//
// Under "by day" the headings are days, because the order chosen decides the
// sections as well as the rows - that is the point of the control. So this
// asks the question in the order the question belongs to.
await page.evaluate(() => document.querySelector('[data-sort="area"]').click());
await page.waitForTimeout(300);
const sections = await page.evaluate(() =>
  // A heading now carries a fold caret and a count alongside its label, so
  // the whitespace between them has to come out before comparing.
  Array.from(document.querySelectorAll('.section-label, .area-head-name')).map((e) =>
    e.textContent.replace(/\s+/g, ' ').replace(/\s*\d+\s*$/, '').trim()));
check('every folder is a heading of its own', sections.includes('Edinburgh') && sections.includes('Stirling'), JSON.stringify(sections));
// Everything saved is on screen at once - counted against storage rather than
// a literal, since the list is added to as this run goes on.
const savedCount = await page.evaluate(() => JSON.parse(localStorage.getItem('board:b-p:picks')).length);
check('and nothing is hidden to achieve it', (await names()).length === savedCount, `${(await names()).length} shown of ${savedCount}`);

// --- Places and eats share the screen, told apart by a filter ---
// This was two tabs and is now one list, which is only an improvement if the
// filter genuinely separates them.
await page.evaluate(() => {
  const picks = JSON.parse(localStorage.getItem('board:b-p:picks'));
  picks.push({ id: 'custom:Chippy', name: 'The Fish Bar', city: 'Edinburgh', category: 'Fish and chips',
    kind: 'eat', lat: 55.95, lon: -3.19, addedAt: 500 });
  localStorage.setItem('board:b-p:picks', JSON.stringify(picks));
});
await page.reload({ waitUntil: 'load' });
await openPicks();
check('somewhere to eat and somewhere to go are both on the one list',
  (await names()).includes('The Fish Bar') && (await names()).includes('Edinburgh Zoo'),
  JSON.stringify(await names()));
const eatFilter = await page.evaluate(() => !!document.querySelector('[data-pick-kind-filter="eat"]'));
check('and there is a filter to tell them apart', eatFilter);
if (eatFilter) {
  await page.evaluate(() => document.querySelector('[data-pick-kind-filter="eat"]').click());
  await page.waitForTimeout(400);
  const eats = await names();
  check('which shows only the places to eat', eats.includes('The Fish Bar') && !eats.includes('Edinburgh Zoo'),
    JSON.stringify(eats));
}

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
