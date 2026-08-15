// A place you add yourself has to be usable everywhere, not just in Picks:
// it should appear under Places or Eats on its own merits, be schedulable
// into an itinerary, carry a cost into the Budget, and count on the Trip
// screen. This walks one manually added place through all of it on a board
// that has none of the bundled Scotland content.
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

const tab = async (name) => {
  await page.evaluate((t) => document.querySelector(`[data-view="${t}"]`).click(), name);
  await page.waitForTimeout(250);
};
// Places and Eats stopped being destinations and became a filter on the one
// list they always read from.
const kindFilter = async (kind) => {
  await tab('picks');
  await page.evaluate((k) => {
    const b = document.querySelector(`[data-pick-kind-filter="${k}"]`);
    if (b) b.click();
  }, kind);
  await page.waitForTimeout(250);
};
const text = () => page.evaluate(() => document.getElementById('view').textContent);

// A board of the user's own making, with places added by hand - one to see,
// one to eat at, one the app will have to guess about.
await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-own',
    boards: [{ id: 'b-own', name: 'Lake District', destination: 'Cumbria', dated: false, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('board:b-own:picks', JSON.stringify([
    { id: 'custom:Castlerigg Stone Circle', name: 'Castlerigg Stone Circle', city: 'Keswick', category: 'Attraction', lat: 54.6027, lon: -3.0983 },
    { id: 'custom:The Dog and Gun', name: 'The Dog and Gun', city: 'Keswick', category: 'Pub', lat: 54.6013, lon: -3.1367 },
    { id: 'custom:Booths', name: 'Booths', city: 'Keswick', category: 'Supermarket', lat: 54.6005, lon: -3.1345 },
  ]));
  localStorage.setItem('board:b-own:folders', JSON.stringify(['Keswick']));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);

// --- The kind filter splits what you saved, sensibly ---
await kindFilter('place');
const placesText = await text();
check('a manually added attraction appears under To do', /Castlerigg Stone Circle/.test(placesText), placesText.slice(0, 200));
check('a pub is not filed as a place to go', !/Dog and Gun/.test(placesText), placesText.slice(0, 200));
check('an unrelated category still lands under To do', /Booths/.test(placesText), placesText.slice(0, 200));

await kindFilter('eat');
const eatsText = await text();
check('the pub appears under Eat', /Dog and Gun/.test(eatsText), eatsText.slice(0, 200));
check('the stone circle is not offered as dinner', !/Castlerigg/.test(eatsText), eatsText.slice(0, 200));

// The guess is overridable from the place's own sheet.
await kindFilter('place');
await page.evaluate(() => Array.from(document.querySelectorAll('[data-open-pick]'))
  .find((r) => /Booths/.test(r.textContent)).click());
await page.waitForSelector('#placeModal.open [data-pick-kind]', { timeout: 3000 });
await page.evaluate(() => document.querySelector('[data-pick-kind$="|eat"]').click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await kindFilter('eat');
check('a place can be moved to Eats by hand', /Booths/.test(await text()), (await text()).slice(0, 200));
await kindFilter('place');
check('and leaves Places when it does', !/Booths/.test(await text()), (await text()).slice(0, 200));

// --- The itinerary works without dates, on a board of your own ---
await tab('itinerary');
check('no bundled Scotland itinerary is offered here', !(await page.evaluate(() =>
  !!document.querySelector('[data-plan-mode="suggested"]'))));
check('an empty plan says how to start', /No days yet/.test(await text()), (await text()).slice(0, 160));

await page.evaluate(() => document.querySelector('[data-quick-day="Day 1"]').click());
await page.waitForTimeout(400);
const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('board:b-own:plan')));
check('a day can be added without any dates', plan.days.length === 1 && plan.days[0].label === 'Day 1', JSON.stringify(plan.days));

await page.evaluate(() => Array.from(document.querySelectorAll('[data-plan-add]'))
  .find((b) => /Castlerigg/.test(b.textContent)).click());
await page.waitForTimeout(400);
const plan2 = await page.evaluate(() => JSON.parse(localStorage.getItem('board:b-own:plan')));
check('a manually added place can be scheduled', (plan2.items.d1 || plan2.items[Object.keys(plan2.items)[0]] || []).length === 1, JSON.stringify(plan2.items));

const tabsNow = await page.evaluate(() => Array.from(document.querySelectorAll('.tab'))
  .filter((t) => !t.hidden).map((t) => t.getAttribute('data-view')));
check('Today appears once the board has a day', tabsNow.includes('today'), JSON.stringify(tabsNow));

await tab('today');
check('Today shows the plan you built', /Castlerigg/.test(await text()), (await text()).slice(0, 200));

// --- Budget is your places, priced ---
await tab('budget');
const budgetText = await text();
check('every saved place is listed in the budget', /Castlerigg/.test(budgetText) && /Dog and Gun/.test(budgetText), budgetText.slice(0, 200));
check('no Scotland estimate on a board that never had one', !/Wallace Monument|Estimated budget|Scotland estimate/i.test(budgetText), budgetText.slice(0, 200));

await page.evaluate(() => {
  const input = document.querySelector('[data-pick-cost]');
  input.value = '12';
  input.dispatchEvent(new Event('blur'));
});
await page.waitForTimeout(400);
check('a cost sticks to the place', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('board:b-own:picks')).some((p) => p.cost === 12)));
check('and shows in the total', /£12/.test(await text()), (await text()).slice(0, 120));

await page.fill('#budgetAddItem', 'Train tickets');
await page.fill('#budgetAddAmount', '48');
await page.evaluate(() => document.getElementById('budgetAddForm').requestSubmit());
await page.waitForTimeout(400);
check('costs that are not places can be added too', /Train tickets/.test(await text()));
check('the total adds both kinds', /£60/.test(await text()), (await text()).slice(0, 120));

// --- Tips is per board: your own list, your own notes ---
await tab('tips');
const tipsText = await text();
check('no Scotland advice on this board', !/Cramond|Good to know in Scotland/i.test(tipsText), tipsText.slice(0, 160));
await page.fill('#packingAddInput', 'walking boots');
await page.evaluate(() => document.getElementById('packingAddForm').requestSubmit());
await page.waitForTimeout(300);
check('packing list takes your own items', /walking boots/.test(await text()));
await page.evaluate(() => document.querySelector('.packing-list li').click());
await page.waitForTimeout(300);
check('items can be ticked off', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('board:b-own:packing'))[0].done === true));

await page.evaluate(() => {
  const box = document.getElementById('boardNotes');
  box.value = 'flat code 4821';
  box.dispatchEvent(new Event('blur'));
});
await page.waitForTimeout(300);
check('notes are saved against the board', await page.evaluate(() =>
  /4821/.test(localStorage.getItem('board:b-own:notes') || '')));

// --- The board's own facts, on the screens that own them ---
// The Trip tab used to restate all of this in one place; it counted things you
// can read on the screen where they matter, and the space went to the kids
// list. What it was checking still has to be true.
check('the board is named at the top, whichever screen you are on', await page.evaluate(() =>
  /Lake District/.test(document.getElementById('topbarTitle').textContent)),
  await page.evaluate(() => document.getElementById('topbarTitle').textContent));
await tab('itinerary');
const planText = await text();
check('the itinerary shows the days you made', /Day 1/.test(planText), planText.slice(0, 300));
check('and can be shared as a whole', await page.evaluate(() => !!document.getElementById('shareTrip')));
await tab('budget');
const boardBudget = await text();
check('the budget carries through', /£60/.test(boardBudget), boardBudget.slice(0, 300));
await tab('picks');
const picksText = await text();
check('no Fringe blurb on a Cumbrian board', !/Fringe/.test(picksText), picksText.slice(0, 200));

// Eats are still reachable from the place list.
await page.evaluate(() => {
  const el = document.querySelector('[data-goto="eats"]') || document.querySelector('[data-pick-kind-filter="eat"]');
  if (el) el.click();
});
await page.waitForTimeout(300);
check('tapping a stat takes you to that tab', /Dog and Gun/.test(await text()));

// --- The Scotland board keeps everything it had ---
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('boards-v1'));
  state.boards.push({ id: 'b-scotland', name: 'Scotland with Ally', destination: 'Scotland', dated: true, hasGuide: true, createdAt: 2 });
  state.activeId = 'b-scotland';
  localStorage.setItem('boards-v1', JSON.stringify(state));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await kindFilter('place');
// The guide moved into Picks and is collapsed until asked for - it is
// suggestions, not your list, so it no longer occupies a screen of its own.
check('the Scotland board still offers its guide', await page.evaluate(() => !!document.getElementById('guideToggle')));
check('but it is folded away until wanted', !/Edinburgh Castle/.test(await text()), (await text()).slice(0, 200));
await page.evaluate(() => document.getElementById('guideToggle').click());
await page.waitForTimeout(300);
check('the Scotland board still has its guide', /Edinburgh Castle/.test(await text()), (await text()).slice(0, 200));
await tab('itinerary');
check('and still offers the suggested itinerary', await page.evaluate(() =>
  !!document.querySelector('[data-plan-mode="suggested"]')));
await tab('tips');
check('and still has the Scotland advice', /Cramond tide safety/.test(await text()), (await text()).slice(0, 200));
check('with the bundled packing list seeded in', await page.evaluate(() =>
  (JSON.parse(localStorage.getItem('board:b-scotland:packing')) || []).length > 3));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
