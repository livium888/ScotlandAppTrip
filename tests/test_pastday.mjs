// Two reports, both about not being able to see something.
//
// "The today screen is still showing me two days ago." Today picked the day
// matching the date, else the next one ahead, else - and this was the bug -
// plan.days[0], the *first* day, which once the trip is over is the one
// furthest in the past. A plan whose days are all behind you opened on its
// oldest day and called it "Next up", for ever, because nothing about that
// changes with the date. Anyone trying the app out is in that state within a
// couple of days.
//
// "I'm looking at a search function and I cannot see any of those categories."
// The suggestions were on the blank search screen only, below the recent
// searches - six chips, two rows, and on a phone with the keyboard up that is
// the entire screen. So the prompts nobody thinks to type were themselves the
// thing nobody could find, and once you had searched they were gone.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
// A phone with the keyboard up, because that is what a search screen is.
await page.setViewportSize({ width: 390, height: 420 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([
      { name: 'The Grill', area: 'Perth', why: 'Pies.' }]) }] } }] }) });
});
await page.route(/nominatim|wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis/, (r) => r.abort());

const dayLabel = (offset) => {
  const t = new Date(Date.now() + offset * 864e5);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[t.getDay()]} ${t.getDate()} ${months[t.getMonth()]}`;
};
const viewText = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' ').trim());

await page.goto(BASE, { waitUntil: 'load' });
// Day 1 four days ago, day 2 two days ago. Nothing today, nothing ahead.
await page.evaluate(([first, second]) => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-p', boards: [{ id: 'b-p', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-p:picks', JSON.stringify([
    { id: 'custom:A', name: 'Dunkeld Cathedral', city: 'Perth', category: 'Historic', lat: 56.56, lon: -3.59, addedAt: 1 },
    { id: 'custom:B', name: 'The Taybank', city: 'Perth', category: 'Pub', lat: 56.565, lon: -3.59, addedAt: 2 }]));
  localStorage.setItem('board:b-p:plan', JSON.stringify({
    days: [{ id: 'd1', label: `Day 1 · ${first}` }, { id: 'd2', label: `Day 2 · ${second}` }],
    items: { d1: [{ pickId: 'custom:A', time: '10:00' }], d2: [{ pickId: 'custom:B', time: '12:00' }] } }));
  // Enough history to fill the screen on its own, which is what buried the
  // suggestions in the first place.
  localStorage.setItem('recent-searches-v1', JSON.stringify(
    ['fish and chips', 'castle', 'coffee near me', 'playground', 'loch', 'museum']));
}, [dayLabel(-4), dayLabel(-2)]);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

// ---------- A trip that is over ----------

await page.evaluate(() => document.querySelector('[data-view="today"]').click());
await page.waitForTimeout(400);
const past = await viewText();
check('a finished trip does not open on its first day', !/Day 1/.test(past), past.slice(0, 140));
check('it opens on the most recent day instead', /Day 2/.test(past), past.slice(0, 140));
check('and does not call a day that has been "next up"', !/Next up/i.test(past), past.slice(0, 140));
check('it says how long ago it was', /2 days ago/.test(past), past.slice(0, 200));
check('nothing on it is flagged as the next thing', await page.evaluate(() =>
  !document.querySelector('.today-next-flag')));

// The only thing worth doing from there.
check('there is a way to make today a day', await page.evaluate(() => !!document.getElementById('todayAddDay')));
await page.evaluate(() => document.getElementById('todayAddDay').click());
await page.waitForTimeout(500);
const added = await viewText();
check('and taking it lands you on today', /^Today/.test(added), added.slice(0, 120));
check('with the right date on it', new RegExp(dayLabel(0).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(added),
  added.slice(0, 120));

// A day ahead is still "next up" - the fix must not swallow that case.
await page.evaluate(([ahead]) => {
  const plan = JSON.parse(localStorage.getItem('board:b-p:plan'));
  plan.days.push({ id: 'd9', label: `Day 9 · ${ahead}` });
  plan.items.d9 = [];
  localStorage.setItem('board:b-p:plan', JSON.stringify(plan));
}, [dayLabel(3)]);
await page.evaluate(() => {
  const plan = JSON.parse(localStorage.getItem('board:b-p:plan'));
  // Drop today again so the next day ahead is the only candidate.
  plan.days = plan.days.filter((d) => d.id !== 'd3' && !/Day 3/.test(d.label));
  localStorage.setItem('board:b-p:plan', JSON.stringify(plan));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-view="today"]').click());
await page.waitForTimeout(400);
check('a day still ahead is still "next up"', /Next up/i.test(await viewText()), (await viewText()).slice(0, 140));

// ---------- Prompts you can actually see ----------

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
await page.waitForSelector('#pickSearchInput');
await page.waitForTimeout(300);

const onScreen = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.search-chip'))
    .filter((c) => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })
    .map((c) => c.textContent.trim()));
const visible = await onScreen();
check('the asks are on screen before any scrolling', visible.length >= 8, JSON.stringify(visible));
check('including the ones that are the whole point',
  visible.some((c) => /Comfort food/i.test(c)) &&
  visible.some((c) => /locals actually eat/i.test(c)) &&
  visible.some((c) => /Worth the detour/i.test(c)), JSON.stringify(visible));
check('and they come before the search history', await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('.search-chip'));
  const firstRecent = chips.findIndex((c) => c.textContent.includes('🕘'));
  const firstAsk = chips.findIndex((c) => /Comfort food/i.test(c.textContent));
  return firstRecent === -1 || firstAsk < firstRecent;
}));

// They also have to survive a search - the moment you want a different angle
// is when the results in front of you are not it.
await page.fill('#pickSearchInput', 'pie');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(2500);
check('and they are still there once results are showing', await page.evaluate(() =>
  Array.from(document.querySelectorAll('.search-chip')).some((c) => /Comfort food/i.test(c.textContent))),
  await page.evaluate(() => Array.from(document.querySelectorAll('.search-chip')).map((c) => c.textContent.trim()).join(' | ')));
await page.evaluate(() => document.querySelector('[data-search-close]').click());
await page.waitForTimeout(300);

// ---------- And in the other place you go looking ----------

// Reached the way you would reach it: from somewhere already saved, so the
// centre is set without a geocoder.
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await page.evaluate(() => document.querySelector('[data-explore-from]').click());
await page.waitForSelector('#exploreCatBtn', { timeout: 5000 });
await page.click('#exploreCatBtn');
await page.waitForSelector('[data-choose-cat]', { timeout: 4000 });
const catText = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.cat-group-label, [data-choose-cat]')).map((e) => e.textContent.trim()).join(' | '));
check('Explore offers them too, not only kinds of building',
  /Comfort food/i.test(catText) && /Where locals eat/i.test(catText) && /Surprise me/i.test(catText),
  catText.slice(0, 300));
check('and they are the first thing offered', /^Worth asking/.test(catText), catText.slice(0, 80));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
