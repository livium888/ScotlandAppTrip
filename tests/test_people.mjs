// Phase 3: the app had a sentence about your family rather than your family.
//
// "Who's travelling" was one free-text box - "family of 3, 4-year-old who
// walks" - pasted into the top of every prompt. It read well and could be
// used for nothing else. The app could not tell you a four-year-old would
// not last a distillery tour, could not notice that the 13:30 stop lands in
// the middle of a nap, asked every kids search about "a young child" when it
// knew the child was three, and split a budget for a family of five exactly
// as it split one for a couple - because it had a sentence, not a family.
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
await page.route(/generativelanguage|nominatim|wikidata|wikipedia|overpass|open-meteo|photon|places\.googleapis|upload\.|tile\./, (r) => r.abort());
await page.addInitScript(() => { localStorage.setItem('onboarded-v1', '1'); });

const now = new Date();
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const todayLabel = `Day 1 · ${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate((label) => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-p', boards: [{ id: 'b-p', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: '', geminiModel: '', travellers: 'family of 3, 4-year-old who walks' }));
  localStorage.setItem('board:b-p:folders', JSON.stringify(['Speyside']));
  localStorage.setItem('board:b-p:picks', JSON.stringify([
    { id: 'p1', name: 'Glenfiddich Distillery', city: 'Dufftown', category: 'Distillery tour',
      lat: 57.45, lon: -3.12, addedAt: 1, photoChecked: true },
    { id: 'p2', name: 'Landmark Adventure Park', city: 'Carrbridge', category: 'Adventure playground',
      lat: 57.28, lon: -3.82, addedAt: 2, photoChecked: true },
  ]));
  localStorage.setItem('board:b-p:plan', JSON.stringify({
    days: [{ id: 'd1', label }],
    items: { d1: [
      { pickId: 'p1', time: '13:30' },
      { pickId: 'p2', time: '16:00' },
    ] } }));
}, todayLabel);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

// ---------- Nothing changes for someone who never opens the screen ----------

check('the sentence somebody already typed is still what a prompt gets',
  await page.evaluate(() => /family of 3, 4-year-old who walks/.test(window.__tripTest.whoDescription())),
  await page.evaluate(() => window.__tripTest.whoDescription()));
check('and it says nothing about a child it does not know about',
  await page.evaluate(() => window.__tripTest.childVerdict({ name: 'Glenfiddich Distillery', category: 'Distillery tour' })) === null);

// ---------- A list of people says the same thing, usefully ----------

const setPeople = (people) => page.evaluate((p) => {
  localStorage.setItem('people-v1', JSON.stringify(p));
}, people);

await setPeople([
  { name: 'Sam', age: 38 },
  { name: 'Alex', age: 36 },
  { name: 'Ally', age: 3, naps: true, buggy: true, diet: 'no dairy' },
]);

const said = await page.evaluate(() => window.__tripTest.whoDescription());
check('a list is turned back into a sentence for the prompt', /2 adults/.test(said), said);
check('with the child and their age', /1 child \(aged 3\)/.test(said), said);
check('and the buggy, because it rules places out', /buggy/.test(said), said);
check('and the nap, because it rules times out', /naps/.test(said), said);
check('and what they cannot eat', /no dairy/.test(said), said);

// It has to actually reach the prompts, not just exist.
check('and every prompt is built from it',
  await page.evaluate(() => /2 adults/.test(window.__tripTest.aiContextBlock())),
  await page.evaluate(() => window.__tripTest.aiContextBlock()));

// ---------- Will a three-year-old last here ----------

const verdicts = await page.evaluate(() => ({
  distillery: window.__tripTest.childVerdict({ name: 'Glenfiddich Distillery', category: 'Distillery tour' }),
  playground: window.__tripTest.childVerdict({ name: 'Landmark Adventure Park', category: 'Adventure playground' }),
  gallery: window.__tripTest.childVerdict({ name: 'Modern One', category: 'Art gallery' }),
  pub: window.__tripTest.childVerdict({ name: 'The Ship Inn', category: 'Pub' }),
}));
check('a distillery tour is flagged for a three-year-old',
  verdicts.distillery && verdicts.distillery.ok === false, JSON.stringify(verdicts));
check('and it says why rather than just disapproving',
  verdicts.distillery && /tour|touch/.test(verdicts.distillery.why), JSON.stringify(verdicts.distillery));
check('an adventure playground is not', verdicts.playground && verdicts.playground.ok === true,
  JSON.stringify(verdicts.playground));
check('a gallery is flagged too', verdicts.gallery && verdicts.gallery.ok === false, JSON.stringify(verdicts.gallery));
// The important half: a warning on everything is a warning on nothing.
check('and an ordinary pub gets no verdict either way', verdicts.pub === null, JSON.stringify(verdicts.pub));

// A nine-year-old is a different question, and the app should stop answering it.
await setPeople([{ name: 'Sam', age: 38 }, { name: 'Ally', age: 9 }]);
check('none of it applies to a nine-year-old',
  await page.evaluate(() => window.__tripTest.childVerdict({ name: 'Glenfiddich Distillery', category: 'Distillery tour' })) === null);

// ---------- Naps ----------

await setPeople([
  { name: 'Sam', age: 38 },
  { name: 'Ally', age: 3, naps: true },
]);
const naps = await page.evaluate(() => ({
  inIt: window.__tripTest.clashesWithNap('13:30'),
  before: window.__tripTest.clashesWithNap('11:00'),
  after: window.__tripTest.clashesWithNap('16:00'),
  untimed: window.__tripTest.clashesWithNap(''),
}));
check('a half-one stop lands in the nap', naps.inIt === true, JSON.stringify(naps));
check('an eleven o\'clock one does not', naps.before === false, JSON.stringify(naps));
check('nor a four o\'clock one', naps.after === false, JSON.stringify(naps));
check('and a stop with no time is not guessed about', naps.untimed === false, JSON.stringify(naps));

// Nobody naps, nothing is said - the window is not a fact about afternoons.
await setPeople([{ name: 'Sam', age: 38 }, { name: 'Alex', age: 36 }]);
check('with nobody napping, half one is just half one',
  await page.evaluate(() => window.__tripTest.clashesWithNap('13:30')) === false);

// ---------- And it reaches the screen ----------

await setPeople([
  { name: 'Sam', age: 38 },
  { name: 'Ally', age: 3, naps: true },
]);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-view="itinerary"]').click());
await page.waitForTimeout(600);
const itin = await page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
check('the day says the 13:30 stop is in Ally\'s nap', /Ally's nap/.test(itin), itin.slice(0, 500));
check('and that a three-year-old will struggle at the distillery',
  /may not last/.test(itin), itin.slice(0, 500));

// ---------- The kids searches ask about the child you have ----------

check('a kids search names the actual age', await page.evaluate(() =>
  /a 3-year-old/.test(window.__tripTest.forOurKids('playground with something for a young child'))),
  await page.evaluate(() => window.__tripTest.forOurKids('playground with something for a young child')));

await setPeople([{ name: 'Sam', age: 38 }, { age: 3 }, { age: 7 }]);
check('and both of them when there are two', await page.evaluate(() =>
  /children aged 3 and 7/.test(window.__tripTest.forOurKids('indoor soft play or play barn for young children'))),
  await page.evaluate(() => window.__tripTest.forOurKids('indoor soft play or play barn for young children')));

await page.evaluate(() => localStorage.removeItem('people-v1'));
check('and it says "a young child" again when it does not know', await page.evaluate(() =>
  window.__tripTest.forOurKids('playground with something for a young child') ===
  'playground with something for a young child'));

// ---------- The budget knows how many of you there are ----------

await setPeople([
  { name: 'Sam', age: 38 },
  { name: 'Alex', age: 36 },
  { name: 'Ally', age: 3 },
]);
await page.evaluate(() => {
  localStorage.setItem('board:b-p:budget', JSON.stringify([
    { id: 'x1', label: 'Cottage', amount: 600 },
    { id: 'x2', label: 'Fuel', amount: 150 },
  ]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-view="budget"]').click());
await page.waitForTimeout(600);
const budget = await page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
check('the total is split per person', /an adult/.test(budget), budget.slice(0, 400));
check('with a child counted as a child, not a third adult', /a child/.test(budget), budget.slice(0, 400));
check('and it says how many it divided by', /across 3 of you/.test(budget), budget.slice(0, 400));

// A couple does not need telling that half of it each is half of it each -
// but two people is still two people, so the line belongs. One person does not.
await setPeople([{ name: 'Sam', age: 38 }]);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-view="budget"]').click());
await page.waitForTimeout(600);
check('travelling alone, there is nothing to split', await page.evaluate(() =>
  !/an adult · |across 1 of you/.test(document.getElementById('view').textContent)));

// ---------- Editing it ----------

await page.evaluate(() => localStorage.removeItem('people-v1'));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('settingsBtn').click());
await page.waitForSelector('#addPersonBtn', { timeout: 4000 });
check('with nobody listed, the old free-text box is still there',
  await page.evaluate(() => !!document.getElementById('setTravellers')));

await page.evaluate(() => document.getElementById('addPersonBtn').click());
await page.waitForTimeout(300);
check('adding someone gives you a row to fill in',
  await page.evaluate(() => document.querySelectorAll('.person-row').length) === 1);

await page.fill('.person-row .person-name', 'Ally');
await page.fill('.person-row .person-age', '3');
await page.evaluate(() => document.querySelector('[data-person-field="naps"]').click());
await page.waitForTimeout(400);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('people-v1')));
check('what you typed is saved', stored.length === 1 && stored[0].name === 'Ally' && stored[0].age === 3,
  JSON.stringify(stored));
check('including the ticked box', stored[0].naps === true, JSON.stringify(stored));

await page.evaluate(() => document.querySelector('[data-remove-person]').click());
await page.waitForTimeout(300);
check('and somebody can be taken back off',
  await page.evaluate(() => JSON.parse(localStorage.getItem('people-v1')).length) === 0);

// ---------- It survives a reinstall ----------

await setPeople([{ name: 'Ally', age: 3, naps: true }]);
// The real question: does a backup file contain them. Anything typed once
// and never thought about again is exactly what a reinstall loses.
const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await page.evaluate(() => document.getElementById('settingsBtn').click());
await page.waitForSelector('#exportBackupBtn', { timeout: 4000 });
await page.evaluate(() => document.getElementById('exportBackupBtn').click());
const file = await dl;
check('a backup can be taken', !!file);
if (file) {
  const path = await file.path();
  const text = fs.readFileSync(path, 'utf8');
  check('and who is travelling is in it', /people-v1/.test(text) && /Ally/.test(text), text.slice(0, 300));

  // And comes back, which is the half that actually matters.
  await page.evaluate(() => localStorage.removeItem('people-v1'));
  await page.evaluate((t) => window.__tripTest.importBackup(t), text);
  await page.waitForTimeout(300);
  check('and is restored by putting the file back', await page.evaluate(() =>
    (JSON.parse(localStorage.getItem('people-v1') || '[]')[0] || {}).name === 'Ally'),
    await page.evaluate(() => localStorage.getItem('people-v1')));
}

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
