// The first thirty seconds.
//
// A new install landed on somebody else's trip: a board called "Scotland with
// Ally", an Edinburgh guide bundled in, and an empty Picks tab whose advice
// was a bulleted list of four things you could go and do. Every one of those
// four needs to know where you are going, and nothing had asked.
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
await page.route(/generativelanguage|nominatim|wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis|upload\./, (r) => r.abort());

const fresh = async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
};

// ---------- It asks, rather than assuming ----------

await fresh();
check('a new install is met with a question', await page.evaluate(() =>
  document.getElementById('welcomeOverlay').classList.contains('open')));
check('and the question is the one everything else depends on', /Where are you going/.test(
  await page.evaluate(() => document.getElementById('welcomeOverlay').textContent)));
check('you can see how long this will take', await page.evaluate(() =>
  document.querySelectorAll('.welcome-dot').length === 3));
check('and it will not let you past a blank answer', await page.evaluate(() =>
  document.querySelector('[data-welcome-next]').disabled === true));

// Whatever the first suggestion happens to be - the point is that tapping one
// answers the question, not which places are offered.
const firstSuggestion = await page.evaluate(() =>
  document.querySelector('[data-welcome-where]').getAttribute('data-welcome-where'));
await page.evaluate(() => document.querySelector('[data-welcome-where]').click());
await page.waitForTimeout(250);
check('a suggestion answers it', await page.evaluate(() =>
  document.getElementById('welcomeWhere').value) === firstSuggestion, firstSuggestion);
check('and the way on opens up', await page.evaluate(() =>
  document.querySelector('[data-welcome-next]').disabled === false));

await page.evaluate(() => document.querySelector('[data-welcome-next]').click());
await page.waitForTimeout(300);
check('the second question is when', /When are you going/.test(
  await page.evaluate(() => document.getElementById('welcomeOverlay').textContent)));

// Going back must not lose what you already said.
await page.evaluate(() => document.querySelector('[data-welcome-back]').click());
await page.waitForTimeout(250);
check('going back keeps your answer', await page.evaluate(() =>
  document.getElementById('welcomeWhere').value) === firstSuggestion, firstSuggestion);
await page.evaluate(() => document.querySelector('[data-welcome-next]').click());
await page.waitForTimeout(250);

await page.evaluate(() => {
  const d = new Date(Date.now() + 86400000);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  document.getElementById('welcomeStart').value = iso;
  document.getElementById('welcomeNights').value = '3';
});
await page.evaluate(() => document.querySelector('[data-welcome-next]').click());
await page.waitForTimeout(300);
check('the third question is who', /Who.s coming/.test(
  await page.evaluate(() => document.getElementById('welcomeOverlay').textContent)));
await page.evaluate(() => document.querySelector('[data-welcome-who="Family with young kids"]').click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('[data-welcome-next]').click());
await page.waitForTimeout(700);

// ---------- What it did with the answers ----------

check('it is done asking', await page.evaluate(() =>
  !document.getElementById('welcomeOverlay').classList.contains('open')));
check('the trip is named after where you are going', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('boards-v1')).boards[0].name) === firstSuggestion, firstSuggestion);
check('and searching will look there', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('trip-settings-v1')).destination) === firstSuggestion, firstSuggestion);
check('who is coming is remembered, since it changes every answer', await page.evaluate(() =>
  /young kids/.test(JSON.parse(localStorage.getItem('trip-settings-v1')).travellers)));
const days = await page.evaluate(() => {
  const board = JSON.parse(localStorage.getItem('boards-v1')).boards[0];
  return JSON.parse(localStorage.getItem(`board:${board.id}:plan`) || '{"days":[]}').days;
});
check('the days exist, so Today has something to be about', days.length === 3, JSON.stringify(days));
check("somebody else's Edinburgh guide is not bundled into your trip to Skye",
  await page.evaluate(() => JSON.parse(localStorage.getItem('boards-v1')).boards[0].hasGuide === false));
// The empty app was the problem; landing back on it would be no answer at all.
check('and it opens the thing that fills an empty trip', await page.evaluate(() =>
  document.getElementById('ideaOverlay').classList.contains('open')));

// ---------- It only asks once ----------

await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
check('it does not ask again next time', await page.evaluate(() =>
  !document.getElementById('welcomeOverlay').classList.contains('open')));

// ---------- Skipping ----------

await fresh();
await page.evaluate(() => document.querySelector('[data-welcome-skip]').click());
await page.waitForTimeout(500);
check('it can be skipped outright', await page.evaluate(() =>
  !document.getElementById('welcomeOverlay').classList.contains('open')));
check('and skipping still counts as asked', await page.evaluate(() =>
  !!localStorage.getItem('onboarded-v1')));

// ---------- Somebody already using the app ----------
// Being asked "where are you going?" by an app that already holds your trip
// would be an insult rather than a welcome.

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-old', boards: [{ id: 'b-old', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('board:b-old:picks', JSON.stringify([
    { id: 'p1', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', addedAt: 1 }]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
check('an app with a trip already in it does not ask', await page.evaluate(() =>
  !document.getElementById('welcomeOverlay').classList.contains('open')));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
