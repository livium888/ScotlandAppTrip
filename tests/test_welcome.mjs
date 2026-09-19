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
  document.querySelectorAll('.welcome-dot').length === 4));
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
check('the second question is dates', /What dates are you going/.test(
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
  document.getElementById('welcomeDays').value = '3';
});
await page.evaluate(() => document.querySelector('[data-welcome-next]').click());
await page.waitForTimeout(300);
check('the third question is who', /Who is travelling/.test(
  await page.evaluate(() => document.getElementById('welcomeOverlay').textContent)));
await page.evaluate(() => document.querySelector('[data-welcome-who="Family with young kids"]').click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('[data-welcome-next]').click());
await page.waitForTimeout(300);
check('the fourth question is trip type', /What kind of trip is this/.test(
  await page.evaluate(() => document.getElementById('welcomeOverlay').textContent)));
await page.evaluate(() => document.querySelector('[data-welcome-trip-type="Family adventure"]').click());
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
  /2 adults and 1 child/.test(JSON.parse(localStorage.getItem('trip-settings-v1')).travellers)));
check('the trip type is remembered for suggestions', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('trip-settings-v1')).tripType === 'Family adventure'));
const days = await page.evaluate(() => {
  const board = JSON.parse(localStorage.getItem('boards-v1')).boards[0];
  return JSON.parse(localStorage.getItem(`board:${board.id}:plan`) || '{"days":[]}').days;
});
check('the days exist, so Today has something to be about', days.length === 3, JSON.stringify(days));
check("somebody else's Edinburgh guide is not bundled into your trip to Skye",
  await page.evaluate(() => JSON.parse(localStorage.getItem('boards-v1')).boards[0].hasGuide === false));
// The empty app was the problem; landing back on it would be no answer at all.
check('and it opens on the Plan tab where the trip can be built', await page.evaluate(() =>
  document.querySelector('[data-view="itinerary"]').classList.contains('active')));

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

// ---------- Finding it again when the trip already exists ----------
// The first version of this could only be seen by somebody who had just
// installed the app. Everyone who updates already has a trip, so the questions
// were invisible to exactly the people who wanted to answer them - which is how
// a shipped feature came back looking like nothing had changed.

await fresh();
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-old',
    boards: [{ id: 'b-old', name: 'Trip', destination: 'Skye', dated: true, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('board:b-old:picks', JSON.stringify([
    { id: 'p1', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', addedAt: 1 },
  ]));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Skye',
    travellers: '2 adults and 1 child. A 4-year-old',
    tripType: 'Outdoors and walking',
  }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

await page.evaluate(() => document.querySelector('[data-view="more"]').click());
await page.waitForTimeout(500);
const rowText = await page.evaluate(() => {
  const row = document.querySelector('[data-onboarding-open]');
  return row ? row.textContent.replace(/\s+/g, ' ').trim() : '';
});
check('the More screen offers the trip setup', /Trip setup/.test(rowText), rowText);
check('and says what the app already knows about the trip',
  /Skye/.test(rowText) && /2 adults/.test(rowText), rowText);

await page.evaluate(() => document.querySelector('[data-onboarding-open]').click());
await page.waitForTimeout(400);
check('opening it asks the same four questions', await page.evaluate(() =>
  document.querySelectorAll('.welcome-dot').length === 4 &&
  /Where are you going/.test(document.getElementById('welcomeOverlay').textContent)));
check('with the destination already in the box', await page.evaluate(() =>
  document.getElementById('welcomeWhere').value) === 'Skye');
check('and the way on is open, because there is already an answer', await page.evaluate(() =>
  document.querySelector('[data-welcome-next]').disabled === false));
check('cancelling is offered as cancelling, not as skipping', /Cancel/.test(
  await page.evaluate(() => document.getElementById('welcomeOverlay').textContent)));

await page.evaluate(() => document.querySelector('[data-welcome-next]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('[data-welcome-next]').click());
await page.waitForTimeout(300);
check('the travellers already given are remembered', await page.evaluate(() =>
  document.getElementById('welcomeAdults').value) === '2');
check('including the child', await page.evaluate(() =>
  document.getElementById('welcomeChildren').value) === '1');
check('and the detail that changes the day', /4-year-old/.test(
  await page.evaluate(() => document.getElementById('welcomeDetails').value)));

await page.evaluate(() => document.querySelector('[data-welcome-next]').click());
await page.waitForTimeout(300);
check('the trip style already chosen is shown as chosen', await page.evaluate(() =>
  document.querySelector('[data-welcome-trip-type="Outdoors and walking"]').classList.contains('on')));
await page.evaluate(() => document.querySelector('[data-welcome-next]').click());
await page.waitForTimeout(700);
check('finishing closes it', await page.evaluate(() =>
  !document.getElementById('welcomeOverlay').classList.contains('open')));
check('and the trip it was asked about is still there', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('board:b-old:picks')).length === 1));
check('with the answers written down', await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('trip-settings-v1'));
  return s.destination === 'Skye' && /2 adults and 1 child/.test(s.travellers) && s.tripType === 'Outdoors and walking';
}));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
