// Three tabs: Trip, Find, Saved.
//
// "It's great, but there are so many options, it's ridiculous." Five tabs,
// two of which were one thing at different times - Plan before the trip and
// Today during it - and a fifth, More, that was a drawer: three screens that
// belong to a trip, two things already in the top bar (the map, your other
// trips), settings, and an engineer's page about token counts.
//
// Trip is the plan before you go and the day's stops while you are there,
// with a switch between the two. What was in More now sits where it belongs.
// The test that matters is still that nothing got harder to reach.
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
  localStorage.setItem('board:b-m:plan', JSON.stringify({
    days: [{ id: 'd1', label: `Day 1 · ${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}` }], items: { d1: [] } }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

const viewText = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' ').trim());
const active = () => page.evaluate(() => document.getElementById('view').dataset.activeTab);
const lit = () => page.evaluate(() => document.querySelector('.tab.active')?.getAttribute('data-view'));

// ---------- The bar ----------

const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.tab'))
  .filter((t) => !t.hidden).map((t) => t.getAttribute('data-view')));
check('three tabs', tabs.length === 3, JSON.stringify(tabs));
check('Trip, Find and Saved', ['trip', 'events', 'picks'].every((n) => tabs.includes(n)), JSON.stringify(tabs));

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

// ---------- Trip changes with the date ----------

// The plan's one day is today, so Trip opens on it.
await page.evaluate(() => document.querySelector('.tabbar [data-view="trip"]').click());
await page.waitForTimeout(350);
check('on a day of the trip, Trip opens on that day', await active() === 'today', await active());
check('with Trip lit', await lit() === 'trip', await lit());
check('and a switch to the whole plan', await page.evaluate(() =>
  !!document.querySelector('[data-trip-half="itinerary"]')));
await page.evaluate(() => document.querySelector('[data-trip-half="itinerary"]').click());
await page.waitForTimeout(350);
check('which goes to it', await active() === 'itinerary', await active());
check('still under Trip', await lit() === 'trip', await lit());
check('and the switch survives the plan redrawing itself', await page.evaluate(() => {
  window.__tripTest.showView('itinerary');
  document.querySelector('[data-quick-day], #addDayForm') && document.getElementById('addDayInput') &&
    (document.getElementById('addDayInput').value = 'Day 2');
  document.getElementById('addDayForm').requestSubmit();
  return !!document.querySelector('[data-trip-half="today"]');
}));

// Move the day to next week: now there is no "today", so Trip is the plan.
await page.evaluate(() => {
  const d = new Date(Date.now() + 7 * 864e5);
  localStorage.setItem('board:b-m:plan', JSON.stringify({
    days: [{ id: 'd1', label: `Day 1 · ${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}` }], items: { d1: [] } }));
  window.__tripTest.showView('picks');
  document.querySelector('.tabbar [data-view="trip"]').click();
});
await page.waitForTimeout(350);
check('before the trip, Trip opens on the plan', await active() === 'itinerary', await active());

// Leaving Trip for another tab lights that tab, not the one you left.
await page.evaluate(() => document.querySelector('.tabbar [data-view="events"]').click());
await page.waitForTimeout(300);
check('Find lights Find, coming from Trip', await lit() === 'events', await lit());
await page.evaluate(() => document.querySelector('.tabbar [data-view="picks"]').click());
await page.waitForTimeout(300);
check('and Saved lights Saved', await lit() === 'picks', await lit());
await page.evaluate(() => document.querySelector('.tabbar [data-view="trip"]').click());
await page.waitForTimeout(300);

// ---------- What was in More ----------

const plan = await viewText();
check('the kids, budget and packing screens are at the foot of the plan', await page.evaluate(() =>
  ['kids', 'budget', 'tips'].every((n) => !!document.querySelector(`[data-trip-extra="${n}"]`))));
check('each says what is behind it', /1 of 3 packed/.test(plan), plan.slice(-300));

await page.evaluate(() => document.querySelector('[data-trip-extra="tips"]').click());
await page.waitForTimeout(350);
check('a row opens its screen', await active() === 'tips', await active());
check('with Trip still lit', await lit() === 'trip', await lit());
check('and a way back as the first thing on the screen', await page.evaluate(() =>
  document.getElementById('view').firstElementChild?.classList.contains('sub-back')));
await page.evaluate(() => document.querySelector('.sub-back').click());
await page.waitForTimeout(300);
check('which goes back to the plan', await active() === 'itinerary', await active());

// The map and your other trips were in More twice over: they are in the top
// bar, where they always were.
await page.evaluate(() => document.getElementById('mapBtn').click());
await page.waitForTimeout(500);
check('the map opens from the top bar', await page.evaluate(() =>
  document.getElementById('mapOverlay').classList.contains('open')));
await page.evaluate(() => document.querySelector('[data-map-close]')?.click());
await page.waitForTimeout(300);

check('the trip name says it can be tapped', await page.evaluate(() =>
  /⌄|▾|›/.test(getComputedStyle(document.getElementById('topbarTitle'), '::after').content)));
await page.evaluate(() => document.querySelector('.topbar-text').click());
await page.waitForTimeout(400);
check('and opens the list of trips', await page.evaluate(() =>
  document.getElementById('placeModal').classList.contains('open') &&
  !!document.querySelector('[data-open-board]')));
await page.evaluate(() => document.querySelector('#placeModal .modal-close')?.click());
await page.waitForTimeout(300);

// AI usage is a detail of the key that pays for it.
await page.evaluate(() => document.getElementById('settingsBtn').click());
await page.waitForTimeout(400);
check('AI usage is in Settings', await page.evaluate(() => !!document.getElementById('openUsageBtn')));
await page.evaluate(() => document.getElementById('openUsageBtn').click());
await page.waitForTimeout(400);
check('and opens its screen', await active() === 'usage', await active());
check('whose way back is to where you were', await page.evaluate(() => {
  document.querySelector('.sub-back').click();
  return document.getElementById('view').dataset.activeTab;
}) === 'itinerary', await active());

// No subtitle repeating the name of the tab you just pressed.
check('the top bar does not caption the screen', await page.evaluate(() => !document.getElementById('topbarSub')));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
