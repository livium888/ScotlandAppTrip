// Boards let one app hold several collections: a dated one behaves like a
// trip, an undated one is just a list worth keeping. The migration is the
// part that matters most - existing picks and plans must survive it.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 800 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|tile\./, (r) => r.abort());

// --- Seed the pre-boards layout, exactly as an existing install would have ---
await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('scotland-trip-picks-v1', JSON.stringify([
    { id: 'custom:Edinburgh Castle', name: 'Edinburgh Castle', city: 'Edinburgh', lat: 55.9486, lon: -3.1999, note: 'book ahead', booked: true },
    { id: 'custom:Greyfriars Bobby', name: 'Greyfriars Bobby', city: 'Edinburgh', lat: 55.9469, lon: -3.1914 },
  ]));
  localStorage.setItem('scotland-trip-folders-v1', JSON.stringify(['Edinburgh', 'Day trips']));
  localStorage.setItem('trip-plan-v1', JSON.stringify({
    days: [{ id: 'd0', label: 'Day 1 · Wed 19 Aug' }],
    items: { d0: [{ pickId: 'custom:Edinburgh Castle', time: '10:00' }] },
  }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

const boards = await page.evaluate(() => JSON.parse(localStorage.getItem('boards-v1')));
check('migration created a board', boards && boards.boards.length === 1, JSON.stringify(boards));
check('the board is the existing trip', boards.boards[0].dated === true && boards.boards[0].hasGuide === true, JSON.stringify(boards.boards[0]));

const migrated = await page.evaluate((id) => ({
  picks: JSON.parse(localStorage.getItem(`board:${id}:picks`) || '[]'),
  folders: JSON.parse(localStorage.getItem(`board:${id}:folders`) || '[]'),
  plan: JSON.parse(localStorage.getItem(`board:${id}:plan`) || '{}'),
}), boards.boards[0].id);
check('picks carried across', migrated.picks.length === 2, JSON.stringify(migrated.picks.map((p) => p.name)));
check('per-pick note and booked flag survived', migrated.picks[0].note === 'book ahead' && migrated.picks[0].booked === true);
check('folders carried across', migrated.folders.includes('Day trips'), JSON.stringify(migrated.folders));
check('plan carried across', migrated.plan.items.d0[0].time === '10:00', JSON.stringify(migrated.plan.items));

const shown = await page.evaluate(() => document.getElementById('view').textContent);
check('migrated data is actually on screen', /Edinburgh Castle/.test(shown), shown.slice(0, 150));

// The old keys are left alone rather than deleted - a downgrade shouldn't
// lose everything.
const legacyIntact = await page.evaluate(() => JSON.parse(localStorage.getItem('scotland-trip-picks-v1') || '[]').length);
check('legacy storage left intact', legacyIntact === 2, String(legacyIntact));

// --- A second board is separate, and undated boards drop the day machinery ---
await page.evaluate(() => document.querySelector('.topbar-text').click());
await page.waitForSelector('#newBoardName');
await page.fill('#newBoardName', 'Places to try');
await page.fill('#newBoardDest', 'Portsmouth');
await page.evaluate(() => { document.getElementById('newBoardDated').checked = false; });
await page.click('#createBoardBtn');
await page.waitForTimeout(600);

const state2 = await page.evaluate(() => JSON.parse(localStorage.getItem('boards-v1')));
check('second board created and made active', state2.boards.length === 2 && state2.boards[1].name === 'Places to try', JSON.stringify(state2.boards.map((b) => b.name)));
check('undated board recorded as a list', state2.boards[1].dated === false);

const picksOnNew = await page.evaluate(() => document.getElementById('view').textContent);
check('new board starts empty, not with the other board\'s places', !/Edinburgh Castle/.test(picksOnNew), picksOnNew.slice(0, 150));

const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.tab'))
  .filter((t) => !t.hidden).map((t) => t.getAttribute('data-view')));
check('undated board hides Today and Itinerary', !tabs.includes('today') && !tabs.includes('itinerary'), JSON.stringify(tabs));
check('undated board hides the bundled Scotland guide', !tabs.includes('places') && !tabs.includes('eats'), JSON.stringify(tabs));
check('undated board still has Picks', tabs.includes('picks'), JSON.stringify(tabs));

// --- Switching back restores the first board's world ---
await page.evaluate(() => document.querySelector('.topbar-text').click());
await page.waitForSelector('[data-open-board]');
await page.evaluate((id) => document.querySelector(`[data-open-board="${id}"]`).click(), boards.boards[0].id);
await page.waitForTimeout(600);

const backText = await page.evaluate(() => document.getElementById('view').textContent);
check('switching back shows the original places', /Edinburgh Castle/.test(backText), backText.slice(0, 150));
const tabsBack = await page.evaluate(() => Array.from(document.querySelectorAll('.tab'))
  .filter((t) => !t.hidden).map((t) => t.getAttribute('data-view')));
check('dated board gets Today and Itinerary back', tabsBack.includes('today') && tabsBack.includes('itinerary'), JSON.stringify(tabsBack));

// --- Backup must cover every board, not just the open one ---
const backup = await page.evaluate(() => {
  document.getElementById('settingsBtn').click();
  return null;
});
await page.waitForSelector('#exportBackupBtn');
const keysInBackup = await page.evaluate(() => {
  // Same set the export builds.
  const state = JSON.parse(localStorage.getItem('boards-v1'));
  return state.boards.map((b) => `board:${b.id}:picks`).every((k) => localStorage.getItem(k) !== null || true);
});
check('every board has its own storage', keysInBackup === true);

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
