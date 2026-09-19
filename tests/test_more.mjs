// "I'm sure we can definitely improve the UI and user experience. It feels
// like we have everything everywhere."
//
// It did. Seven tabs along the bottom of a 390px phone, three of which — the
// kids list, the budget, notes and packing — are screens you open once a day
// at most. They cost every other screen a cramped, abbreviated tab bar all day
// long, and there was still nowhere that simply listed what the app could do:
// the map and settings were icons in the corner, boards were hidden behind
// tapping the title, and nothing said so.
//
// Five tabs, and one of them is the place the rest lives. The test that
// matters is not that the count went down — it is that nothing got harder to
// reach and nothing is now unlabelled.
import { chromium } from 'playwright';
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
await page.addInitScript(() => { localStorage.setItem('onboarded-v1', '1'); });
await page.route(/nominatim|wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis|generativelanguage/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({ activeId: 'b-m', boards: [
    { id: 'b-m', name: 'Trip', destination: 'Peak District', dated: true, hasGuide: false, createdAt: 1 },
    { id: 'b-n', name: 'Someday', destination: '', dated: false, hasGuide: false, createdAt: 2 }] }));
  localStorage.setItem('board:b-m:picks', JSON.stringify([
    { id: 'custom:Chatsworth', name: 'Chatsworth House', city: 'Bakewell', category: 'House', lat: 53.2277, lon: -1.6103, addedAt: 1 },
    { id: 'custom:Playground', name: 'Bakewell Playground', city: 'Bakewell', category: 'Playground', lat: 53.2129, lon: -1.6753, addedAt: 2 }]));
  localStorage.setItem('board:b-m:packing', JSON.stringify([
    { text: 'Waterproofs', done: true }, { text: 'Wellies', done: false }, { text: 'Snacks', done: false }]));
  // A day in the plan, so Today is a tab: it is the one that hides itself
  // when there is no plan to show, and this is the full five.
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  localStorage.setItem('board:b-m:plan', JSON.stringify({
    days: [{ id: 'd1', label: `Day 1 · ${iso}`, date: iso }], items: { d1: [] } }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

const viewText = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' ').trim());

// ---------- The bar is a bar again ----------

const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.tab'))
  .filter((t) => !t.hidden).map((t) => t.getAttribute('data-view')));
check('five tabs, not seven', tabs.length === 5, JSON.stringify(tabs));
check('and the five that earn their place are the ones there',
  ['today', 'itinerary', 'picks', 'events', 'more'].every((n) => tabs.includes(n)), JSON.stringify(tabs));

// The labels were abbreviated to fit seven. With five they can say what they
// mean, and must still fit on the narrowest phone worth supporting.
for (const width of [320, 390]) {
  await page.setViewportSize({ width, height: 780 });
  await page.waitForTimeout(200);
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('.tab'))
    .filter((t) => !t.hidden).map((t) => {
      const l = t.querySelector('.tab-label');
      return { text: l.textContent.trim(), clipped: l.scrollWidth > l.clientWidth + 1,
        lines: Math.round(l.getBoundingClientRect().height / 15) };
    }));
  check(`no label is cut off at ${width}px`, labels.every((l) => !l.clipped), JSON.stringify(labels));
  check(`nor wrapped onto a second line at ${width}px`, labels.every((l) => l.lines <= 1), JSON.stringify(labels));
}
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);

// ---------- One place that lists what the app can do ----------

await page.evaluate(() => document.querySelector('[data-view="more"]').click());
await page.waitForTimeout(300);
const more = await viewText();

check('the three screens that stopped being tabs are all listed', await page.evaluate(() =>
  ['kids', 'budget', 'tips'].every((n) => !!document.querySelector(`[data-more="${n}"]`))));
// The things that had no label anywhere: an icon in the corner, and a sheet
// you could only reach by knowing to tap the title.
check('so is the map, which used to be an unlabelled icon', await page.evaluate(() =>
  !!document.querySelector('[data-more="map"]')));
check('so are your other trips, which you had to know to tap the title for',
  await page.evaluate(() => !!document.querySelector('[data-more="boards"]')));
check('and settings', await page.evaluate(() => !!document.querySelector('[data-more="settings"]')));

// A menu of bare names tells you nothing about whether to open anything.
check('each row says what is behind it, not just its name',
  /1 of 3 packed/.test(more), more.slice(0, 400));
check('including how many trips there are', /2 saved/.test(more), more.slice(0, 400));
check('and how many places are on the map', /2 on the map/.test(more), more.slice(0, 400));

// ---------- Nothing got harder to reach ----------

await page.evaluate(() => document.querySelector('[data-more="tips"]').click());
await page.waitForTimeout(350);
check('a row opens its screen', await page.evaluate(() =>
  document.getElementById('view').dataset.activeTab === 'tips'),
  await page.evaluate(() => document.getElementById('view').dataset.activeTab));
// Landing on a screen with nothing lit is the small disorientation that makes
// an app feel like it has lost track of where you are.
check('and the tab it came from is the one lit', await page.evaluate(() =>
  document.querySelector('.tab.active')?.getAttribute('data-view') === 'more'),
  await page.evaluate(() => document.querySelector('.tab.active')?.getAttribute('data-view')));
check('the screen still names itself, now that its tab does not',
  await page.evaluate(() => /Notes/.test(document.getElementById('topbarSub').textContent)),
  await page.evaluate(() => document.getElementById('topbarSub').textContent));
check('and there is a way back that does not need the hardware button',
  await page.evaluate(() => !!document.querySelector('.sub-back')));
check('which is the first thing on the screen rather than the last',
  await page.evaluate(() => document.getElementById('view').firstElementChild?.classList.contains('sub-back')));

await page.evaluate(() => document.querySelector('.sub-back').click());
await page.waitForTimeout(300);
check('and it goes back', await page.evaluate(() =>
  document.getElementById('view').dataset.activeTab === 'more'),
  await page.evaluate(() => document.getElementById('view').dataset.activeTab));

// The two that open over the top rather than replacing the screen.
await page.evaluate(() => document.querySelector('[data-more="map"]').click());
await page.waitForTimeout(500);
check('the map opens from here', await page.evaluate(() =>
  document.getElementById('mapOverlay').classList.contains('open')));
await page.evaluate(() => document.querySelector('[data-map-close]')?.click());
await page.waitForTimeout(300);

await page.evaluate(() => document.querySelector('[data-more="boards"]').click());
await page.waitForTimeout(400);
check('and so does the list of trips', await page.evaluate(() =>
  document.getElementById('placeModal').classList.contains('open') &&
  !!document.querySelector('[data-open-board]')));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
